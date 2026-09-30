package rustdesk

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type runnerFunc func(context.Context, string, ...string) (CommandResult, error)

func (f runnerFunc) Run(ctx context.Context, executable string, args ...string) (CommandResult, error) {
	return f(ctx, executable, args...)
}

func writeFakeExecutable(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func metadataRunner(t *testing.T, wantPath, idOutput, versionOutput string) CommandRunner {
	t.Helper()
	return runnerFunc(func(_ context.Context, executable string, args ...string) (CommandResult, error) {
		if executable != wantPath {
			t.Fatalf("executable = %q, want %q", executable, wantPath)
		}
		if len(args) != 1 {
			t.Fatalf("args = %q, want one metadata argument", args)
		}
		switch args[0] {
		case "--get-id":
			return CommandResult{Stdout: []byte(idOutput)}, nil
		case "--version":
			return CommandResult{Stdout: []byte(versionOutput)}, nil
		default:
			t.Fatalf("unexpected argument %q", args[0])
			return CommandResult{}, nil
		}
	})
}

func TestDiscoverSupportedInstallPaths(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name string
		path string
		opts Options
	}{
		{"Program Files x64", filepath.Join(root, "Program Files", "RustDesk", "RustDesk.exe"), Options{ProgramFiles: filepath.Join(root, "Program Files")}},
		{"Program Files x86", filepath.Join(root, "Program Files (x86)", "RustDesk", "RustDesk.exe"), Options{ProgramFilesX86: filepath.Join(root, "Program Files (x86)")}},
		{"LocalAppData Programs", filepath.Join(root, "LocalAppData", "Programs", "RustDesk", "RustDesk.exe"), Options{LocalAppData: filepath.Join(root, "LocalAppData")}},
		{"LocalAppData direct", filepath.Join(root, "LocalAppDataDirect", "RustDesk", "RustDesk.exe"), Options{LocalAppData: filepath.Join(root, "LocalAppDataDirect")}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			writeFakeExecutable(t, tt.path)
			client, err := NewClient(metadataRunner(t, tt.path, "RustDesk ID: 123 456 789\r\n", "rustdesk 1.4.3\r\n"), tt.opts)
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}
			info, err := client.Discover(context.Background())
			if err != nil {
				t.Fatalf("Discover() error = %v", err)
			}
			if info.ExecutablePath != tt.path || info.ID != "123456789" || info.Version != "1.4.3" {
				t.Fatalf("Discover() = %#v", info)
			}
		})
	}
}

func TestDiscoverUsesValidatedExplicitOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RustDesk.exe")
	writeFakeExecutable(t, path)
	client, err := NewClient(metadataRunner(t, path, "123456789\n", "1.4.4\n"), Options{ExecutablePath: path})
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	info, err := client.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover() error = %v", err)
	}
	if info.ExecutablePath != path {
		t.Fatalf("ExecutablePath = %q, want %q", info.ExecutablePath, path)
	}
}

func TestNewClientRejectsUnsafeExplicitOverride(t *testing.T) {
	for _, path := range []string{"RustDesk.exe", filepath.Join(t.TempDir(), "other.exe"), filepath.Join(t.TempDir(), "RustDesk.exe") + "\x00suffix"} {
		if _, err := NewClient(runnerFunc(nil), Options{ExecutablePath: path}); err == nil {
			t.Fatalf("NewClient(%q) succeeded", path)
		}
	}
}

func TestDiscoverMissingIsActionable(t *testing.T) {
	client, err := NewClient(runnerFunc(func(context.Context, string, ...string) (CommandResult, error) {
		t.Fatal("runner called without an installed executable")
		return CommandResult{}, nil
	}), Options{ProgramFiles: filepath.Join(t.TempDir(), "Program Files")})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Discover(context.Background())
	if err == nil || !strings.Contains(err.Error(), "install RustDesk") || !strings.Contains(err.Error(), "explicit executable path") {
		t.Fatalf("Discover() error = %v, want actionable installation guidance", err)
	}
}

func TestDiscoverParsesOnlyBoundedValidMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RustDesk.exe")
	writeFakeExecutable(t, path)
	tests := []struct{ name, id, version, wantErr, outputFragment string }{
		{"malformed ID", "not-an-id", "1.4.3", "invalid RustDesk ID", "not-an-id"},
		{"ambiguous ID", "123456789\n987654321", "1.4.3", "invalid RustDesk ID", "987654321"},
		{"oversized ID", strings.Repeat("1", 4097), "1.4.3", "RustDesk ID output exceeds limit", strings.Repeat("1", 80)},
		{"malformed version", "123456789", "development-build", "invalid RustDesk version", "development-build"},
		{"ambiguous version", "123456789", "1.4.3\n1.4.4", "invalid RustDesk version", "1.4.4"},
		{"oversized version", "123456789", strings.Repeat("2", 4097), "RustDesk version output exceeds limit", strings.Repeat("2", 80)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewClient(metadataRunner(t, path, tt.id, tt.version), Options{ExecutablePath: path})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Discover(context.Background())
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("Discover() error = %v, want %q", err, tt.wantErr)
			}
			if strings.Contains(err.Error(), tt.outputFragment) {
				t.Fatalf("Discover() error disclosed command output: %v", err)
			}
		})
	}
}

func TestDiscoverHonorsTimeoutAndCancellation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RustDesk.exe")
	writeFakeExecutable(t, path)
	runner := runnerFunc(func(ctx context.Context, _ string, _ ...string) (CommandResult, error) {
		<-ctx.Done()
		return CommandResult{}, fmt.Errorf("private runner detail: %w", ctx.Err())
	})
	for _, tt := range []struct {
		name    string
		ctx     func() context.Context
		timeout time.Duration
		want    error
	}{
		{"client timeout", func() context.Context { return context.Background() }, 20 * time.Millisecond, context.DeadlineExceeded},
		{"caller cancellation", func() context.Context { ctx, cancel := context.WithCancel(context.Background()); cancel(); return ctx }, time.Second, context.Canceled},
	} {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewClient(runner, Options{ExecutablePath: path, CommandTimeout: tt.timeout})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Discover(tt.ctx())
			if !errors.Is(err, tt.want) || strings.Contains(err.Error(), "private runner detail") {
				t.Fatalf("Discover() error = %v", err)
			}
		})
	}
}

func TestDiscoverRejectsNonzeroExitWithoutCommandOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RustDesk.exe")
	writeFakeExecutable(t, path)
	client, err := NewClient(runnerFunc(func(context.Context, string, ...string) (CommandResult, error) {
		return CommandResult{ExitCode: 7, Stdout: []byte("private-stdout"), Stderr: []byte("private-stderr")}, nil
	}), Options{ExecutablePath: path})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Discover(context.Background())
	if err == nil || !strings.Contains(err.Error(), "RustDesk ID command failed") {
		t.Fatalf("Discover() error = %v", err)
	}
	for _, forbidden := range []string{"private-stdout", "private-stderr"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("Discover() error disclosed %q: %v", forbidden, err)
		}
	}
}

func TestSetUnattendedPasswordValidatesBeforeExecution(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RustDesk.exe")
	writeFakeExecutable(t, path)
	calls := 0
	client, err := NewClient(runnerFunc(func(context.Context, string, ...string) (CommandResult, error) { calls++; return CommandResult{}, nil }), Options{ExecutablePath: path})
	if err != nil {
		t.Fatal(err)
	}
	for _, password := range []string{"", "short", strings.Repeat("x", 129), "ValidPass1!\n", "ValidPass1!\x00"} {
		if err := client.SetUnattendedPassword(context.Background(), password); err == nil {
			t.Fatalf("SetUnattendedPassword(%q) succeeded", password)
		}
	}
	if calls != 0 {
		t.Fatalf("runner calls = %d, want 0", calls)
	}
}

