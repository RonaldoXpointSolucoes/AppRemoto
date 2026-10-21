//go:build windows

package rustdesk

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// NewInstallerRunner retains the contained installer's direct child after a
// self-extracting launcher exits. The normal password/metadata runner is unchanged.
func NewInstallerRunner(maxOutputBytes int) CommandRunner {
	if maxOutputBytes <= 0 {
		maxOutputBytes = defaultOutputLimit
	}
	return &windowsExecRunner{maxOutputBytes: maxOutputBytes, waitInstaller: true}
}

func isShortLivedInstallHelper(proc windows.Handle) bool {
	var size uint32 = 1024
	buf := make([]uint16, size)
	if err := windows.QueryFullProcessImageName(proc, 0, &buf[0], &size); err != nil || size == 0 {
		return false
	}
	base := strings.ToLower(filepath.Base(windows.UTF16ToString(buf[:size])))
	switch base {
	case "cmd.exe", "xcopy.exe", "sc.exe", "reg.exe", "netsh.exe", "cscript.exe", "wscript.exe":
		return true
	default:
		return false
	}
}

// The pinned portable launcher spawns the real installer as its direct child.
// Its installer may leave a long-running tray grandchild, while also invoking
// short-lived batch utilities (cmd/xcopy/sc) to copy files and register the service.
// Pin direct-child handles, wait for them and any active batch utilities, then close
// the job to clean up only the contained leftovers.
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
	// If the direct child spawned short-lived batch tools (cmd.exe / xcopy.exe / sc.exe),
	// let them finish copying files and registering the service before closing the job.
	helperDeadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(helperDeadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var active struct {
			Assigned uint32
			Count    uint32
			IDs      [256]uintptr
		}
		if e := windows.QueryInformationJobObject(job, windows.JobObjectBasicProcessIdList, uintptr(unsafe.Pointer(&active)), uint32(unsafe.Sizeof(active)), nil); e != nil {
			break
		}
		hasHelper := false
		for i := uint32(0); i < active.Count && i < 256; i++ {
			pid := active.IDs[i]
			if pid == uintptr(parent) {
				continue
			}
			h, e := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
			if e != nil {
				continue
			}
			if isShortLivedInstallHelper(h) {
				hasHelper = true
				_, _ = windows.WaitForSingleObject(h, 150)
			}
			windows.CloseHandle(h)
		}
		if !hasHelper {
			break
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
