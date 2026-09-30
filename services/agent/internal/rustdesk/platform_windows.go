//go:build windows

package rustdesk

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const dangerousExecutableAccess = windows.GENERIC_WRITE | windows.GENERIC_ALL |
	windows.DELETE | windows.WRITE_DAC | windows.WRITE_OWNER |
	windows.FILE_WRITE_DATA | windows.FILE_APPEND_DATA

var (
	executablePinnedHook func(string)
	processCreatedHook   func()
)

type pinnedExecutable struct {
	handle windows.Handle
	path   string
}

func platformSupported() bool { return true }

func knownInstallRoots() (string, string, string, string, error) {
	programFiles, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return "", "", "", "", err
	}
	programFilesX64, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFilesX64, 0)
	if err != nil {
		programFilesX64 = ""
	}
	programFilesX86, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFilesX86, 0)
	if err != nil {
		programFilesX86 = ""
	}
	localAppData, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return "", "", "", "", err
	}
	return cleanOptionalPath(programFiles), cleanOptionalPath(programFilesX64),
		cleanOptionalPath(programFilesX86), cleanOptionalPath(localAppData), nil
}

func cleanOptionalPath(path string) string {
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}

func validatePlatformLocalPath(path string) error {
	volume := filepath.VolumeName(path)
	if len(volume) != 2 {
		return errors.New("path is not on a local drive")
	}
	root, err := windows.UTF16PtrFromString(volume + `\`)
	if err != nil {
		return err
	}
	if windows.GetDriveType(root) != windows.DRIVE_FIXED {
		return errors.New("path is not on a fixed local drive")
	}
	return nil
}

func openPinnedExecutable(path string, requireTrust bool) (*pinnedExecutable, error) {
	if validateLocalAbsolutePath(path) != nil || validatePlatformLocalPath(path) != nil {
		return nil, ErrUntrustedExecutable
	}
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, ErrUntrustedExecutable
	}
	handle, err := windows.CreateFile(pointer,
		windows.GENERIC_READ|windows.READ_CONTROL|windows.SYNCHRONIZE,
		windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, errors.New("open RustDesk executable securely")
	}
	pinned := &pinnedExecutable{handle: handle, path: path}
	if err := pinned.validate(path, requireTrust); err != nil {
		pinned.Close()
		return nil, err
	}
	return pinned, nil
}

func (p *pinnedExecutable) Close() error {
	if p == nil || p.handle == 0 {
		return nil
	}
	err := windows.CloseHandle(p.handle)
	p.handle = 0
	return err
}

func (p *pinnedExecutable) validate(requested string, requireTrust bool) error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(p.handle, &info); err != nil {
		return errors.New("inspect RustDesk executable")
	}
	if info.FileAttributes&(windows.FILE_ATTRIBUTE_DIRECTORY|windows.FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
		return ErrUntrustedExecutable
	}
	if err := verifyPinnedExecutablePath(p.handle, requested); err != nil {
		return err
	}
	if requireTrust {
		if err := validateExecutableTrust(p.handle); err != nil {
			return ErrUntrustedExecutable
		}
	}
	return nil
}

func verifyPinnedExecutablePath(handle windows.Handle, requested string) error {
	const fileNameOpened = 0x8
	actual := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(handle, &actual[0], uint32(len(actual)), fileNameOpened)
	if err != nil || n == 0 || n >= uint32(len(actual)) {
		return errors.New("inspect RustDesk executable final path")
	}
	if !strings.EqualFold(normalizeWindowsPath(requested), normalizeWindowsPath(windows.UTF16ToString(actual))) {
		return errors.New("RustDesk executable path was redirected")
	}
	return nil
}

func normalizeWindowsPath(path string) string {
	if strings.HasPrefix(path, `\\?\UNC\`) {
		path = `\\` + path[len(`\\?\UNC\`):]
	} else {
		path = strings.TrimPrefix(path, `\\?\`)
	}
	return filepath.Clean(path)
}

func validateExecutableTrust(handle windows.Handle) error {
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("RustDesk executable owner is missing")
	}
	systemSID, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		return err
	}
	administratorsSID, err := windows.StringToSid("S-1-5-32-544")
	if err != nil {
		return err
	}
	trustedInstallerSID, err := windows.StringToSid("S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")
	if err != nil {
		return err
	}
	if !owner.Equals(systemSID) && !owner.Equals(administratorsSID) && !owner.Equals(trustedInstallerSID) {
		return errors.New("RustDesk executable owner is untrusted")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return errors.New("RustDesk executable DACL is missing")
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return fmt.Errorf("read RustDesk executable ACL: %w", err)
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return errors.New("RustDesk executable DACL contains an unsupported allow entry")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		trusted := sid.Equals(systemSID) || sid.Equals(administratorsSID) || sid.Equals(trustedInstallerSID)
		if !trusted && ace.Mask&dangerousExecutableAccess != 0 {
			return errors.New("RustDesk executable is writable by an untrusted principal")
		}
	}
	runtime.KeepAlive(systemSID)
	runtime.KeepAlive(administratorsSID)
	runtime.KeepAlive(trustedInstallerSID)
	return nil
}
