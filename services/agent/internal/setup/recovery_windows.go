//go:build windows

package setup

import (
	"errors"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/windows"
)

// SYSTEM owns the enrollment files. An elevated installer only inspects their
// metadata using its existing backup-read privilege; it never reads credential
// bytes or changes ACLs/owners. The service validates contents before reuse.
func privateExists(path string) (exists bool, err error) {
	var process, scoped windows.Token
	if err = windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_DUPLICATE|windows.TOKEN_QUERY, &process); err != nil {
		return false, err
	}
	defer process.Close()
	if err = windows.DuplicateTokenEx(process, windows.TOKEN_QUERY|windows.TOKEN_IMPERSONATE|windows.TOKEN_ADJUST_PRIVILEGES, nil, windows.SecurityImpersonation, windows.TokenImpersonation, &scoped); err != nil {
		return false, err
	}
	defer scoped.Close()
	var privilege windows.LUID
	if err = windows.LookupPrivilegeValue(nil, ptr("SeBackupPrivilege"), &privilege); err != nil {
		return false, err
	}
	requested := windows.Tokenprivileges{PrivilegeCount: 1, Privileges: [1]windows.LUIDAndAttributes{{Luid: privilege, Attributes: windows.SE_PRIVILEGE_ENABLED}}}
	if err = windows.AdjustTokenPrivileges(scoped, false, &requested, 0, nil, nil); err != nil {
		return false, err
	}
	runtime.LockOSThread()
	var prior windows.Token
	if probe := windows.OpenThreadToken(windows.CurrentThread(), windows.TOKEN_QUERY, true, &prior); !errors.Is(probe, windows.ERROR_NO_TOKEN) {
		if probe == nil {
			prior.Close()
		}
		runtime.UnlockOSThread()
		return false, errStage
	}
	if err = windows.SetThreadToken(nil, scoped); err != nil {
		runtime.UnlockOSThread()
		return false, err
	}
	defer func() {
		if restore := windows.RevertToSelf(); restore != nil {
			exists, err = false, restore
			// Do not return an impersonating thread to the Go scheduler.
			return
		}
		runtime.UnlockOSThread()
	}()
	var parents []windows.Handle
	defer func() {
		for _, h := range parents {
			windows.CloseHandle(h)
		}
	}()
	for parent := filepath.Dir(path); ; parent = filepath.Dir(parent) {
		h, e := openRecoveryMetadata(parent)
		if errors.Is(e, windows.ERROR_FILE_NOT_FOUND) || errors.Is(e, windows.ERROR_PATH_NOT_FOUND) {
			return false, nil
		}
		if e != nil {
			return false, e
		}
		parents = append(parents, h)
		var info windows.ByHandleFileInformation
		if e = windows.GetFileInformationByHandle(h, &info); e != nil {
			return false, e
		}
		if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
			return false, errStage
		}
		if filepath.Dir(parent) == parent {
			break
		}
	}
	h, e := openRecoveryMetadata(path)
	if errors.Is(e, windows.ERROR_FILE_NOT_FOUND) || errors.Is(e, windows.ERROR_PATH_NOT_FOUND) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	defer windows.CloseHandle(h)
	if e = trustedHandle(h); e != nil {
		return false, e
	}
	var info windows.ByHandleFileInformation
	if e = windows.GetFileInformationByHandle(h, &info); e != nil {
		return false, e
	}
	if info.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 || info.FileSizeHigh != 0 || info.FileSizeLow > 128<<10 {
		return false, errStage
	}
	return true, nil
}

func openRecoveryMetadata(path string) (windows.Handle, error) {
	return windows.CreateFile(ptr(path), windows.READ_CONTROL|windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
}
