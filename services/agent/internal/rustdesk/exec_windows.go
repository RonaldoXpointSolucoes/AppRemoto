//go:build windows

package rustdesk

import (
	"context"
	"errors"
	"io"
	"os"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const processCleanupTimeout = time.Second

type windowsExecRunner struct {
	maxOutputBytes int
	waitInstaller  bool
}

type pipeCapture struct {
	data     []byte
	overflow bool
}

type processWaitResult struct {
	exitCode uint32
	err      error
}

func newPlatformExecRunner(maxOutputBytes int) CommandRunner {
	return &windowsExecRunner{maxOutputBytes: maxOutputBytes}
}

func (r *windowsExecRunner) Run(ctx context.Context, executable string, args ...string) (CommandResult, error) {
	return r.run(ctx, executable, true, args...)
}

func (r *windowsExecRunner) RunTrusted(ctx context.Context, executable string, args ...string) (CommandResult, error) {
	return r.run(ctx, executable, true, args...)
}

func (r *windowsExecRunner) run(ctx context.Context, executable string, requireTrust bool, args ...string) (CommandResult, error) {
	if err := ctx.Err(); err != nil {
		return CommandResult{}, err
	}
	pinned, err := openPinnedExecutable(executable, requireTrust)
	if err != nil {
		return CommandResult{}, err
	}
	defer pinned.Close()
	if executablePinnedHook != nil {
		executablePinnedHook(executable)
	}

	stdoutRead, stdoutWrite, err := createProcessPipe()
	if err != nil {
		return CommandResult{}, errors.New("create command output pipe")
	}
	defer func() {
		if stdoutRead != 0 {
			_ = windows.CloseHandle(stdoutRead)
		}
		if stdoutWrite != 0 {
			_ = windows.CloseHandle(stdoutWrite)
		}
	}()
	stderrRead, stderrWrite, err := createProcessPipe()
	if err != nil {
		return CommandResult{}, errors.New("create command error pipe")
	}
	defer func() {
		if stderrRead != 0 {
			_ = windows.CloseHandle(stderrRead)
		}
		if stderrWrite != 0 {
			_ = windows.CloseHandle(stderrWrite)
		}
	}()
	input, err := openInheritedNullInput()
	if err != nil {
		return CommandResult{}, errors.New("open command input")
	}
	defer func() {
		if input != 0 {
			_ = windows.CloseHandle(input)
		}
	}()

	job, err := createKillOnCloseJob()
	if err != nil {
		return CommandResult{}, errors.New("create command process group")
	}
	jobOpen := true
	closeJob := func() {
		if jobOpen {
			_ = windows.CloseHandle(job)
			jobOpen = false
		}
	}
	defer closeJob()

	application, err := windows.UTF16PtrFromString(pinned.path)
	if err != nil {
		return CommandResult{}, errors.New("prepare command executable")
	}
	commandArgs := make([]string, 0, len(args)+1)
	commandArgs = append(commandArgs, pinned.path)
	commandArgs = append(commandArgs, args...)
	commandLine, err := windows.UTF16FromString(windows.ComposeCommandLine(commandArgs))
	for index := range commandArgs {
		commandArgs[index] = ""
	}
	if err != nil {
		return CommandResult{}, errors.New("prepare command arguments")
	}
	defer clear(commandLine)
	defer func() {
		for index := range args {
			args[index] = ""
		}
	}()

	startup := windows.StartupInfo{
		Cb:        uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Flags:     windows.STARTF_USESTDHANDLES,
		StdInput:  input,
		StdOutput: stdoutWrite,
		StdErr:    stderrWrite,
	}
	var process windows.ProcessInformation
	if err := windows.CreateProcess(application, &commandLine[0], nil, nil, true,
		windows.CREATE_SUSPENDED, nil, nil, &startup, &process); err != nil {
		return CommandResult{}, errors.New("start command failed")
	}
	if processCreatedHook != nil {
		processCreatedHook()
	}
	defer windows.CloseHandle(process.Process)
	defer windows.CloseHandle(process.Thread)
	if err := windows.AssignProcessToJobObject(job, process.Process); err != nil {
		_ = windows.TerminateProcess(process.Process, 1)
		return CommandResult{}, errors.New("contain command process tree")
	}

	stdoutFile := os.NewFile(uintptr(stdoutRead), "rustdesk-stdout")
	stderrFile := os.NewFile(uintptr(stderrRead), "rustdesk-stderr")
	stdoutRead = 0
	stderrRead = 0
	stdoutDone := capturePipe(stdoutFile, r.maxOutputBytes)
	stderrDone := capturePipe(stderrFile, r.maxOutputBytes)
	_ = windows.CloseHandle(stdoutWrite)
	stdoutWrite = 0
	_ = windows.CloseHandle(stderrWrite)
	stderrWrite = 0
	_ = windows.CloseHandle(input)
	input = 0

	if _, err := windows.ResumeThread(process.Thread); err != nil {
		_ = windows.TerminateJobObject(job, 1)
		closeJob()
		closeCaptureFiles(stdoutFile, stderrFile)
		return CommandResult{}, errors.New("resume command failed")
	}
	waitDone := waitForProcess(process.Process)

	var waited processWaitResult
	cancelled := false
	select {
	case waited = <-waitDone:
	case <-ctx.Done():
		cancelled = true
		_ = windows.TerminateJobObject(job, 1)
		closeJob()
		select {
		case waited = <-waitDone:
		case <-time.After(processCleanupTimeout):
			closeCaptureFiles(stdoutFile, stderrFile)
			return CommandResult{}, ctx.Err()
		}
	}
	if r.waitInstaller && !cancelled && waited.err == nil && waited.exitCode == 0 {
		if err := waitInstallerChildren(ctx, job, process.ProcessId); err != nil {
			_ = windows.TerminateJobObject(job, 1)
			closeJob()
			closeCaptureFiles(stdoutFile, stderrFile)
			return CommandResult{}, err
		}
	}
	closeJob()
	stdout, stderr, captureErr := collectCaptures(stdoutDone, stderrDone, stdoutFile, stderrFile)
	if cancelled {
		clear(stdout.data)
		clear(stderr.data)
		return CommandResult{}, ctx.Err()
	}
	if waited.err != nil || captureErr != nil {
		clear(stdout.data)
		clear(stderr.data)
		return CommandResult{}, errors.New("wait for command failed")
	}
	if stdout.overflow || stderr.overflow {
		clear(stdout.data)
		clear(stderr.data)
		return CommandResult{}, ErrOutputLimit
	}
	return CommandResult{Stdout: stdout.data, Stderr: stderr.data, ExitCode: int(waited.exitCode)}, nil
}

func createProcessPipe() (windows.Handle, windows.Handle, error) {
	attributes := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	var read, write windows.Handle
	if err := windows.CreatePipe(&read, &write, &attributes, 0); err != nil {
		return 0, 0, err
	}
	if err := windows.SetHandleInformation(read, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(read)
		windows.CloseHandle(write)
		return 0, 0, err
	}
	return read, write, nil
}

func openInheritedNullInput() (windows.Handle, error) {
	name, err := windows.UTF16PtrFromString("NUL")
	if err != nil {
		return 0, err
	}
	attributes := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	return windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		&attributes, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
}

func createKillOnCloseJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		windows.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

func waitForProcess(process windows.Handle) <-chan processWaitResult {
	done := make(chan processWaitResult, 1)
	go func() {
		status, err := windows.WaitForSingleObject(process, windows.INFINITE)
		if err != nil || status != windows.WAIT_OBJECT_0 {
			done <- processWaitResult{err: errors.New("process wait failed")}
			return
		}
		var exitCode uint32
		if err := windows.GetExitCodeProcess(process, &exitCode); err != nil {
			done <- processWaitResult{err: errors.New("read process exit code failed")}
			return
		}
		done <- processWaitResult{exitCode: exitCode}
	}()
	return done
}

func capturePipe(file *os.File, limit int) <-chan pipeCapture {
	done := make(chan pipeCapture, 1)
	go func() {
		buffer := cappedBuffer{limit: limit}
		_, _ = io.Copy(&buffer, file)
		done <- pipeCapture{data: append([]byte(nil), buffer.Bytes()...), overflow: buffer.overflow}
	}()
	return done
}

func collectCaptures(stdoutDone, stderrDone <-chan pipeCapture, stdoutFile, stderrFile *os.File) (pipeCapture, pipeCapture, error) {
	var stdout, stderr pipeCapture
	for received := 0; received < 2; {
		select {
		case stdout = <-stdoutDone:
			stdoutDone = nil
			received++
		case stderr = <-stderrDone:
			stderrDone = nil
			received++
		case <-time.After(processCleanupTimeout):
			closeCaptureFiles(stdoutFile, stderrFile)
			return pipeCapture{}, pipeCapture{}, errors.New("pipe cleanup timed out")
		}
	}
	closeCaptureFiles(stdoutFile, stderrFile)
	return stdout, stderr, nil
}

func closeCaptureFiles(files ...*os.File) {
	for _, file := range files {
		if file != nil {
			_ = file.Close()
		}
	}
}
