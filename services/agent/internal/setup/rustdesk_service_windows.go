//go:build windows

package setup

import (
	"context"
	"errors"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func findInstalledRustDesk() (string, error) {
	m, e := mgr.Connect()
	if e != nil {
		return "", e
	}
	defer m.Disconnect()
	s, e := m.OpenService("RustDesk")
	if e != nil {
		return "", e
	}
	defer s.Close()
	c, e := s.Config()
	if e != nil {
		return "", e
	}
	// Resolve only the two protected installation locations. Portable copies are not installed services.
	for _, folder := range []*windows.KNOWNFOLDERID{windows.FOLDERID_ProgramFiles, windows.FOLDERID_ProgramFilesX86} {
		root, e := windows.KnownFolderPath(folder, 0)
		if e != nil {
			continue
		}
		p := filepath.Join(root, "RustDesk", "RustDesk.exe")
		if st, e := os.Stat(p); e == nil && st.Mode().IsRegular() && strings.EqualFold(c.BinaryPathName, windows.EscapeArg(p)+" --service") {
			return p, nil
		}
	}
	return "", windows.ERROR_FILE_NOT_FOUND
}
func confirmRustDeskService(ctx context.Context, path string) error {
	return confirmRustDeskServiceReported(ctx, path, nil)
}
func confirmRustDeskServiceReported(ctx context.Context, path string, rp *Report) (err error) {
	operation := "RUSTDESK_VERSION"
	rp.Record(2, operation, "START", nil)
	defer func() {
		if err != nil {
			rp.Record(2, operation, "ERROR", err)
		}
	}()
	check, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	r, e := rustdesk.NewExecRunner(4096).Run(check, path, "--version")
	clear(r.Stdout)
	clear(r.Stderr)
	if e != nil || r.ExitCode != 0 {
		if e == nil {
			e = errStage
		}
		return e
	}
	operation = "RUSTDESK_SERVICE_INSPECT"
	rp.Record(2, operation, "START", nil)
	m, e := mgr.Connect()
	if e != nil {
		return e
	}
	defer m.Disconnect()
	s, e := m.OpenService("RustDesk")
	if e != nil {
		return e
	}
	defer s.Close()
	c, e := s.Config()
	if e != nil || !strings.EqualFold(c.BinaryPathName, windows.EscapeArg(path)+" --service") || c.ServiceStartName != "LocalSystem" || c.StartType != mgr.StartAutomatic {
		if e == nil {
			e = errStage
		}
		return e
	}
	status, e := s.Query()
	if e != nil {
		return e
	}
	operation = "RUSTDESK_SERVICE_START"
	rp.Record(2, operation, "START", nil)
	if status.State == svc.Stopped {
		if e = s.Start(); e != nil && !errors.Is(e, windows.ERROR_SERVICE_ALREADY_RUNNING) {
			return e
		}
	}
	return waitForServiceRunning(check, s.Query)
}
func waitForServiceRunning(check context.Context, query func() (svc.Status, error)) error {
	for {
		status, e := query()
		if e != nil {
			return e
		}
		if status.State == svc.Running {
			return nil
		}
		select {
		case <-check.Done():
			return check.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
