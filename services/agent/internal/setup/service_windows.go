//go:build windows

package setup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/enroll"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/heartbeat"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/secret"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"os"
	"path/filepath"
	"time"
)

type online struct {
	EnrollmentID string    `json:"enrollmentId"`
	At           time.Time `json:"at"`
}
type service struct{}

func RunService() error { return svc.Run(ServiceName, service{}) }
func (service) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	status <- svc.Status{State: svc.StartPending}
	done := make(chan error, 1)
	go func() { done <- runAgent(ctx) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case e := <-done:
			if e != nil {
				return true, 1
			}
			return false, 0
		case r := <-requests:
			switch r.Cmd {
			case svc.Interrogate:
				status <- r.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-done:
				case <-time.After(15 * time.Second):
				}
				return false, 0
			}
		}
	}
}
func runAgent(ctx context.Context) (err error) {
	ps, e := paths()
	if e != nil {
		return e
	}
	h, e := secureDir(ps.Data)
	if e != nil {
		return e
	}
	defer windows.CloseHandle(h)
	b, e := readPrivate(filepath.Join(ps.Data, "installation.json"), 4096)
	if e != nil {
		return e
	}
	var reg receipt
	if json.Unmarshal(b, &reg) != nil {
		return errStage
	}
	r := serviceReport(ps.Data, reg.EnrollmentID)
	operation := "SERVICE_INITIALIZE"
	step := 4
	r.Record(4, operation, "START", nil)
	defer func() {
		if err != nil && !errors.Is(err, context.Canceled) {
			events := r.Events()
			if len(events) == 0 || events[len(events)-1].Result != "ERROR" {
				r.Record(step, operation, "ERROR", err)
			}
		}
	}()
	ps.RustDesk, e = findInstalledRustDesk()
	if e != nil {
		return e
	}
	apiClient, e := api.NewClient(APIURL, api.Options{})
	if e != nil {
		return e
	}
	rd, e := rustdesk.NewClient(nil, rustdesk.Options{ExecutablePath: ps.RustDesk, CommandTimeout: 20 * time.Second})
	if e != nil {
		return e
	}
	bootstrap := filepath.Join(ps.Data, "bootstrap.dpapi")
	var token []byte
	operation = "BOOTSTRAP_DECRYPT"
	r.Record(4, operation, "START", nil)
	encrypted, e := readPrivate(bootstrap, MaxOverlay+4096)
	if e == nil {
		plain, e := secret.Unprotect(encrypted)
		clear(encrypted)
		if e != nil {
			return e
		}
		defer clear(plain)
		var p Provisioning
		if _, statErr := os.Stat(filepath.Join(ps.Agent, "enrollment-credentials.json")); statErr == nil {
			if json.Unmarshal(plain, &p) != nil {
				return errStage
			}
		} else {
			p, e = Decode(plain, time.Now())
			if e != nil {
				return e
			}
		}
		if !sameInstall(reg, p) {
			return errStage
		}
		token = []byte(p.EnrollmentToken)
		p.EnrollmentToken = ""
		defer clear(token)
	} else if !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return e
	}
	operation = "RUSTDESK_CONFIGURATION"
	if e = configureReported(ctx, ps.RustDesk, rustdesk.NewExecRunner(4096), r); e != nil {
		return e
	}
	if r.Err() != nil {
		return r.Err()
	}
	operation = "ENROLLMENT_STATE"
	step = 5
	r.Record(5, operation, "START", nil)
	en, e := enroll.NewService(enroll.Options{StateDirectory: ps.Agent, API: reportedAPI{apiClient, r}, RustDesk: reportedRustDesk{rd, r}, GenericInstallation: reg.GenericInstallation,
		AllowReenrollFallback: true, Progress: func(op, result string, err error) { r.Record(5, op, result, err) }})
	if e != nil {
		return e
	}
	host, e := os.Hostname()
	if e != nil {
		return e
	}
	v := windows.RtlGetVersion()
	if v == nil {
		return errStage
	}
	osver := fmt.Sprintf("%d.%d.%d", v.MajorVersion, v.MinorVersion, v.BuildNumber)
	result, e := en.Run(ctx, token, enroll.Metadata{DisplayName: reg.DeviceDisplayName, Hostname: host, OperatingSystem: "Windows", OSVersion: osver, AgentVersion: Version})
	if e != nil {
		var stage *enroll.StageError
		if !errors.As(e, &stage) {
			r.Record(5, operation, "ERROR", e)
		}
		return e
	}
	defer clear(result.DeviceToken)
	r.Record(5, "ENROLLMENT_AND_PASSWORD_READY", "OK", nil)
	step = 6
	operation = "BOOTSTRAP_CLEANUP"
	r.Record(step, operation, "START", nil)
	if e = os.Remove(bootstrap); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	operation = "HEARTBEAT_RUSTDESK_ID"
	r.Record(step, operation, "START", nil)
	info, e := rd.Discover(ctx)
	if e != nil {
		return e
	}
	operation = "HEARTBEAT_SCHEDULER"
	scheduler, e := heartbeat.NewScheduler(func(c context.Context) error {
		r.Record(6, "HEARTBEAT_REQUEST", "START", nil)
		_, e := apiClient.Heartbeat(c, result.DeviceToken, api.HeartbeatRequest{AgentVersion: Version, RustDeskVersion: info.Version, RustDeskID: info.ID, OperatingSystem: "Windows", OSVersion: osver})
		if e != nil {
			r.Record(6, "HEARTBEAT_RETRY", "WAIT", e)
			return e
		}
		b, _ := json.Marshal(online{reg.EnrollmentID, time.Now().UTC()})
		dest := filepath.Join(ps.Data, "online.json")
		tmp := filepath.Join(ps.Data, fmt.Sprintf("online-%d.next", time.Now().UnixNano()))
		if e = writeNew(tmp, b); e != nil {
			r.Record(6, "HEARTBEAT_PERSIST", "ERROR", e)
			return e
		}
		defer os.Remove(tmp)
		e = windows.MoveFileEx(ptr(tmp), ptr(dest), windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
		if e != nil {
			r.Record(6, "HEARTBEAT_PERSIST", "ERROR", e)
		} else {
			r.Record(6, "HEARTBEAT_CONFIRMED", "OK", nil)
		}
		return e
	}, nil, heartbeat.Options{Interval: time.Duration(result.HeartbeatIntervalSeconds) * time.Second})
	if e != nil {
		return e
	}
	return scheduler.Run(ctx)
}

