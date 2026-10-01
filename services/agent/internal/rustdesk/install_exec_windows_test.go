//go:build windows

package rustdesk

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestInstallerProcessFixture(t *testing.T) {
	args := os.Args
	idx := -1
	for i, a := range args {
		if a == "--installer-fixture" {
			idx = i
			break
		}
	}
	if idx < 0 {
		return
	}
	a := args[idx+1:]
	if len(a) < 2 {
		os.Exit(3)
	}
	self, _ := os.Executable()
	switch a[0] {
	case "launcher", "timeout-launcher":
		child := "child"
		if a[0] == "timeout-launcher" {
			child = "timeout-child"
		}
		cmd := exec.Command(self, "-test.run=^TestInstallerProcessFixture$", "--", "--installer-fixture", child, a[1])
		if cmd.Start() != nil {
			os.Exit(4)
		}
		os.Exit(0)
	case "child":
		time.Sleep(400 * time.Millisecond)
		tray := exec.Command(self, "-test.run=^TestInstallerProcessFixture$", "--", "--installer-fixture", "tray", a[1])
		if tray.Start() != nil {
			os.Exit(5)
		}
		if os.WriteFile(a[1], []byte("complete"), 0600) != nil {
			os.Exit(6)
		}
		os.Exit(0)
	case "timeout-child":
		if os.WriteFile(a[1]+".started", []byte("started"), 0600) != nil {
			os.Exit(7)
		}
		time.Sleep(2 * time.Second)
		_ = os.WriteFile(a[1], []byte("should not survive"), 0600)
		os.Exit(0)
	case "tray":
		time.Sleep(2 * time.Second)
		_ = os.WriteFile(a[1]+".tray", []byte("should not survive"), 0600)
		os.Exit(0)
	}
	os.Exit(8)
}
func TestInstallerWaitsForChildNotTray(t *testing.T) {
	exe, _ := os.Executable()
	path := filepath.Join(t.TempDir(), "done")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	runner := windowsExecRunner{maxOutputBytes: 4096, waitInstaller: true}
	started := time.Now()
	result, e := runner.run(ctx, exe, false, "-test.run=^TestInstallerProcessFixture$", "--", "--installer-fixture", "launcher", path)
	if e != nil || result.ExitCode != 0 {
		t.Fatalf("installer runner failed: %v", e)
	}
	if _, e = os.Stat(path); e != nil {
		t.Fatal("launcher exit killed installer child")
	}
	if time.Since(started) > 1500*time.Millisecond {
		t.Fatal("runner waited for persistent tray")
	}
	time.Sleep(2100 * time.Millisecond)
	if _, e = os.Stat(path + ".tray"); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("tray escaped cleanup")
	}
}
func TestInstallerTimeoutKillsDelayedChild(t *testing.T) {
	exe, _ := os.Executable()
	path := filepath.Join(t.TempDir(), "done")
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
	defer cancel()
	runner := windowsExecRunner{maxOutputBytes: 4096, waitInstaller: true}
	_, e := runner.run(ctx, exe, false, "-test.run=^TestInstallerProcessFixture$", "--", "--installer-fixture", "timeout-launcher", path)
	if !errors.Is(e, context.DeadlineExceeded) {
		t.Fatalf("expected bounded timeout, got %v", e)
	}
	if _, e = os.Stat(path + ".started"); e != nil {
		t.Fatal("fixture child never started")
	}
	time.Sleep(2200 * time.Millisecond)
	if _, e = os.Stat(path); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("installer child escaped timeout cleanup")
	}
}
