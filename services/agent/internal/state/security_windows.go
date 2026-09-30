//go:build windows

package state

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

const fileAllAccess windows.ACCESS_MASK = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0x1ff

func validateIdentityPath(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve identity path: %w", err)
	}
	volume := filepath.VolumeName(abs)
	if volume == "" {
		return errors.New("identity path has no Windows volume")
	}
	parent := filepath.Dir(abs)
	current := volume + string(os.PathSeparator)
	relative := stringsTrimLeadingSeparator(parent[len(volume):])
	for _, component := range splitPathComponents(relative) {
		current = filepath.Join(current, component)
		attributes, err := getFileAttributes(current)
		if err != nil {
			return fmt.Errorf("inspect identity path component: %w", err)
		}
		if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return errors.New("identity path contains a reparse point")
		}
		if attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
			return errors.New("identity parent path is not a directory")
		}
	}

	attributes, err := getFileAttributes(abs)
	if err == nil {
		if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return errors.New("identity file is a reparse point")
		}
		if attributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
			return errors.New("identity path is a directory")
		}
		return nil
	}
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND) {
		return nil
	}
	return fmt.Errorf("inspect identity file: %w", err)
}

func stringsTrimLeadingSeparator(path string) string {
	for len(path) > 0 && os.IsPathSeparator(path[0]) {
		path = path[1:]
	}
	return path
}

func splitPathComponents(path string) []string {
	var components []string
	for path != "" && path != "." {
		dir, base := filepath.Split(path)
		if base != "" {
			components = append([]string{base}, components...)
		}
		path = filepath.Clean(dir)
		path = stringsTrimLeadingSeparator(path)
	}
	return components
}

func getFileAttributes(value string) (uint32, error) {
	pointer, err := windows.UTF16PtrFromString(value)
	if err != nil {
		return 0, err
	}
	return windows.GetFileAttributes(pointer)
}

func restrictIdentityFile(path string) error {
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return err
	}
	entries := []windows.EXPLICIT_ACCESS{
		allowFullAccess(userSID, windows.TRUSTEE_IS_USER),
	}
	if !userSID.Equals(systemSID) {
		entries = append(entries, allowFullAccess(systemSID, windows.TRUSTEE_IS_WELL_KNOWN_GROUP))
	}
	acl, err := windows.ACLFromEntries(entries, nil)
	if err != nil {
		return fmt.Errorf("build identity ACL: %w", err)
	}
	runtime.KeepAlive(userSID)
	runtime.KeepAlive(systemSID)
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, acl, nil); err != nil {
		return fmt.Errorf("set identity ACL: %w", err)
	}
	return validateRestrictedACL(path)
}

func allowFullAccess(sid *windows.SID, trusteeType windows.TRUSTEE_TYPE) windows.EXPLICIT_ACCESS {
	return windows.EXPLICIT_ACCESS{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.GRANT_ACCESS,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  trusteeType,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}
}

func identitySIDs() (*windows.SID, *windows.SID, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, nil, fmt.Errorf("get current user SID: %w", err)
	}
	system, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		return nil, nil, fmt.Errorf("get SYSTEM SID: %w", err)
	}
	return user.User.Sid, system, nil
}

func validateRestrictedACL(path string) error {
	descriptor, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return fmt.Errorf("read identity ACL: %w", err)
	}
	return validateSecurityDescriptor(descriptor)
}

func validateSecurityDescriptor(descriptor *windows.SECURITY_DESCRIPTOR) error {
	control, _, err := descriptor.Control()
	if err != nil {
		return fmt.Errorf("read identity ACL control: %w", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("identity ACL inherits permissions")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return errors.New("identity ACL is missing")
	}
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return err
	}
	expected := map[string]bool{userSID.String(): false, systemSID.String(): false}
	if int(dacl.AceCount) != len(expected) {
		return errors.New("identity ACL contains unexpected entries")
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return fmt.Errorf("read identity ACL entry: %w", err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags&windows.INHERITED_ACE != 0 {
			return errors.New("identity ACL contains an unsafe entry")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		key := sid.String()
		if _, ok := expected[key]; !ok || expected[key] {
			return errors.New("identity ACL grants an unexpected principal")
		}
		if ace.Mask != fileAllAccess {
			return errors.New("identity ACL entry does not grant full control")
		}
		expected[key] = true
	}
	for _, present := range expected {
		if !present {
			return errors.New("identity ACL is missing a required principal")
		}
	}
	return nil
}

func openValidatedIdentity(path string) (io.ReadCloser, error) {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(pointer, windows.GENERIC_READ|windows.READ_CONTROL,
		windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		windows.CloseHandle(handle)
		return nil, errors.New("identity file is not a regular file")
	}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}
	if err := validateSecurityDescriptor(descriptor); err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}
	return os.NewFile(uintptr(handle), path), nil
}

func lstatRegularIdentityFile(path string) (os.FileInfo, error) {
	attributes, err := getFileAttributes(path)
	if err != nil {
		return nil, err
	}
	if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || attributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		return nil, errors.New("temporary identity is not a regular file")
	}
	return os.Lstat(path)
}

func syncIdentityDirectory(dir string) error {
	pointer, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(pointer, windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return windows.FlushFileBuffers(handle)
}
