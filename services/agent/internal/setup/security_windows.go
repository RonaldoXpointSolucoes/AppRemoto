//go:build windows

package setup

import (
	"errors"
	"golang.org/x/sys/windows"
	"io"
	"os"
	"path/filepath"
	"unsafe"
)

const privateSDDL = "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"

var errStage = errors.New("installation stage failed")

type Paths struct{ Binary, Data, Agent, RustDesk string }

func paths() (Paths, error) {
	pf, e := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if e != nil {
		return Paths{}, e
	}
	pd, e := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if e != nil {
		return Paths{}, e
	}
	return Paths{filepath.Join(pf, "XPointRemoteAgent"), filepath.Join(pd, "XPointRemoteAgent"), filepath.Join(pd, "XPointRemoteAgent", "identity"), filepath.Join(pf, "RustDesk", "RustDesk.exe")}, nil
}
func ptr(s string) *uint16 { v, _ := windows.UTF16PtrFromString(s); return v }
func Message(s string) {
	windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(ptr(s))), uintptr(unsafe.Pointer(ptr("XPoint Remote"))), 0x40)
}
func Elevated() bool { return windows.GetCurrentProcessToken().IsElevated() }
func Elevate(uninstall bool) error {
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	arg := "--elevated"
	if uninstall {
		arg = "--uninstall"
	}
	return windows.ShellExecute(0, ptr("runas"), ptr(exe), ptr(arg), nil, 1)
}
func securityAttributes(readable ...bool) (*windows.SecurityAttributes, error) {
	sd, e := windows.SecurityDescriptorFromString(securitySDDL(readable))
	if e != nil {
		return nil, e
	}
	return &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}, nil
}
func secureDir(path string, readable ...bool) (windows.Handle, error) {
	for p := path; ; p = filepath.Dir(p) {
		a, e := windows.GetFileAttributes(ptr(p))
		if e == nil && a&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return 0, errStage
		}
		if e != nil && !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) && !errors.Is(e, windows.ERROR_PATH_NOT_FOUND) {
			return 0, e
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	sa, e := securityAttributes(readable...)
	if e != nil {
		return 0, e
	}
	e = windows.CreateDirectory(ptr(path), sa)
	if e != nil && !errors.Is(e, windows.ERROR_ALREADY_EXISTS) {
		return 0, e
	}
	h, e := windows.CreateFile(ptr(path), windows.READ_CONTROL|windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if e != nil {
		return 0, e
	}
	if e = trustedHandle(h, readable...); e != nil {
		windows.CloseHandle(h)
		return 0, e
	}
	return h, nil
}
func trustedHandle(h windows.Handle, readable ...bool) error {
	var i windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(h, &i) != nil || i.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return errStage
	}
	sd, e := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if e != nil {
		return e
	}
	ba, _ := windows.StringToSid("S-1-5-32-544")
	sy, _ := windows.StringToSid("S-1-5-18")
	owner, _, e := sd.Owner()
	if e != nil || (!owner.Equals(ba) && !owner.Equals(sy)) {
		return errStage
	}
	acl, _, e := sd.DACL()
	if e != nil || acl == nil {
		return errStage
	}
	for n := uint32(0); n < uint32(acl.AceCount); n++ {
		var a *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(acl, n, &a) != nil {
			return errStage
		}
		if a.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if a.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return errStage
		}
		sid := (*windows.SID)(unsafe.Pointer(&a.SidStart))
		if !sid.Equals(ba) && !sid.Equals(sy) && !allowedReadOnly(sid, uint32(a.Mask), readable) {
			return errStage
		}
	}
	return nil
}
func writeNew(path string, b []byte, readable ...bool) error {
	sa, e := securityAttributes(readable...)
	if e != nil {
		return e
	}
	h, e := windows.CreateFile(ptr(path), windows.GENERIC_WRITE, 0, sa, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if e != nil {
		return e
	}
	f := os.NewFile(uintptr(h), path)
	defer f.Close()
	if _, e = f.Write(b); e != nil {
		return e
	}
	return f.Sync()
}
func readPrivate(path string, max int64, readable ...bool) ([]byte, error) {
	h, e := windows.CreateFile(ptr(path), windows.GENERIC_READ|windows.READ_CONTROL|windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(h), path)
	defer f.Close()
	if e = trustedHandle(h, readable...); e != nil {
		return nil, e
	}
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Size() > max {
		return nil, errStage
	}
	return io.ReadAll(io.LimitReader(f, max+1))
}
func protectMachine(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, errStage
	}
	in := windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
	var out windows.DataBlob
	if e := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN|windows.CRYPTPROTECT_LOCAL_MACHINE, &out); e != nil {
		return nil, e
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(out.Data))))
	src := unsafe.Slice(out.Data, out.Size)
	defer clear(src)
	return append([]byte(nil), src...), nil
}

func securitySDDL(readable []bool) string {
	if len(readable) > 0 && readable[0] {
		return privateSDDL + "(A;OICI;0x1200a9;;;BU)"
	}
	return privateSDDL
}
func allowedReadOnly(sid *windows.SID, mask uint32, readable []bool) bool {
	if len(readable) == 0 || !readable[0] {
		return false
	}
	users, _ := windows.StringToSid("S-1-5-32-545")
	return sid.Equals(users) && mask & ^uint32(windows.FILE_GENERIC_READ|windows.FILE_GENERIC_EXECUTE) == 0
}
