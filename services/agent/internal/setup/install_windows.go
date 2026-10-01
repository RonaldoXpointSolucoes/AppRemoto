//go:build windows

package setup

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const ServiceName = "XPointRemoteAgent"

var errUnattended = errors.New("RustDesk unattended policy could not be confirmed")

type receipt struct {
	EnrollmentID      string `json:"enrollmentId"`
	OrganizationID    string `json:"organizationId"`
	DeviceDisplayName string `json:"deviceDisplayName"`
}

func sameInstall(a receipt, p Provisioning) bool {
	return a.EnrollmentID == p.EnrollmentID && a.OrganizationID == p.OrganizationID && a.DeviceDisplayName == p.DeviceDisplayName
}
func lockError(err error) string {
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return "BUSY"
	}
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return "LOCK_ACCESS"
	}
	return "LOCK"
}
func acquireSetupLock(name string, sa *windows.SecurityAttributes) (windows.Handle, string, error) {
	// Lifetime of the handle is the lock. No thread-affine mutex ownership in Go.
	h, e := windows.CreateMutex(sa, false, ptr(name))
	if e != nil {
		if h != 0 {
			windows.CloseHandle(h)
		}
		return 0, lockError(e), e
	}
	return h, "", nil
}
func recoveryDecision(r receipt, p Provisioning, pending, credentials bool) string {
	if r.OrganizationID != p.OrganizationID {
		return "EXISTING_INSTALLATION"
	}
	if credentials && pending {
		return "RESUME"
	}
	if credentials || pending {
		return "RECONCILIATION"
	}
	return "REPLACE_UNUSED"
}
func stopManagedService(ctx context.Context, s *mgr.Service) error {
	q, e := s.Query()
	if e != nil {
		return e
	}
	if q.State == svc.Stopped {
		return nil
	}
	if q.State != svc.StopPending {
		if _, e = s.Control(svc.Stop); e != nil {
			return e
		}
	}
	check, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for {
		q, e = s.Query()
		if e != nil {
			return e
		}
		if q.State == svc.Stopped {
			return nil
		}
		select {
		case <-check.Done():
			return check.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}
func replacePrivate(path string, data []byte, readable ...bool) error {
	tmp := path + fmt.Sprintf(".%d.next", time.Now().UnixNano())
	if e := writeNew(tmp, data, readable...); e != nil {
		return e
	}
	defer os.Remove(tmp)
	return windows.MoveFileEx(ptr(tmp), ptr(path), windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
func Install(ctx context.Context, r *Report) (code string) {
	step, operation := 1, "PACKAGE"
	fail := func(c string, e error) string { r.Record(step, operation, "ERROR", e); return c }
	start := func(s int, op string) { step, operation = s, op; r.Record(s, op, "START", nil) }
	start(1, "PACKAGE")
	exe, e := os.Executable()
	if e != nil {
		return fail("PACKAGE", e)
	}
	f, e := os.Open(exe)
	if e != nil {
		return fail("PACKAGE", e)
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return fail("PACKAGE", e)
	}
	p, base, e := ReadOverlay(f, st.Size(), time.Now())
	if e != nil {
		return fail("PACKAGE", e)
	}
	defer func() { p.EnrollmentToken = "" }()
	if ctx.Err() != nil {
		return fail("CANCELLED", ctx.Err())
	}
	start(1, "INSTALL_LOCK")
	sa, e := securityAttributes()
	if e != nil {
		return fail("LOCK", e)
	}
	lock, c, e := acquireSetupLock("Global\\XPointRemoteAgentSetup", sa)
	if e != nil {
		return fail(c, e)
	}
	defer windows.CloseHandle(lock)
	r.Record(1, "PACKAGE", "OK", nil)
	start(2, "RUSTDESK_DETECT")
	ps, e := paths()
	if e != nil {
		return fail("PATH", e)
	}
	ps.RustDesk, e = findInstalledRustDesk()
	if e != nil {
		return fail("RUSTDESK_MISSING", e)
	}
	if e = confirmRustDeskServiceReported(ctx, ps.RustDesk, r); e != nil {
		return fail("RUSTDESK_SERVICE", e)
	}
	r.Record(2, "RUSTDESK_READY", "OK", nil)
	start(3, "PROTECTED_DIRECTORIES")
	bh, e := secureDir(ps.Binary, true)
	if e != nil {
		return fail("PATH", e)
	}
	defer windows.CloseHandle(bh)
	dh, e := secureDir(ps.Data)
	if e != nil {
		return fail("PATH", e)
	}
	defer windows.CloseHandle(dh)
	r.Record(3, "PROTECTED_DIRECTORIES", "OK", nil)
	// Display names are editable labels, never installation identity.
	start(3, "INSTALLATION_CUSTOMER_CHECK")
	// Reject a different customer before stopping any existing managed service.
	if prior, readErr := readPrivate(filepath.Join(ps.Data, "installation.json"), 4096); readErr == nil {
		var reg receipt
		if json.Unmarshal(prior, &reg) != nil {
			return fail("STATE", errStage)
		}
		if reg.OrganizationID != p.OrganizationID {
			return fail("EXISTING_INSTALLATION", errStage)
		}
	} else if !errors.Is(readErr, windows.ERROR_FILE_NOT_FOUND) {
		return fail("STATE", readErr)
	}
	runtimePath := filepath.Join(ps.Binary, "remote-agent.exe")
	start(3, "SERVICE_INSPECT")
	m, e := mgr.Connect()
	if e != nil {
		return fail("SERVICE", e)
	}
	defer m.Disconnect()
	s, e := m.OpenService(ServiceName)
	if e == nil {
		defer s.Close()
		c, ce := s.Config()
		if ce != nil {
			return fail("SERVICE", ce)
		}
		if !managedServiceConfig(c, runtimePath) {
			return fail("SERVICE_CONFLICT", errStage)
		}
		start(3, "SERVICE_STOP_FOR_REPAIR")
		if e = stopManagedService(ctx, s); e != nil {
			return fail("SERVICE_STOP", e)
		}
	} else if !errors.Is(e, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return fail("SERVICE", e)
	}
	// The old service is stopped before inspecting recovery markers: it cannot race enrollment.
	start(3, "RECOVERY_STATE")
	registration := filepath.Join(ps.Data, "installation.json")
	pending, e := privateExists(filepath.Join(ps.Agent, "enrollment-pending.json"))
	if e != nil {
		return fail("STATE", e)
	}
	credentials, e := privateExists(filepath.Join(ps.Agent, "enrollment-credentials.json"))
	if e != nil {
		return fail("STATE", e)
	}
	existing, e := readPrivate(registration, 4096)
	if e == nil {
		var reg receipt
		if json.Unmarshal(existing, &reg) != nil || !idPattern.MatchString(reg.EnrollmentID) || !idPattern.MatchString(reg.OrganizationID) {
			return fail("STATE", errStage)
		}
		decision := recoveryDecision(reg, p, pending, credentials)
		switch decision {
		case "RESUME":
			r.Record(3, "RESUME_SAVED_CREDENTIALS", "START", nil)
		case "REPLACE_UNUSED":
			r.Record(3, "REPLACE_UNUSED_ATTEMPT", "START", nil)
		default:
			return fail(decision, errStage)
		}
	} else if !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return fail("STATE", e)
	} else if pending || credentials {
		return fail("RECONCILIATION", errStage)
	}
	{
		start(3, "NEW_PACKAGE_STATE_WRITE")
		b, _ := json.Marshal(receipt{p.EnrollmentID, p.OrganizationID, p.DeviceDisplayName})
		if e = replacePrivate(registration, b); e != nil {
			return fail("STATE", e)
		}
		b, _ = json.Marshal(p)
		encrypted, pe := protectMachine(b)
		clear(b)
		if pe != nil {
			return fail("BOOTSTRAP", pe)
		}
		e = replacePrivate(filepath.Join(ps.Data, "bootstrap.dpapi"), encrypted)
		clear(encrypted)
		if e != nil {
			return fail("BOOTSTRAP", e)
		}
	}
	start(3, "RUNTIME_UPDATE")
	current, e := readPrivate(runtimePath, 64<<20, true)
	if e != nil && !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return fail("RUNTIME", e)
	}
	b, e := io.ReadAll(io.NewSectionReader(f, 0, base))
	if e != nil {
		return fail("RUNTIME", e)
	}
	if sha256.Sum256(current) != sha256.Sum256(b) {
		if e = replacePrivate(runtimePath, b, true); e != nil {
			return fail("RUNTIME", e)
		}
	}
	start(3, "SERVICE_REGISTER")
	if s == nil {
		s, e = m.CreateService(ServiceName, runtimePath, mgr.Config{DisplayName: "XPoint Remote Agent", Description: "XPoint device enrollment and presence", StartType: mgr.StartAutomatic, ServiceStartName: "LocalSystem", Dependencies: []string{"RustDesk"}}, "--service")
		if e != nil {
			return fail("SERVICE", e)
		}
		defer s.Close()
	}
	if e = s.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: 30 * time.Second}, {Type: mgr.ServiceRestart, Delay: time.Minute}, {Type: mgr.ServiceRestart, Delay: 2 * time.Minute}}, 86400); e != nil {
		return fail("SERVICE", e)
	}
	if e = s.SetRecoveryActionsOnNonCrashFailures(true); e != nil {
		return fail("SERVICE", e)
	}
	started := time.Now().UTC()
	start(3, "SERVICE_START")
	if e = s.Start(); e != nil {
		return fail("SERVICE", e)
	}
	r.Record(3, "SERVICE_STARTED", "OK", nil)
	lastEvent := time.Time{}
	collect := func() string {
		b, e := readPrivate(filepath.Join(ps.Data, "setup-status.json"), 64<<10)
		if e != nil {
			return ""
		}
		var failure string
		lastEvent, failure = mergeServiceProgress(r, b, p.EnrollmentID, started, lastEvent)
		events := r.Events()
		if len(events) > 0 {
			ev := events[len(events)-1]
			if ev.Step > 0 {
				step, operation = ev.Step, ev.Operation
			}
		}
		return failure
	}
	for {
		if failure := collect(); failure != "" {
			return failure
		}
		b, e = readPrivate(filepath.Join(ps.Data, "online.json"), 4096)
		if e == nil {
			var o online
			if json.Unmarshal(b, &o) == nil && o.EnrollmentID == p.EnrollmentID && o.At.After(started) {
				r.Record(6, "HEARTBEAT_CONFIRMED", "OK", nil)
				if r.Err() != nil {
					return "LOG_WRITE"
				}
				return ""
			}
		}
		q, e := s.Query()
		if e != nil {
			return fail("SERVICE_QUERY", e)
		}
		if q.State == svc.Stopped {
			if failure := collect(); failure != "" {
				return failure
			}
			if q.ServiceSpecificExitCode != 0 {
				r.Record(step, "SERVICE_EXIT_CODE", "ERROR", syscall.Errno(q.ServiceSpecificExitCode))
			}
			return fail("SERVICE_STOPPED", syscall.Errno(q.Win32ExitCode))
		}
		if r.Err() != nil {
			return "LOG_WRITE"
		}
		select {
		case <-ctx.Done():
			return fail("TIMEOUT", ctx.Err())
		case <-time.After(300 * time.Millisecond):
		}
	}
}
func managedServiceConfig(c mgr.Config, path string) bool {
	return strings.EqualFold(c.BinaryPathName, windows.EscapeArg(path)+" --service") && strings.EqualFold(c.ServiceStartName, "LocalSystem") && c.StartType == mgr.StartAutomatic
}
func configure(ctx context.Context, path string) error {
	return configureWith(ctx, path, rustdesk.NewExecRunner(4096))
}
func configureWith(ctx context.Context, path string, runner rustdesk.CommandRunner) error {
	return configureReported(ctx, path, runner, nil)
}
func configureReported(ctx context.Context, path string, runner rustdesk.CommandRunner, r *Report) error {
	for i, v := range [][2]string{{"custom-rendezvous-server", IDServer}, {"relay-server", RelayServer}, {"key", PublicKey}, {"api-server", ""}, {"approve-mode", "password"}, {"verification-method", "use-permanent-password"}} {
		op := []string{"ID_SERVER", "RELAY_SERVER", "PUBLIC_KEY", "API_SERVER_EMPTY", "APPROVE_MODE", "PERMANENT_PASSWORD_MODE"}[i]
		r.Record(4, op+"_WRITE", "START", nil)
		c, cancel := context.WithTimeout(ctx, 20*time.Second)
		result, e := runner.Run(c, path, "--option", v[0], v[1])
		cancel()
		clear(result.Stdout)
		clear(result.Stderr)
		if e != nil || result.ExitCode != 0 {
			if e == nil {
				e = errStage
			}
			r.Record(4, op+"_WRITE", "ERROR", e)
			return configurationError(v[0])
		}
		r.Record(4, op+"_READBACK", "START", nil)
		c, cancel = context.WithTimeout(ctx, 20*time.Second)
		result, e = runner.Run(c, path, "--option", v[0])
		cancel()
		ok := strings.TrimSpace(string(result.Stdout)) == v[1]
		clear(result.Stdout)
		clear(result.Stderr)
		if e != nil || result.ExitCode != 0 || !ok {
			if e == nil {
				e = errStage
			}
			r.Record(4, op+"_READBACK", "ERROR", e)
			return configurationError(v[0])
		}
	}
	r.Record(4, "RUSTDESK_CONFIGURED", "OK", nil)
	return nil
}
func Uninstall() error {
	ps, e := paths()
	if e != nil {
		return e
	}
	m, e := mgr.Connect()
	if e != nil {
		return e
	}
	defer m.Disconnect()
	s, e := m.OpenService(ServiceName)
	if e != nil {
		return e
	}
	defer s.Close()
	c, e := s.Config()
	if e != nil || c.BinaryPathName != windows.EscapeArg(filepath.Join(ps.Binary, "remote-agent.exe"))+" --service" {
		return errStage
	}
	_, _ = s.Control(svc.Stop)
	for n := 0; n < 30; n++ {
		q, e := s.Query()
		if e != nil {
			return e
		}
		if q.State == svc.Stopped {
			return s.Delete()
		}
		time.Sleep(time.Second)
	}
	return errStage
}

func configurationError(key string) error {
	if key == "approve-mode" || key == "verification-method" {
		return errUnattended
	}
	return errStage
}
