//go:build windows

package setup

import (
	"context"
	"errors"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
	"strings"
	"time"
)

func confirmRustDeskService(ctx context.Context, path string) error {
	check, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	r, e := rustdesk.NewExecRunner(4096).Run(check, path, "--version")
	clear(r.Stdout)
	clear(r.Stderr)
	if e != nil || r.ExitCode != 0 {
		return errStage
	}
	m, e := mgr.Connect()
	if e != nil {
		return errStage
	}
	defer m.Disconnect()
	s, e := m.OpenService("RustDesk")
	if e != nil {
		return errStage
	}
	defer s.Close()
	c, e := s.Config()
	if e != nil || !strings.EqualFold(c.BinaryPathName, windows.EscapeArg(path)+" --service") || c.ServiceStartName != "LocalSystem" || c.StartType != mgr.StartAutomatic {
		return errStage
	}
	status, e := s.Query()
	if e != nil {
		return errStage
	}
	if status.State == svc.Stopped {
		if e = s.Start(); e != nil && !errors.Is(e, windows.ERROR_SERVICE_ALREADY_RUNNING) {
			return errStage
		}
	}
	for {
		status, e = s.Query()
		if e != nil {
			return errStage
		}
		if status.State == svc.Running {
			return nil
		}
		select {
		case <-check.Done():
			return errStage
		case <-time.After(100 * time.Millisecond):
		}
	}
}
