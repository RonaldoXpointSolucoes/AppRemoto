package rustdesk

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
)

const defaultOutputLimit = 16 * 1024

var ErrOutputLimit = errors.New("command output exceeds limit")

type CommandResult struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

type CommandRunner interface {
	Run(ctx context.Context, executable string, args ...string) (CommandResult, error)
}

type execRunner struct {
	maxOutputBytes int
}

func NewExecRunner(maxOutputBytes int) CommandRunner {
	if maxOutputBytes <= 0 {
		maxOutputBytes = defaultOutputLimit
	}
	return &execRunner{maxOutputBytes: maxOutputBytes}
}

func (r *execRunner) Run(ctx context.Context, executable string, args ...string) (CommandResult, error) {
	if err := ctx.Err(); err != nil {
		return CommandResult{}, err
	}

	stdout := cappedBuffer{limit: r.maxOutputBytes}
	stderr := cappedBuffer{limit: r.maxOutputBytes}
	cmd := exec.CommandContext(ctx, executable, args...)
	defer func() {
		for i := range cmd.Args {
			cmd.Args[i] = ""
		}
		for i := range args {
			args[i] = ""
		}
	}()
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()

	if contextErr := ctx.Err(); contextErr != nil {
		return CommandResult{}, contextErr
	}
	if stdout.overflow || stderr.overflow {
		return CommandResult{}, ErrOutputLimit
	}

	result := CommandResult{
		Stdout: append([]byte(nil), stdout.Bytes()...),
		Stderr: append([]byte(nil), stderr.Bytes()...),
	}
	if err == nil {
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, nil
	}
	return CommandResult{}, errors.New("start or wait for command failed")
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
