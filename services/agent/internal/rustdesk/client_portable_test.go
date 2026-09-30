package rustdesk

import (
	"context"
	"errors"
	"testing"
)

type portableRunnerFunc func(context.Context, string, ...string) (CommandResult, error)

func (f portableRunnerFunc) Run(ctx context.Context, executable string, args ...string) (CommandResult, error) {
	return f(ctx, executable, args...)
}

func TestUnsupportedPlatformFailsBeforePathOrProcessAccess(t *testing.T) {
	called := false
	runner := portableRunnerFunc(func(context.Context, string, ...string) (CommandResult, error) {
		called = true
		return CommandResult{}, nil
	})
	client, err := newClient(false, runner, Options{ExecutablePath: `relative\RustDesk.exe`})
	if client != nil || !errors.Is(err, errors.ErrUnsupported) {
		t.Fatalf("newClient() = %#v, %v; want unsupported", client, err)
	}
	if called {
		t.Fatal("unsupported platform invoked runner")
	}
}
