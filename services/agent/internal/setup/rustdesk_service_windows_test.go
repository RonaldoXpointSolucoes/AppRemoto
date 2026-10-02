//go:build windows

package setup

import (
	"errors"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
	"testing"
)

func TestRustDeskAutostartOnlyRepairsTrustedServiceMode(t *testing.T) {
	path := `C:\Program Files\RustDesk\RustDesk.exe`
	for _, mode := range []uint32{mgr.StartManual, mgr.StartDisabled, mgr.StartAutomatic} {
		config := mgr.Config{BinaryPathName: windows.EscapeArg(path) + " --service", ServiceStartName: "LocalSystem", StartType: mode}
		writes, reads := 0, 0
		err := ensureRustDeskAutostart(path, config, func() error { writes++; config.StartType = mgr.StartAutomatic; return nil }, func() (mgr.Config, error) { reads++; return config, nil })
		want := 0
		if mode != mgr.StartAutomatic {
			want = 1
		}
		if err != nil || writes != want || reads != want {
			t.Fatalf("mode %d writes=%d reads=%d error=%v", mode, writes, reads, err)
		}
	}
}
func TestRustDeskAutostartRejectsConflictBeforeAnyAction(t *testing.T) {
	path := `C:\Program Files\RustDesk\RustDesk.exe`
	for _, config := range []mgr.Config{{BinaryPathName: "unexpected.exe --service", ServiceStartName: "LocalSystem", StartType: mgr.StartManual}, {BinaryPathName: windows.EscapeArg(path) + " --service", ServiceStartName: "someone", StartType: mgr.StartDisabled}} {
		err := ensureRustDeskAutostart(path, config, func() error { t.Fatal("must reject before mutation"); return nil }, func() (mgr.Config, error) { t.Fatal("unexpected readback"); return mgr.Config{}, nil })
		if err == nil {
			t.Fatal("conflict accepted")
		}
	}
}
func TestRustDeskAutostartRequiresSuccessfulReadback(t *testing.T) {
	path := `C:\Program Files\RustDesk\RustDesk.exe`
	config := mgr.Config{BinaryPathName: windows.EscapeArg(path) + " --service", ServiceStartName: "LocalSystem", StartType: mgr.StartManual}
	if err := ensureRustDeskAutostart(path, config, func() error { return nil }, func() (mgr.Config, error) { return config, nil }); err == nil {
		t.Fatal("unconfirmed startup mutation accepted")
	}
	want := errors.New("denied")
	if err := ensureRustDeskAutostart(path, config, func() error { return want }, func() (mgr.Config, error) { t.Fatal("read after failed mutation"); return config, nil }); !errors.Is(err, want) {
		t.Fatalf("error %v", err)
	}
}
