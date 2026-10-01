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
func runAgent(ctx context.Context) error {
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
		if e = configure(ctx, ps.RustDesk); e != nil {
			if errors.Is(e, errUnattended) {
				failureData, _ := json.Marshal(online{reg.EnrollmentID, time.Now().UTC()})
				_ = publishStatus(ps.Data, "failure.json", failureData)
			}
			return e
		}
	} else if !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return e
	}
	en, e := enroll.NewService(enroll.Options{StateDirectory: ps.Agent, API: apiClient, RustDesk: rd})
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
		return e
	}
	defer clear(result.DeviceToken)
	if e = os.Remove(bootstrap); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	info, e := rd.Discover(ctx)
	if e != nil {
		return e
	}
	scheduler, e := heartbeat.NewScheduler(func(c context.Context) error {
		_, e := apiClient.Heartbeat(c, result.DeviceToken, api.HeartbeatRequest{AgentVersion: Version, RustDeskVersion: info.Version, RustDeskID: info.ID, OperatingSystem: "Windows", OSVersion: osver})
		if e != nil {
			return e
		}
		b, _ := json.Marshal(online{reg.EnrollmentID, time.Now().UTC()})
		dest := filepath.Join(ps.Data, "online.json")
		tmp := filepath.Join(ps.Data, fmt.Sprintf("online-%d.next", time.Now().UnixNano()))
		if e = writeNew(tmp, b); e != nil {
			return e
		}
		defer os.Remove(tmp)
		return windows.MoveFileEx(ptr(tmp), ptr(dest), windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
	}, nil, heartbeat.Options{Interval: time.Duration(result.HeartbeatIntervalSeconds) * time.Second})
	if e != nil {
		return e
	}
	return scheduler.Run(ctx)
}

func publishStatus(directory, name string, data []byte) error {
	tmp := filepath.Join(directory, fmt.Sprintf("status-%d.next", time.Now().UnixNano()))
	if e := writeNew(tmp, data); e != nil {
		return e
	}
	defer os.Remove(tmp)
	return windows.MoveFileEx(ptr(tmp), ptr(filepath.Join(directory, name)), windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
