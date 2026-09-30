//go:build windows

package rustdesk

import "context"

type untrustedTestExecRunner struct {
	runner *windowsExecRunner
}

func newUntrustedTestExecRunner(maxOutputBytes int) CommandRunner {
	return untrustedTestExecRunner{runner: &windowsExecRunner{maxOutputBytes: maxOutputBytes}}
}

func (r untrustedTestExecRunner) Run(ctx context.Context, executable string, args ...string) (CommandResult, error) {
	return r.runner.run(ctx, executable, false, args...)
}
