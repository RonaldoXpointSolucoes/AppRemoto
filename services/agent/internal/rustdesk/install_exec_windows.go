//go:build windows

package rustdesk

import (
	"context"
	"errors"
	"golang.org/x/sys/windows"
	"time"
	"unsafe"
)

// NewInstallerRunner retains the contained installer's direct child after a
// self-extracting launcher exits. The normal password/metadata runner is unchanged.
func NewInstallerRunner(maxOutputBytes int) CommandRunner {
	if maxOutputBytes <= 0 {
		maxOutputBytes = defaultOutputLimit
	}
	return &windowsExecRunner{maxOutputBytes: maxOutputBytes, waitInstaller: true}
}

// The pinned portable launcher spawns the real installer as its direct child.
// Its installer may leave a long-running tray grandchild. Pin direct-child handles,
// wait for them, then close the job to clean up only the contained leftovers.
func waitInstallerChildren(ctx context.Context, job windows.Handle, parent uint32) error {
	var list struct {
		Assigned uint32
		Count    uint32
		IDs      [256]uintptr
	}
	if e := windows.QueryInformationJobObject(job, windows.JobObjectBasicProcessIdList, uintptr(unsafe.Pointer(&list)), uint32(unsafe.Sizeof(list)), nil); e != nil {
		return errors.New("inspect installer process tree")
	}
	if list.Count > 256 || list.Assigned > 256 {
		return errors.New("installer process tree exceeds limit")
	}
	children := []windows.Handle{}
	defer func() {
		for _, h := range children {
			windows.CloseHandle(h)
		}
	}()
	for _, pid := range list.IDs[:list.Count] {
		if pid == uintptr(parent) {
			continue
		}
		h, e := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
		if errors.Is(e, windows.ERROR_INVALID_PARAMETER) {
			continue
		}
		if e != nil {
			return errors.New("pin installer process")
		}
		var info windows.PROCESS_BASIC_INFORMATION
		e = windows.NtQueryInformationProcess(h, windows.ProcessBasicInformation, unsafe.Pointer(&info), uint32(unsafe.Sizeof(info)), nil)
		if e != nil {
			windows.CloseHandle(h)
			return errors.New("inspect installer ancestry")
		}
		if info.InheritedFromUniqueProcessId == uintptr(parent) {
			children = append(children, h)
		} else {
			windows.CloseHandle(h)
		}
	}
	for _, h := range children {
		for {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			status, e := windows.WaitForSingleObject(h, 50)
			if e != nil {
				return errors.New("wait installer child")
			}
			if status == windows.WAIT_OBJECT_0 {
				var code uint32
				if windows.GetExitCodeProcess(h, &code) != nil || code != 0 {
					return errors.New("installer child failed")
				}
				break
			}
			if status != uint32(windows.WAIT_TIMEOUT) {
				return errors.New("installer child wait failed")
			}
		}
	}
	// Let any pending cancellation win before installation completion is reported.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Millisecond):
		return nil
	}
}
