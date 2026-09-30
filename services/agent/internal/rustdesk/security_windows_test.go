//go:build windows

package rustdesk

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestOpenPinnedExecutableRejectsAncestorJunction(t *testing.T) {
	realDirectory := t.TempDir()
	executable := filepath.Join(realDirectory, "RustDesk.exe")
	writeFakeExecutable(t, executable)
	junction := filepath.Join(t.TempDir(), "linked")
	createRustDeskTestJunction(t, junction, realDirectory)

	pinned, err := openPinnedExecutable(filepath.Join(junction, "RustDesk.exe"), false)
	if pinned != nil {
		pinned.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "redirected") {
		t.Fatalf("openPinnedExecutable() error = %v, want redirected path rejection", err)
	}
}

func TestOpenPinnedExecutableAcceptsSystemOwnedReadOnlyBinary(t *testing.T) {
	path := filepath.Join(os.Getenv("SystemRoot"), "System32", "where.exe")
	pinned, err := openPinnedExecutable(path, true)
	if err != nil {
		t.Fatalf("openPinnedExecutable(%q) error = %v", path, err)
	}
	if err := pinned.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestExecRunnerPinsExecutableAgainstReplacement(t *testing.T) {
	directory := t.TempDir()
	executable := filepath.Join(directory, "RustDesk.exe")
	if err := copyRustDeskTestFile(os.Args[0], executable); err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(directory, "replacement.exe")
	writeFakeExecutable(t, replacement)

	var replacementErr error
	executablePinnedHook = func(string) {
		replacementErr = os.Rename(replacement, executable)
	}
	t.Cleanup(func() { executablePinnedHook = nil })
	t.Setenv("GO_WANT_RUSTDESK_HELPER_PROCESS", "1")
	t.Setenv("RUSTDESK_HELPER_MODE", "normal")
	_, err := NewExecRunner(64).Run(context.Background(), executable, "-test.run=TestRustDeskHelperProcess")
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if replacementErr == nil || (!errors.Is(replacementErr, windows.ERROR_SHARING_VIOLATION) && !errors.Is(replacementErr, windows.ERROR_ACCESS_DENIED)) {
		t.Fatalf("replacement error = %v, want sharing violation or access denied", replacementErr)
	}
}

func assertProcessExited(t *testing.T, pidFile string) {
	t.Helper()
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatalf("read child pid: %v", err)
	}
	pid, err := strconv.ParseUint(string(data), 10, 32)
	if err != nil {
		t.Fatalf("parse child pid: %v", err)
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return
	}
	if err != nil {
		t.Fatalf("OpenProcess(%d) error = %v", pid, err)
	}
	defer windows.CloseHandle(handle)
	status, err := windows.WaitForSingleObject(handle, 0)
	if err != nil || status != windows.WAIT_OBJECT_0 {
		t.Fatalf("child process %d remains alive: status=%d error=%v", pid, status, err)
	}
}

func createRustDeskTestJunction(t *testing.T, junction, target string) {
	t.Helper()
	command := exec.Command("cmd", "/c", "mklink", "/J", junction, target)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create junction: %v: %s", err, output)
	}
}

func copyRustDeskTestFile(source, destination string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(destination, data, 0o600)
}
