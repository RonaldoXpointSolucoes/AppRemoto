//go:build windows

package setup

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAdjacentLogAppendsAndRedacts(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "Cliente (2).exe")
	for i := 0; i < 2; i++ {
		r, err := OpenReport(exe)
		if err != nil {
			t.Fatal(err)
		}
		r.Record(2, "RUSTDESK_VERSION", "START", nil)
		r.Record(2, "RUSTDESK_VERSION", "ERROR", errors.New("password=never-log-this"))
		r.Record(2, "RUSTDESK_VERSION", "ERROR", windows.ERROR_ACCESS_DENIED)
		r.Close()
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "Cliente (2).log"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if strings.Contains(s, "never-log-this") || strings.Count(s, "SESSION_START") != 2 || !strings.Contains(s, "win32=5") || !strings.Contains(s, "RUSTDESK_VERSION") {
		t.Fatalf("unexpected diagnostics: %s", s)
	}
}

func TestServiceWaitNeverAcceptsTimeoutAsSuccess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if !errors.Is(waitForServiceRunning(ctx, func() (svc.Status, error) { return svc.Status{State: svc.StartPending}, nil }), context.DeadlineExceeded) {
		t.Fatal("service timeout accepted")
	}
	if err := waitForServiceRunning(context.Background(), func() (svc.Status, error) { return svc.Status{State: svc.Running}, nil }); err != nil {
		t.Fatal(err)
	}
}

func TestAdjacentLogRejectsHardlinkWithoutChangingTarget(t *testing.T) {
	d := t.TempDir()
	target := filepath.Join(d, "target.txt")
	os.WriteFile(target, []byte("original"), 0600)
	if err := os.Link(target, filepath.Join(d, "setup.log")); err != nil {
		t.Skip(err)
	}
	r, err := OpenReport(filepath.Join(d, "setup.exe"))
	if err == nil {
		r.Close()
		t.Fatal("hardlink accepted")
	}
	b, _ := os.ReadFile(target)
	if string(b) != "original" {
		t.Fatal("target modified")
	}
}

func TestInstallLockDistinguishesExistingAndReleases(t *testing.T) {
	name := "Local\\XPointSetupTest-" + strings.ReplaceAll(time.Now().Format("150405.000000000"), ".", "")
	lock, code, err := acquireSetupLock(name, nil)
	if err != nil || code != "" {
		t.Fatalf("first lock: %s %v", code, err)
	}
	_, code, err = acquireSetupLock(name, nil)
	if code != "BUSY" || !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		t.Fatalf("duplicate: %s %v", code, err)
	}
	windows.CloseHandle(lock)
	lock, code, err = acquireSetupLock(name, nil)
	if err != nil || code != "" {
		t.Fatalf("retry: %s %v", code, err)
	}
	windows.CloseHandle(lock)
	if lockError(windows.ERROR_ACCESS_DENIED) != "LOCK_ACCESS" || lockError(windows.ERROR_INVALID_HANDLE) != "LOCK" {
		t.Fatal("non-contention errors reported BUSY")
	}
}

func TestConfigurationTimeoutReportsExactOperation(t *testing.T) {
	r := &Report{}
	runner := fakeRunner(func(context.Context, string, ...string) (rustdesk.CommandResult, error) {
		return rustdesk.CommandResult{}, context.DeadlineExceeded
	})
	if err := configureReported(context.Background(), "RustDesk.exe", runner, r); err == nil {
		t.Fatal("timeout accepted")
	}
	events := r.Events()
	last := events[len(events)-1]
	if last.Operation != "ID_SERVER_WRITE" || last.Result != "ERROR" || last.Detail != "TIMEOUT" {
		t.Fatalf("imprecise event: %+v", last)
	}
}

func TestRecoveryDecisionPreservesEnrollment(t *testing.T) {
	r := receipt{"old", "org", "pc"}
	p := Provisioning{EnrollmentID: "new", OrganizationID: "org", DeviceDisplayName: "pc"}
	if recoveryDecision(r, p, false, false) != "REPLACE_UNUSED" {
		t.Fatal("unused attempt not recoverable")
	}
	if recoveryDecision(r, p, true, false) != "RECONCILIATION" {
		t.Fatal("uncertain attempt replay allowed")
	}
	if recoveryDecision(r, p, true, true) != "RESUME" {
		t.Fatal("saved credentials cannot resume")
	}
	p.OrganizationID = "other"
	if recoveryDecision(r, p, true, true) != "EXISTING_INSTALLATION" {
		t.Fatal("tenant change allowed")
	}
}

func TestServiceProgressKeepsCauseAndRejectsOldInstallations(t *testing.T) {
	now := time.Now()
	r := &Report{}
	p := serviceProgress{"enrollment", now, []Event{{now.Add(time.Millisecond), 5, "ENROLLMENT_REQUEST", "ERROR", "TRANSPORT_ERROR"}, {now.Add(2 * time.Millisecond), 5, "ENROLLMENT_STATE", "ERROR", "RECONCILIATION"}}}
	b, _ := json.Marshal(p)
	for _, test := range []struct {
		id    string
		start time.Time
	}{{"other", now}, {"enrollment", now.Add(time.Second)}} {
		_, failure := mergeServiceProgress(r, b, test.id, test.start, time.Time{})
		if failure != "" || len(r.Events()) != 0 {
			t.Fatal("old/foreign error accepted")
		}
	}
	last, failure := mergeServiceProgress(r, b, "enrollment", now, time.Time{})
	if failure != "RECONCILIATION" || len(r.Events()) != 2 || r.Events()[0].Detail != "TRANSPORT_ERROR" {
		t.Fatal("root cause dropped")
	}
	mergeServiceProgress(r, b, "enrollment", now, last)
	if len(r.Events()) != 2 {
		t.Fatal("duplicate events")
	}
}
