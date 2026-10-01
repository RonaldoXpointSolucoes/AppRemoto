//go:build windows

package setup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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
func Install(ctx context.Context) string {
	exe, e := os.Executable()
	if e != nil {
		return "PACKAGE"
	}
	f, e := os.Open(exe)
	if e != nil {
		return "PACKAGE"
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return "PACKAGE"
	}
	p, base, e := ReadOverlay(f, st.Size(), time.Now())
	if e != nil {
		return "PACKAGE"
	}
	defer func() { p.EnrollmentToken = "" }()
	if ctx.Err() != nil {
		return "CANCELLED"
	}
	ps, e := paths()
	if e != nil {
		return "PATH"
	}
	sa, e := securityAttributes()
	if e != nil {
		return "LOCK"
	}
	lock, e := windows.CreateMutex(sa, true, ptr("Global\\XPointRemoteAgentSetup"))
	if e != nil {
		if lock != 0 {
			windows.CloseHandle(lock)
		}
		return "BUSY"
	}
	defer windows.CloseHandle(lock)
	defer windows.ReleaseMutex(lock)
	bh, e := secureDir(ps.Binary, true)
	if e != nil {
		return "PATH"
	}
	defer windows.CloseHandle(bh)
	dh, e := secureDir(ps.Data)
	if e != nil {
		return "PATH"
	}
	defer windows.CloseHandle(dh)
	registration := filepath.Join(ps.Data, "installation.json")
	existing, e := readPrivate(registration, 4096)
	if e == nil {
		var r receipt
		if json.Unmarshal(existing, &r) != nil || !sameInstall(r, p) {
			return "EXISTING_INSTALLATION"
		}
	} else if !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return "STATE"
	} else {
		b, _ := json.Marshal(receipt{p.EnrollmentID, p.OrganizationID, p.DeviceDisplayName})
		if writeNew(registration, b) != nil {
			return "STATE"
		}
	}
	runtimePath := filepath.Join(ps.Binary, "remote-agent.exe")
	if _, e := os.Stat(runtimePath); errors.Is(e, os.ErrNotExist) {
		b, e := io.ReadAll(io.NewSectionReader(f, 0, base))
		if e != nil {
			return "RUNTIME"
		}
		if writeNew(runtimePath, b, true) != nil {
			return "RUNTIME"
		}
	} else if e != nil {
		return "RUNTIME"
	} else {
		current, e := readPrivate(runtimePath, 64<<20, true)
		if e != nil {
			return "RUNTIME"
		}
		h := sha256.New()
		if _, e = io.Copy(h, io.NewSectionReader(f, 0, base)); e != nil {
			return "RUNTIME"
		}
		sum := sha256.Sum256(current)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), hex.EncodeToString(h.Sum(nil))) {
			return "VERSION_CONFLICT"
		}
	}
	if ctx.Err() != nil {
		return "CANCELLED"
	}
	if e = installRustDesk(ctx, ps); e != nil {
		return "RUSTDESK"
	}
	bootstrap := filepath.Join(ps.Data, "bootstrap.dpapi")
	encrypted, e := readPrivate(bootstrap, MaxOverlay+4096)
	clear(encrypted)
	if errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		if _, e = os.Stat(filepath.Join(ps.Agent, "enrollment-pending.json")); errors.Is(e, os.ErrNotExist) {
			b, _ := json.Marshal(p)
			encrypted, e := protectMachine(b)
			clear(b)
			if e != nil {
				return "BOOTSTRAP"
			}
			defer clear(encrypted)
			if writeNew(bootstrap, encrypted) != nil {
				return "BOOTSTRAP"
			}
		} else if e != nil {
			return "STATE"
		}
	} else if e != nil {
		return "BOOTSTRAP"
	}
	m, e := mgr.Connect()
	if e != nil {
		return "SERVICE"
	}
	defer m.Disconnect()
	s, e := m.OpenService(ServiceName)
	if errors.Is(e, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		s, e = m.CreateService(ServiceName, runtimePath, mgr.Config{DisplayName: "XPoint Remote Agent", Description: "XPoint device enrollment and presence", StartType: mgr.StartAutomatic, ServiceStartName: "LocalSystem", Dependencies: []string{"RustDesk"}}, "--service")
	} else if e == nil {
		c, ce := s.Config()
		if ce != nil || c.BinaryPathName != windows.EscapeArg(runtimePath)+" --service" || c.ServiceStartName != "LocalSystem" || c.StartType != mgr.StartAutomatic {
			s.Close()
			return "SERVICE_CONFLICT"
		}
	}
	if e != nil {
		return "SERVICE"
	}
	defer s.Close()
	if s.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: 30 * time.Second}, {Type: mgr.ServiceRestart, Delay: time.Minute}, {Type: mgr.ServiceRestart, Delay: 2 * time.Minute}}, 86400) != nil {
		return "SERVICE"
	}
	if s.SetRecoveryActionsOnNonCrashFailures(true) != nil {
		return "SERVICE"
	}
	started := time.Now()
	if e = s.Start(); e != nil && !errors.Is(e, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return "SERVICE"
	}
	for {
		b, e := readPrivate(filepath.Join(ps.Data, "online.json"), 4096)
		if e == nil {
			var o online
			if json.Unmarshal(b, &o) == nil && o.EnrollmentID == p.EnrollmentID && o.At.After(started) {
				return ""
			}
		}
		failureData, failureErr := readPrivate(filepath.Join(ps.Data, "failure.json"), 4096)
		if failureErr == nil {
			var failed online
			if json.Unmarshal(failureData, &failed) == nil && failed.EnrollmentID == p.EnrollmentID && failed.At.After(started) {
				return "RUSTDESK_UNATTENDED"
			}
		}
		select {
		case <-ctx.Done():
			return "FIRST_HEARTBEAT"
		case <-time.After(time.Second):
		}
	}
}
func installRustDesk(ctx context.Context, p Paths) error {
	if _, e := os.Stat(p.RustDesk); e == nil {
		return confirmRustDeskService(ctx, p.RustDesk)
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	target := filepath.Join(p.Binary, "RustDesk.exe")
	b, e := readPrivate(target, 128<<20)
	if errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		req, e := http.NewRequestWithContext(ctx, http.MethodGet, RustDeskURL, nil)
		if e != nil {
			return e
		}
		c := &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(r *http.Request, via []*http.Request) error {
			if r.URL.Scheme != "https" || len(via) > 5 {
				return errStage
			}
			return nil
		}}
		res, e := c.Do(req)
		if e != nil {
			return e
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return errStage
		}
		b, e = io.ReadAll(io.LimitReader(res.Body, (128<<20)+1))
		if e != nil || len(b) > 128<<20 {
			return errStage
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != RustDeskSHA256 {
			return errStage
		}
		if writeNew(target, b) != nil {
			return errStage
		}
	} else if e != nil {
		return e
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != RustDeskSHA256 {
		return errStage
	}
	r, e := rustdesk.NewInstallerRunner(4096).Run(ctx, target, "--silent-install", "printer=0")
	clear(r.Stdout)
	clear(r.Stderr)
	if e != nil || r.ExitCode != 0 {
		return errStage
	}
	return confirmRustDeskService(ctx, p.RustDesk)
}
func configure(ctx context.Context, path string) error {
	return configureWith(ctx, path, rustdesk.NewExecRunner(4096))
}
func configureWith(ctx context.Context, path string, runner rustdesk.CommandRunner) error {
	for _, v := range [][2]string{{"custom-rendezvous-server", IDServer}, {"relay-server", RelayServer}, {"key", PublicKey}, {"api-server", ""}, {"approve-mode", "password"}, {"verification-method", "use-permanent-password"}} {
		c, cancel := context.WithTimeout(ctx, 20*time.Second)
		result, e := runner.Run(c, path, "--option", v[0], v[1])
		cancel()
		clear(result.Stdout)
		clear(result.Stderr)
		if e != nil || result.ExitCode != 0 {
			return configurationError(v[0])
		}
		c, cancel = context.WithTimeout(ctx, 20*time.Second)
		result, e = runner.Run(c, path, "--option", v[0])
		cancel()
		ok := strings.TrimSpace(string(result.Stdout)) == v[1]
		clear(result.Stdout)
		clear(result.Stderr)
		if e != nil || result.ExitCode != 0 || !ok {
			return configurationError(v[0])
		}
	}
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
