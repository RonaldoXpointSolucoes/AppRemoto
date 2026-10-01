//go:build windows

package setup

import (
	"golang.org/x/sys/windows"
	"testing"
	"unsafe"
)

func TestRuntimeReadableButDataRemainsPrivate(t *testing.T) {
	users, _ := windows.StringToSid("S-1-5-32-545")
	rx := uint32(windows.FILE_GENERIC_READ | windows.FILE_GENERIC_EXECUTE)
	if !allowedReadOnly(users, rx, []bool{true}) {
		t.Fatal("runtime RX denied")
	}
	if allowedReadOnly(users, rx, nil) || allowedReadOnly(users, rx|windows.FILE_WRITE_DATA, []bool{true}) || allowedReadOnly(users, windows.WRITE_DAC, []bool{true}) {
		t.Fatal("data or runtime mutation allowed")
	}
	for _, public := range []bool{false, true} {
		sd, e := windows.SecurityDescriptorFromString(securitySDDL([]bool{public}))
		if e != nil {
			t.Fatal(e)
		}
		acl, _, e := sd.DACL()
		if e != nil {
			t.Fatal(e)
		}
		seen := false
		for n := uint32(0); n < uint32(acl.AceCount); n++ {
			var a *windows.ACCESS_ALLOWED_ACE
			if windows.GetAce(acl, n, &a) != nil {
				t.Fatal("invalid ACL")
			}
			sid := (*windows.SID)(unsafe.Pointer(&a.SidStart))
			if sid.Equals(users) {
				seen = true
				if !allowedReadOnly(sid, uint32(a.Mask), []bool{public}) {
					t.Fatal("unsafe runtime ACE")
				}
			}
		}
		if seen != public {
			t.Fatal("wrong filesystem ACL target")
		}
	}
}
