//go:build windows

package setup

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
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

func isRustDeskExecutableReference(serviceBinaryPath, exePath string) bool {
	if isRustDeskServicePath(serviceBinaryPath, exePath) {
		return true
	}
	lowerBin := strings.ToLower(strings.TrimSpace(serviceBinaryPath))
	lowerExe := strings.ToLower(exePath)
	if strings.Contains(lowerBin, lowerExe) || strings.Contains(lowerBin, `\rustdesk\rustdesk.exe`) {
		return true
	}
	return false
}

func candidateProgramFilesRoots() []string {
	var roots []string
	seen := map[string]bool{}
	add := func(root string) {
		clean := strings.TrimSpace(root)
		if clean == "" {
			return
		}
		key := strings.ToLower(filepath.Clean(clean))
		if seen[key] {
			return
		}
		seen[key] = true
		roots = append(roots, filepath.Clean(clean))
	}
	for _, folder := range []*windows.KNOWNFOLDERID{windows.FOLDERID_ProgramFiles, windows.FOLDERID_ProgramFilesX64, windows.FOLDERID_ProgramFilesX86} {
		if root, e := windows.KnownFolderPath(folder, 0); e == nil && root != "" {
			add(root)
		}
	}
	for _, envKey := range []string{"ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"} {
		add(os.Getenv(envKey))
	}
	return roots
}

func findRustDeskExecutable() (string, error) {
	for _, root := range candidateProgramFilesRoots() {
		p := filepath.Join(root, "RustDesk", "RustDesk.exe")
		if st, e := os.Stat(p); e == nil && st.Mode().IsRegular() {
			return p, nil
		}
	}
	return "", windows.ERROR_FILE_NOT_FOUND
}

func stageRustDeskFromPortableCache() (string, error) {
	if existing, err := findRustDeskExecutable(); err == nil {
		return existing, nil
	}
	var candidateDirs []string
	if localAppData, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0); err == nil && localAppData != "" {
		candidateDirs = append(candidateDirs, filepath.Join(localAppData, "rustdesk"))
	}
	if envLocal := os.Getenv("LOCALAPPDATA"); envLocal != "" {
		candidateDirs = append(candidateDirs, filepath.Join(envLocal, "rustdesk"))
	}
	candidateDirs = append(candidateDirs, `C:\Windows\System32\config\systemprofile\AppData\Local\rustdesk`)

	var sourceDir string
	for _, dir := range candidateDirs {
		exe := filepath.Join(dir, "rustdesk.exe")
		dll64 := filepath.Join(dir, "librustdesk.dll")
		dll32 := filepath.Join(dir, "sciter.dll")
		if stExe, err1 := os.Stat(exe); err1 == nil && stExe.Mode().IsRegular() {
			if stDll, err2 := os.Stat(dll64); err2 == nil && stDll.Mode().IsRegular() {
				sourceDir = dir
				break
			}
			if stDll32, err3 := os.Stat(dll32); err3 == nil && stDll32.Mode().IsRegular() {
				sourceDir = dir
				break
			}
		}
	}
	if sourceDir == "" {
		return "", windows.ERROR_FILE_NOT_FOUND
	}

	programFiles, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil || programFiles == "" {
		programFiles = `C:\Program Files`
	}
	targetDir := filepath.Join(programFiles, "RustDesk")
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return "", err
	}

	copyErr := filepath.Walk(sourceDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(sourceDir, path)
		if err != nil || rel == "." {
			return nil
		}
		if strings.EqualFold(rel, "meta.toml") {
			return nil
		}
		destRel := rel
		if strings.EqualFold(rel, "rustdesk.exe") {
			destRel = "RustDesk.exe"
		}
		destPath := filepath.Join(targetDir, destRel)
		if info.IsDir() {
			return os.MkdirAll(destPath, 0755)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return err
		}
		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()
		dstFile, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if err != nil {
			return err
		}
		_, cpErr := io.Copy(dstFile, srcFile)
		closeErr := dstFile.Close()
		if cpErr != nil {
			return cpErr
		}
		return closeErr
	})
	if copyErr != nil {
		return "", copyErr
	}
	return findRustDeskExecutable()
}

func normalizeRustDeskServiceConfig(s *mgr.Service, exePath string) error {
	serviceBinary := windows.EscapeArg(exePath) + " --service"
	c, err := s.Config()
	if err == nil && isRustDeskServicePath(c.BinaryPathName, exePath) &&
		(strings.EqualFold(c.ServiceStartName, "LocalSystem") || c.ServiceStartName == "" || strings.EqualFold(c.ServiceStartName, ".\\LocalSystem")) &&
		c.StartType == mgr.StartAutomatic {
		return nil
	}
	// If RustDesk installer created a temporary --import-config service command, let it run once before normalizing.
	if err == nil && strings.Contains(strings.ToLower(c.BinaryPathName), "--import-config") {
		_ = s.Start()
		time.Sleep(800 * time.Millisecond)
		_, _ = s.Control(svc.Stop)
		time.Sleep(400 * time.Millisecond)
	}
	binPtr, err := windows.UTF16PtrFromString(serviceBinary)
	if err != nil {
		return err
	}
	startNamePtr, err := windows.UTF16PtrFromString("LocalSystem")
	if err != nil {
		return err
	}
	return windows.ChangeServiceConfig(
		s.Handle,
		windows.SERVICE_WIN32_OWN_PROCESS,
		windows.SERVICE_AUTO_START,
		windows.SERVICE_ERROR_NORMAL,
		binPtr,
		nil,
		nil,
		nil,
		startNamePtr,
		nil,
		nil,
	)
}

func reconcileExistingRustDeskServiceBeforeInstall() {
	m, err := mgr.Connect()
	if err != nil {
		return
	}
	defer m.Disconnect()
	s, err := m.OpenService("RustDesk")
	if err != nil {
		return
	}
	defer s.Close()

	exePath, findErr := findRustDeskExecutable()
	if findErr != nil {
		exePath, findErr = stageRustDeskFromPortableCache()
	}
	c, cfgErr := s.Config()
	if findErr == nil && exePath != "" {
		if cfgErr == nil && isRustDeskExecutableReference(c.BinaryPathName, exePath) && !isRustDeskServicePath(c.BinaryPathName, exePath) {
			_ = normalizeRustDeskServiceConfig(s, exePath)
		}
		return
	}
	// If the RustDesk service points to a RustDesk binary that no longer exists on disk, delete the stale service entry so bundled install can proceed cleanly.
	if cfgErr == nil && isRustDeskExecutableReference(c.BinaryPathName, `C:\Program Files\RustDesk\RustDesk.exe`) {
		_, _ = s.Control(svc.Stop)
		time.Sleep(300 * time.Millisecond)
		_ = s.Delete()
	}
}

func ensureRustDeskServiceInstalled(ctx context.Context, exePath string) error {
	m, e := mgr.Connect()
	if e != nil {
		return e
	}
	defer m.Disconnect()
	s, e := m.OpenService("RustDesk")
	if e == nil {
		_ = normalizeRustDeskServiceConfig(s, exePath)
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
		_ = normalizeRustDeskServiceConfig(s, exePath)
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
			if existingSvc, openErr := m.OpenService("RustDesk"); openErr == nil {
				_ = normalizeRustDeskServiceConfig(existingSvc, exePath)
				existingSvc.Close()
			}
			return nil
		}
		if runErr != nil {
			return runErr
		}
		return createErr
	}
	_ = normalizeRustDeskServiceConfig(newService, exePath)
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
	// Resolve only the protected installation locations. Portable copies are not installed services.
	for _, root := range candidateProgramFilesRoots() {
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
