//go:build !windows

package rustdesk

import (
	"context"
	"errors"
)

type unsupportedRunner struct{}

func newPlatformExecRunner(int) CommandRunner { return unsupportedRunner{} }

func (unsupportedRunner) Run(context.Context, string, ...string) (CommandResult, error) {
	return CommandResult{}, errors.ErrUnsupported
}

func (unsupportedRunner) RunTrusted(context.Context, string, ...string) (CommandResult, error) {
	return CommandResult{}, errors.ErrUnsupported
}
