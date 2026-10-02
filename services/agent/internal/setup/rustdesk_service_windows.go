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

func isRustDeskServicePath(serviceBinaryPath, exePath string) bool {
	clean := strings.Trim(strings.TrimSpace(serviceBinaryPath), `"`)
	quoted := windows.EscapeArg(exePath) + " --service"
	unquoted := exePath + " --service"
	if strings.EqualFold(serviceBinaryPath, quoted) || strings.EqualFold(serviceBinaryPath, unquoted) || strings.EqualFold(clean, unquoted) {
		return true
	}
	if strings.HasSuffix(strings.ToLower(serviceBinaryPath), "--service") {
		prefix := strings.TrimSpace(strings.TrimSuffix(strings.ToLower(serviceBinaryPath), "--service"))
		prefix = strings.Trim(prefix, `"`)
		if strings.EqualFold(prefix, exePath) {
			return true
		}
	}
	return false
}

func findRustDeskExecutable() (string, error) {
	for _, folder := range []*windows.KNOWNFOLDERID{windows.FOLDERID_ProgramFiles, windows.FOLDERID_ProgramFilesX86} {
		root, e := windows.KnownFolderPath(folder, 0)
		if e != nil {
			continue
		}
		p := filepath.Join(root, "RustDesk", "RustDesk.exe")
		if st, e := os.Stat(p); e == nil && st.Mode().IsRegular() {
			return p, nil
		}
	}
	return "", windows.ERROR_FILE_NOT_FOUND
}

func ensureRustDeskServiceInstalled(ctx context.Context, exePath string) error {
	m, e := mgr.Connect()
	if e != nil {
		return e
	}
	defer m.Disconnect()
	s, e := m.OpenService("RustDesk")
	if e == nil {
		s.Close()
		return nil
	}
	serviceInstallCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	res, runErr := rustdesk.NewExecRunner(4096).Run(serviceInstallCtx, exePath, "--install-service")
	clear(res.Stdout)
	clear(res.Stderr)
	s, e = m.OpenService("RustDesk")
	if e == nil {
		s.Close()
		return nil
	}
	serviceBinary := windows.EscapeArg(exePath) + " --service"
	newService, createErr := m.CreateService(
		"RustDesk",
		serviceBinary,
		mgr.Config{
			ServiceType:      windows.SERVICE_WIN32_OWN_PROCESS,
			StartType:        windows.SERVICE_AUTO_START,
			ErrorControl:     windows.SERVICE_ERROR_NORMAL,
			DisplayName:      "RustDesk Service",
			Description:      "RustDesk Remote Desktop Service",
			ServiceStartName: "LocalSystem",
		},
	)
	if createErr != nil {
		if errors.Is(createErr, windows.ERROR_SERVICE_EXISTS) {
			return nil
		}
		if runErr != nil {
			return runErr
		}
		return createErr
	}
	newService.Close()
	return nil
}

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
		if st, e := os.Stat(p); e == nil && st.Mode().IsRegular() && isRustDeskServicePath(c.BinaryPathName, p) {
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
	if e != nil {
		return e
	}
	if e = ensureRustDeskAutostart(path, c, func() error {
		operation = "RUSTDESK_AUTOSTART_WRITE"
		rp.Record(2, operation, "START", nil)
		// Change only startup mode. Preserve the verified path, account and all other service settings.
		return windows.ChangeServiceConfig(s.Handle, windows.SERVICE_NO_CHANGE, windows.SERVICE_AUTO_START, windows.SERVICE_NO_CHANGE, nil, nil, nil, nil, nil, nil, nil)
	}, s.Config); e != nil {
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

// The caller verifies the executable's protected owner/ACL before reaching this service mutation.
func ensureRustDeskAutostart(path string, config mgr.Config, setAutomatic func() error, readback func() (mgr.Config, error)) error {
	valid := func(c mgr.Config) bool {
		return isRustDeskServicePath(c.BinaryPathName, path) && (strings.EqualFold(c.ServiceStartName, "LocalSystem") || c.ServiceStartName == "" || strings.EqualFold(c.ServiceStartName, ".\\LocalSystem"))
	}
	if !valid(config) {
		return &preparationError{"RUSTDESK_CONFLICT"}
	}
	if config.StartType == mgr.StartAutomatic {
		return nil
	}
	if config.StartType != mgr.StartManual && config.StartType != mgr.StartDisabled {
		return &preparationError{"RUSTDESK_CONFLICT"}
	}
	if err := setAutomatic(); err != nil {
		return err
	}
	actual, err := readback()
	if err != nil {
		return err
	}
	if !valid(actual) || actual.StartType != mgr.StartAutomatic {
		return &preparationError{"RUSTDESK_CONFLICT"}
	}
	return nil
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
