//go:build windows

package state

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const fileAllAccess windows.ACCESS_MASK = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0x1ff

const directoryDangerousAccess windows.ACCESS_MASK = windows.GENERIC_ALL | windows.GENERIC_WRITE |
	windows.DELETE | windows.WRITE_DAC | windows.WRITE_OWNER | windows.FILE_WRITE_DATA |
	windows.FILE_APPEND_DATA | 0x40 // FILE_DELETE_CHILD

const (
	fileAddSubdirectory     = 0x00000004
	fileOpened              = 0x00000001
	directoryTraverseAccess = windows.FILE_TRAVERSE | windows.FILE_READ_ATTRIBUTES | windows.SYNCHRONIZE
)

var identityDirectoryParentPinnedHook = func() error { return nil }

type identityDirectory struct {
	handle windows.Handle
	path   string
}

func openIdentityDirectory(path string) (*identityDirectory, error) {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(pointer, windows.GENERIC_READ|windows.GENERIC_WRITE|windows.READ_CONTROL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	directory := &identityDirectory{handle: handle, path: path}
	if err := directory.validate(); err != nil {
		directory.Close()
		return nil, err
	}
	return directory, nil
}

func (directory *identityDirectory) validate() error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(directory.handle, &info); err != nil {
		return err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return errors.New("identity directory is not a trusted directory")
	}
	descriptor, err := windows.GetSecurityInfo(directory.handle, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	return validateDirectorySecurityDescriptor(descriptor)
}

func (directory *identityDirectory) Sync() error {
	return windows.FlushFileBuffers(directory.handle)
}

func (directory *identityDirectory) Close() error {
	return windows.CloseHandle(directory.handle)
}

type pinnedIdentityParent struct {
	directory windows.Handle
	leaf      string
}

func (parent *pinnedIdentityParent) handle() windows.Handle {
	return parent.directory
}

func (parent *pinnedIdentityParent) Close() {
	windows.CloseHandle(parent.directory)
}

func prepareIdentityDirectory(path string) error {
	parent, err := pinIdentityParent(path)
	if err != nil {
		return err
	}
	defer parent.Close()
	if err := identityDirectoryParentPinnedHook(); err != nil {
		return err
	}

	securityDescriptor, err := newIdentityDirectorySecurityDescriptor()
	if err != nil {
		return err
	}
	handle, created, err := openOrCreateIdentityDirectoryRelative(parent.handle(), parent.leaf, securityDescriptor)
	if err != nil {
		return err
	}
	directory := os.NewFile(uintptr(handle), path)
	if directory == nil {
		windows.CloseHandle(handle)
		return errors.New("wrap identity directory handle")
	}
	defer directory.Close()
	if err := validateIdentityDirectoryHandle(handle); err != nil {
		return err
	}
	if err := verifyRelativeDirectoryLeaf(parent.handle(), parent.leaf, handle); err != nil {
		return err
	}
	if !created {
		descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
		if err != nil {
			return err
		}
		if err := validateDirectoryOwner(descriptor); err != nil {
			return err
		}
		if err := validateDedicatedIdentityDirectoryWindows(directory, handle); err != nil {
			return err
		}
		if err := restrictIdentityDirectoryHandle(handle); err != nil {
			return err
		}
	}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	return validateDirectorySecurityDescriptor(descriptor)
}

func pinIdentityParent(path string) (*pinnedIdentityParent, error) {
	parentPath := filepath.Dir(path)
	pointer, err := windows.UTF16PtrFromString(parentPath)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(pointer, directoryTraverseAccess|windows.READ_CONTROL|fileAddSubdirectory,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, fmt.Errorf("pin identity parent: %w", err)
	}
	pinned := &pinnedIdentityParent{directory: handle, leaf: filepath.Base(path)}
	if err := validateIdentityDirectoryHandle(handle); err != nil {
		pinned.Close()
		return nil, err
	}
	if err := verifyIdentityParentPath(handle, parentPath); err != nil {
		pinned.Close()
		return nil, err
	}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		pinned.Close()
		return nil, err
	}
	if err := validateDirectoryOwner(descriptor); err != nil {
		pinned.Close()
		return nil, err
	}
	return pinned, nil
}