func TestSetUnattendedPasswordUsesArgvAndRedactsAllFailures(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RustDesk.exe")
	writeFakeExecutable(t, path)
	password := "Unique-Password-4821!"
	t.Run("success", func(t *testing.T) {
		var captured []string
		stdout := []byte("Done!\r\n")
		stderr := []byte{}
		client, err := NewClient(runnerFunc(func(_ context.Context, executable string, args ...string) (CommandResult, error) {
			if executable != path || len(args) != 2 || args[0] != "--password" || args[1] != password {
				t.Fatalf("invocation = %q %#v", executable, args)
			}
			captured = args
			return CommandResult{Stdout: stdout, Stderr: stderr}, nil
		}), Options{ExecutablePath: path})
		if err != nil {
			t.Fatal(err)
		}
		if err := client.SetUnattendedPassword(context.Background(), password); err != nil {
			t.Fatalf("SetUnattendedPassword() error = %v", err)
		}
		if len(captured) != 2 || captured[1] != "" {
			t.Fatalf("password argv reference was not scrubbed: %#v", captured)
		}
		if !allZero(stdout) || !allZero(stderr) {
			t.Fatal("password command output buffers were not zeroized")
		}
	})
	for _, tt := range []struct {
		name   string
		result CommandResult
		err    error
	}{
		{"runner error", CommandResult{Stdout: []byte(password), Stderr: []byte(password)}, fmt.Errorf("runner exposed %s", password)},
		{"nonzero exit", CommandResult{ExitCode: 9, Stdout: []byte(password), Stderr: []byte(password)}, nil},
		{"zero exit refusal", CommandResult{Stdout: []byte("Settings are disabled!"), Stderr: []byte("private detail")}, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewClient(runnerFunc(func(context.Context, string, ...string) (CommandResult, error) { return tt.result, tt.err }), Options{ExecutablePath: path})
			if err != nil {
				t.Fatal(err)
			}
			err = client.SetUnattendedPassword(context.Background(), password)
			if err == nil || strings.Contains(err.Error(), password) || !strings.Contains(err.Error(), "configure RustDesk unattended password") {
				t.Fatalf("SetUnattendedPassword() error = %v", err)
			}
			if !allZero(tt.result.Stdout) || !allZero(tt.result.Stderr) {
				t.Fatal("password command failure buffers were not zeroized")
			}
		})
	}
}

func allZero(value []byte) bool {
	for _, element := range value {
		if element != 0 {
			return false
		}
	}
	return true
}

func TestExecRunnerCapturesBoundedOutputAndExitCode(t *testing.T) {
	t.Setenv("GO_WANT_RUSTDESK_HELPER_PROCESS", "1")
	t.Setenv("RUSTDESK_HELPER_MODE", "normal")
	result, err := NewExecRunner(64).Run(context.Background(), os.Args[0], "-test.run=TestRustDeskHelperProcess")
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if string(result.Stdout) != "helper stdout" || string(result.Stderr) != "helper stderr" || result.ExitCode != 17 {
		t.Fatalf("Run() = %#v", result)
	}
}

func TestExecRunnerLimitsStdoutAndStderr(t *testing.T) {
	for _, mode := range []string{"large-stdout", "large-stderr"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("GO_WANT_RUSTDESK_HELPER_PROCESS", "1")
			t.Setenv("RUSTDESK_HELPER_MODE", mode)
			result, err := NewExecRunner(32).Run(context.Background(), os.Args[0], "-test.run=TestRustDeskHelperProcess")
			if !errors.Is(err, ErrOutputLimit) {
				t.Fatalf("Run() = %#v, error = %v, want ErrOutputLimit", result, err)
			}
			if result.Stdout != nil || result.Stderr != nil {
				t.Fatalf("Run() returned output after limit failure: %#v", result)
			}
		})
	}
}

func TestExecRunnerHonorsContextTimeout(t *testing.T) {
	t.Setenv("GO_WANT_RUSTDESK_HELPER_PROCESS", "1")
	t.Setenv("RUSTDESK_HELPER_MODE", "sleep")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	result, err := NewExecRunner(64).Run(ctx, os.Args[0], "-test.run=TestRustDeskHelperProcess")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Run() error = %v, want deadline exceeded", err)
	}
	if result.Stdout != nil || result.Stderr != nil {
		t.Fatalf("Run() returned output after timeout: %#v", result)
	}
}

func TestRustDeskHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_RUSTDESK_HELPER_PROCESS") != "1" {
		return
	}
	switch os.Getenv("RUSTDESK_HELPER_MODE") {
	case "normal":
		_, _ = os.Stdout.WriteString("helper stdout")
		_, _ = os.Stderr.WriteString("helper stderr")
		os.Exit(17)
	case "large-stdout":
		_, _ = os.Stdout.WriteString(strings.Repeat("x", 128))
	case "large-stderr":
		_, _ = os.Stderr.WriteString(strings.Repeat("y", 128))
	case "sleep":
		time.Sleep(5 * time.Second)
	}
	os.Exit(0)
}