type reportedAPI struct {
	client *api.Client
	report *Report
}

func (a reportedAPI) Enroll(ctx context.Context, request api.EnrollRequest) (api.EnrollResponse, error) {
	a.report.Record(5, "ENROLLMENT_REQUEST", "START", nil)
	res, e := a.client.Enroll(ctx, request)
	if e != nil {
		a.report.Record(5, "ENROLLMENT_REQUEST", "ERROR", e)
	}
	return res, e
}

func (a reportedAPI) Reconfigure(ctx context.Context, token []byte, request api.EnrollRequest) (api.ReconfigureResponse, error) {
	return a.client.Reconfigure(ctx, token, request)
}

func (a reportedAPI) GenericPassword(ctx context.Context, token []byte, request api.EnrollRequest) (api.GenericPasswordResponse, error) {
	return a.client.GenericPassword(ctx, token, request)
}
func (a reportedAPI) ConfirmGenericPassword(ctx context.Context, token []byte, request api.EnrollRequest) (api.GenericPasswordConfirmation, error) {
	return a.client.ConfirmGenericPassword(ctx, token, request)
}

type reportedRustDesk struct {
	client *rustdesk.Client
	report *Report
}

func (r reportedRustDesk) Discover(ctx context.Context) (rustdesk.Info, error) {
	r.report.Record(5, "RUSTDESK_ID_AND_VERSION", "START", nil)
	info, e := r.client.Discover(ctx)
	if e != nil {
		r.report.Record(5, "RUSTDESK_ID_AND_VERSION", "ERROR", e)
	}
	return info, e
}
func (r reportedRustDesk) SetUnattendedPassword(ctx context.Context, password string) error {
	r.report.Record(5, "PERMANENT_PASSWORD_SET", "START", nil)
	e := r.client.SetUnattendedPassword(ctx, password)
	if e != nil {
		r.report.Record(5, "PERMANENT_PASSWORD_SET", "ERROR", e)
	}
	return e
}

func publishStatus(directory, name string, data []byte) error {
	tmp := filepath.Join(directory, fmt.Sprintf("status-%d.next", time.Now().UnixNano()))
	if e := writeNew(tmp, data); e != nil {
		return e
	}
	defer os.Remove(tmp)
	return windows.MoveFileEx(ptr(tmp), ptr(filepath.Join(directory, name)), windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