func verifyIdentityParentPath(handle windows.Handle, requested string) error {
	// FILE_NAME_OPENED preserves 8.3 spelling without querying every ancestor;
	// the final handle path still resolves junction redirection.
	const fileNameOpened = 0x8
	actual := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(handle, &actual[0], uint32(len(actual)), fileNameOpened)
	if err != nil {
		return fmt.Errorf("read pinned identity parent path: %w", err)
	}
	if n == 0 || n >= uint32(len(actual)) {
		return errors.New("pinned identity parent path exceeds supported length")
	}
	if !strings.EqualFold(normalizeIdentityWindowsPath(requested),
		normalizeIdentityWindowsPath(windows.UTF16ToString(actual))) {
		return errors.New("identity parent final path does not match requested path")
	}
	return nil
}

func normalizeIdentityWindowsPath(path string) string {
	if strings.HasPrefix(path, `\\?\UNC\`) {
		path = `\\` + path[len(`\\?\UNC\`):]
	} else {
		path = strings.TrimPrefix(path, `\\?\`)
	}
	return filepath.Clean(path)
}

func openRelativeDirectory(parent windows.Handle, name string, access uint32) (windows.Handle, error) {
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return 0, err
	}
	attributes := &windows.OBJECT_ATTRIBUTES{
		Length:        uint32(unsafe.Sizeof(windows.OBJECT_ATTRIBUTES{})),
		RootDirectory: parent,
		ObjectName:    objectName,
		Attributes:    windows.OBJ_CASE_INSENSITIVE,
	}
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	share := uint32(windows.FILE_SHARE_READ | windows.FILE_SHARE_WRITE | windows.FILE_SHARE_DELETE)
	if access&fileAddSubdirectory != 0 {
		share &^= windows.FILE_SHARE_DELETE
	}
	if err := windows.NtCreateFile(&handle, access, attributes, &status, nil, 0,
		share, windows.FILE_OPEN,
		windows.FILE_DIRECTORY_FILE|windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT,
		0, 0); err != nil {
		return 0, err
	}
	if err := validateIdentityDirectoryHandle(handle); err != nil {
		windows.CloseHandle(handle)
		return 0, err
	}
	return handle, nil
}

func openOrCreateIdentityDirectoryRelative(parent windows.Handle, name string, descriptor *windows.SECURITY_DESCRIPTOR) (windows.Handle, bool, error) {
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return 0, false, err
	}
	attributes := &windows.OBJECT_ATTRIBUTES{
		Length:             uint32(unsafe.Sizeof(windows.OBJECT_ATTRIBUTES{})),
		RootDirectory:      parent,
		ObjectName:         objectName,
		Attributes:         windows.OBJ_CASE_INSENSITIVE,
		SecurityDescriptor: descriptor,
	}
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	access := uint32(windows.FILE_GENERIC_READ | windows.FILE_GENERIC_WRITE | windows.READ_CONTROL | windows.WRITE_DAC)
	if err := windows.NtCreateFile(&handle, access, attributes, &status, nil, windows.FILE_ATTRIBUTE_NORMAL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, windows.FILE_OPEN_IF,
		windows.FILE_DIRECTORY_FILE|windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT,
		0, 0); err != nil {
		return 0, false, err
	}
	runtime.KeepAlive(descriptor)
	return handle, status.Information != fileOpened, nil
}

func verifyRelativeDirectoryLeaf(parent windows.Handle, name string, expected windows.Handle) error {
	verification, err := openRelativeDirectory(parent, name,
		uint32(directoryTraverseAccess))
	if err != nil {
		return fmt.Errorf("reopen identity directory relative to pinned parent: %w", err)
	}
	defer windows.CloseHandle(verification)
	var expectedInfo, verificationInfo windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(expected, &expectedInfo); err != nil {
		return err
	}
	if err := windows.GetFileInformationByHandle(verification, &verificationInfo); err != nil {
		return err
	}
	if expectedInfo.VolumeSerialNumber != verificationInfo.VolumeSerialNumber ||
		expectedInfo.FileIndexHigh != verificationInfo.FileIndexHigh ||
		expectedInfo.FileIndexLow != verificationInfo.FileIndexLow {
		return errors.New("identity directory handle does not match pinned parent leaf")
	}
	return nil
}

func validateIdentityDirectoryHandle(handle windows.Handle) error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return errors.New("identity directory is not a trusted directory")
	}
	return nil
}

func validateDedicatedIdentityDirectoryWindows(directory *os.File, handle windows.Handle) error {
	entries, err := directory.ReadDir(-1)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !isKnownIdentityArtifact(entry.Name()) {
			return fmt.Errorf("identity directory contains unrelated entry %q", entry.Name())
		}
		artifact, err := openRelativeIdentityArtifact(handle, entry.Name())
		if err != nil {
			return fmt.Errorf("validate identity artifact %q: %w", entry.Name(), err)
		}
		err = validateRestrictedIdentityWindowsHandle(artifact)
		windows.CloseHandle(artifact)
		if err != nil {
			return fmt.Errorf("validate identity artifact %q: %w", entry.Name(), err)
		}
	}
	return nil
}

func openRelativeIdentityArtifact(parent windows.Handle, name string) (windows.Handle, error) {
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return 0, err
	}
	attributes := &windows.OBJECT_ATTRIBUTES{
		Length:        uint32(unsafe.Sizeof(windows.OBJECT_ATTRIBUTES{})),
		RootDirectory: parent,
		ObjectName:    objectName,
		Attributes:    windows.OBJ_CASE_INSENSITIVE,
	}
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	if err := windows.NtCreateFile(&handle, uint32(windows.FILE_GENERIC_READ|windows.READ_CONTROL), attributes, &status,
		nil, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, windows.FILE_OPEN,
		windows.FILE_NON_DIRECTORY_FILE|windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT,
		0, 0); err != nil {
		return 0, err
	}
	return handle, nil
}

func newIdentityDirectorySecurityDescriptor() (*windows.SECURITY_DESCRIPTOR, error) {
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return nil, err
	}
	return newIdentitySecurityDescriptor(userSID, systemSID, true)
}

// A service token may default new objects to Administrators ownership even
// though its user is SYSTEM. Set the actual user as owner at creation, before
// validating the same strict owner/ACL policy used when reopening the file.
func newIdentitySecurityDescriptor(userSID, systemSID *windows.SID, directory bool) (*windows.SECURITY_DESCRIPTOR, error) {
	acl, err := windows.ACLFromEntries(identityAccessEntries(userSID, systemSID, directory), nil)
	if err != nil {
		return nil, err
	}
	descriptor, err := windows.NewSecurityDescriptor()
	if err != nil {
		return nil, err
	}
	if err := descriptor.SetDACL(acl, true, false); err != nil {
		return nil, err
	}
	if err := descriptor.SetControl(windows.SE_DACL_PROTECTED, windows.SE_DACL_PROTECTED); err != nil {
		return nil, err
	}
	if err := descriptor.SetOwner(userSID, false); err != nil {
		return nil, err
	}
	selfRelative, err := descriptor.ToSelfRelative()
	runtime.KeepAlive(userSID)
	runtime.KeepAlive(systemSID)
	runtime.KeepAlive(acl)
	return selfRelative, err
}

func identityAccessEntries(userSID, systemSID *windows.SID, directory bool) []windows.EXPLICIT_ACCESS {
	entries := []windows.EXPLICIT_ACCESS{allowFullAccess(userSID, windows.TRUSTEE_IS_USER)}
	if !userSID.Equals(systemSID) {
		entries = append(entries, allowFullAccess(systemSID, windows.TRUSTEE_IS_WELL_KNOWN_GROUP))
	}
	if directory {
		for i := range entries {
			entries[i].Inheritance = windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT
		}
	}
	return entries
}

func restrictIdentityDirectory(path string) error {
	return prepareIdentityDirectory(path)
}

func restrictIdentityDirectoryHandle(handle windows.Handle) error {
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return err
	}
	entries := identityAccessEntries(userSID, systemSID, true)
	acl, err := windows.ACLFromEntries(entries, nil)
	if err != nil {
		return err
	}
	runtime.KeepAlive(userSID)
	runtime.KeepAlive(systemSID)
	return windows.SetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, acl, nil)
}

func allowInheritedFullAccess(sid *windows.SID, trusteeType windows.TRUSTEE_TYPE) windows.EXPLICIT_ACCESS {
	entry := allowFullAccess(sid, trusteeType)
	entry.Inheritance = windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT
	return entry
}

func validateDirectorySecurityDescriptor(descriptor *windows.SECURITY_DESCRIPTOR) error {
	if err := validateDirectoryOwner(descriptor); err != nil {
		return err
	}
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return err
	}
	administratorsSID, err := windows.StringToSid("S-1-5-32-544")
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return errors.New("identity directory has no DACL")
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return err
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return errors.New("identity directory DACL contains an unsupported allow entry")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		trusted := sid.Equals(userSID) || sid.Equals(systemSID) || sid.Equals(administratorsSID)
		if !trusted && ace.Mask&directoryDangerousAccess != 0 {
			return errors.New("identity directory grants write or delete access to an untrusted principal")
		}
	}
	runtime.KeepAlive(userSID)
	runtime.KeepAlive(systemSID)
	runtime.KeepAlive(administratorsSID)
	return nil
}

func validateDirectoryOwner(descriptor *windows.SECURITY_DESCRIPTOR) error {
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("identity directory owner is missing")
	}
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return err
	}
	administratorsSID, err := windows.StringToSid("S-1-5-32-544")
	if err != nil {
		return err
	}
	if !owner.Equals(userSID) && !owner.Equals(systemSID) && !owner.Equals(administratorsSID) {
		return errors.New("identity directory owner is untrusted")
	}
	runtime.KeepAlive(userSID)
	runtime.KeepAlive(systemSID)
	runtime.KeepAlive(administratorsSID)
	return nil
}

func validateIdentityPath(path string) error {
	volume := filepath.VolumeName(path)
	if volume == "" {
		return errors.New("identity path has no Windows volume")
	}
	parent := filepath.Dir(path)
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

	attributes, err := getFileAttributes(path)
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
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(pointer, windows.GENERIC_READ|windows.READ_CONTROL|windows.WRITE_DAC,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return restrictIdentityWindowsHandle(handle)
}

func restrictIdentityWindowsHandle(handle windows.Handle) error {
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
	if err := windows.SetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, acl, nil); err != nil {
		return fmt.Errorf("set identity ACL: %w", err)
	}
	return validateRestrictedIdentityWindowsHandle(handle)
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
	if err := validateAllowedOwner(descriptor); err != nil {
		return err
	}
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

func validateAllowedOwner(descriptor *windows.SECURITY_DESCRIPTOR) error {
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("identity owner is missing")
	}
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return err
	}
	if !owner.Equals(userSID) && !owner.Equals(systemSID) {
		return ErrIdentityOwner
	}
	return nil
}

func openValidatedIdentity(path string) (*os.File, error) {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(pointer, windows.GENERIC_READ|windows.READ_CONTROL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
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
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
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

func validateRestrictedIdentityHandle(file *os.File) error {
	return validateRestrictedIdentityWindowsHandle(windows.Handle(file.Fd()))
}

func validateRestrictedIdentityWindowsHandle(handle windows.Handle) error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		return errors.New("identity file is not a regular file")
	}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	return validateSecurityDescriptor(descriptor)
}

func createRestrictedIdentityTemp(dir string) (*os.File, string, error) {
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		return nil, "", err
	}
	descriptor, err := newIdentitySecurityDescriptor(userSID, systemSID, false)
	if err != nil {
		return nil, "", err
	}
	attributes := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: descriptor}
	for range 32 {
		var random [16]byte
		if _, err := rand.Read(random[:]); err != nil {
			return nil, "", err
		}
		path := filepath.Join(dir, ".identity-"+hex.EncodeToString(random[:])+".tmp")
		pointer, err := windows.UTF16PtrFromString(path)
		if err != nil {
			return nil, "", err
		}
		handle, err := windows.CreateFile(pointer,
			windows.GENERIC_READ|windows.GENERIC_WRITE|windows.READ_CONTROL|windows.WRITE_DAC,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, attributes, windows.CREATE_NEW,
			windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_WRITE_THROUGH|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
		runtime.KeepAlive(descriptor)
		if errors.Is(err, windows.ERROR_FILE_EXISTS) || errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			continue
		}
		if err != nil {
			return nil, "", err
		}
		file := os.NewFile(uintptr(handle), path)
		if err := validateRestrictedIdentityWindowsHandle(handle); err != nil {
			file.Close()
			os.Remove(path)
			return nil, "", err
		}
		return file, path, nil
	}
	return nil, "", errors.New("could not allocate temporary identity name")
}

func verifySameIdentityFile(temporary, published *os.File) error {
	var temporaryInfo, publishedInfo windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(temporary.Fd()), &temporaryInfo); err != nil {
		return err
	}
	if err := windows.GetFileInformationByHandle(windows.Handle(published.Fd()), &publishedInfo); err != nil {
		return err
	}
	if temporaryInfo.VolumeSerialNumber != publishedInfo.VolumeSerialNumber ||
		temporaryInfo.FileIndexHigh != publishedInfo.FileIndexHigh ||
		temporaryInfo.FileIndexLow != publishedInfo.FileIndexLow {
		return errors.New("published identity does not match temporary file")
	}
	return nil
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
