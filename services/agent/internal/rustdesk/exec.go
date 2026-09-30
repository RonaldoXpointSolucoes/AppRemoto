package rustdesk

import (
	"bytes"
	"context"
	"errors"
)

const defaultOutputLimit = 16 * 1024

var ErrOutputLimit = errors.New("command output exceeds limit")

var ErrUntrustedExecutable = errors.New("trusted RustDesk installation required; install RustDesk under administrator-managed permissions")

type CommandResult struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

type CommandRunner interface {
	Run(ctx context.Context, executable string, args ...string) (CommandResult, error)
}

type trustedCommandRunner interface {
	RunTrusted(ctx context.Context, executable string, args ...string) (CommandResult, error)
}

func NewExecRunner(maxOutputBytes int) CommandRunner {
	if maxOutputBytes <= 0 {
		maxOutputBytes = defaultOutputLimit
	}
	return newPlatformExecRunner(maxOutputBytes)
}

type cappedBuffer struct {
	buffer   bytes.Buffer
	limit    int
	overflow bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	written := len(p)
	remaining := b.limit - b.buffer.Len()
	if remaining < len(p) {
		b.overflow = true
		if remaining > 0 {
			_, _ = b.buffer.Write(p[:remaining])
		}
		return written, nil
	}
	_, _ = b.buffer.Write(p)
	return written, nil
}

func (b *cappedBuffer) Bytes() []byte {
	return b.buffer.Bytes()
}
