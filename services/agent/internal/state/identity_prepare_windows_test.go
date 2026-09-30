//go:build windows

package state_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unsafe"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
	"golang.org/x/sys/windows"
)

const fullFileAccess windows.ACCESS_MASK = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0x1ff

func TestPrepareIdentityDirectoryCreatesMissingDedicatedDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "agent-state")
	if err := state.PrepareIdentityDirectory(dir); err != nil {
		t.Fatalf("PrepareIdentityDirectory() error = %v", err)
	}
	if _, err := state.LoadOrCreateIdentity(filepath.Join(dir, "identity.json")); err != nil {
		t.Fatalf("LoadOrCreateIdentity() after directory creation error = %v", err)
	}
	assertPreparedDirectorySecurity(t, dir)
}

func TestPrepareIdentityDirectorySupportsInheritedDirectoryWithoutChangingParent(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "parent")
	if err := os.Mkdir(parent, 0o700); err != nil {
		t.Fatalf("Mkdir(parent) error = %v", err)
	}
	setInheritedEveryoneACL(t, parent)

	dir := filepath.Join(parent, "agent-state")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatalf("Mkdir(agent-state) error = %v", err)
	}
	identityPath := filepath.Join(dir, "identity.json")
	if _, err := state.LoadOrCreateIdentity(identityPath); err == nil {
		t.Fatal("raw LoadOrCreateIdentity() error = nil, want inherited directory rejection")
	}

	if err := state.PrepareIdentityDirectory(dir); err != nil {
		t.Fatalf("PrepareIdentityDirectory() error = %v", err)
	}
	if _, err := state.LoadOrCreateIdentity(identityPath); err != nil {
		t.Fatalf("LoadOrCreateIdentity() after preparation error = %v", err)
	}
	assertPreparedDirectorySecurity(t, dir)
	assertParentStillGrantsEveryone(t, parent)
}

func setInheritedEveryoneACL(t *testing.T, path string) {
	t.Helper()
	everyone, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatalf("StringToSid(everyone) error = %v", err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.GRANT_ACCESS,
		Inheritance:       windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_WELL_KNOWN_GROUP,
			TrusteeValue: windows.TrusteeValueFromSID(everyone),
		},
	}}, nil)
	if err != nil {
		t.Fatalf("ACLFromEntries() error = %v", err)
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, acl, nil); err != nil {
		t.Fatalf("SetNamedSecurityInfo() error = %v", err)
	}
	runtime.KeepAlive(everyone)
}

func assertPreparedDirectorySecurity(t *testing.T, path string) {
	t.Helper()
	descriptor, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatalf("GetNamedSecurityInfo(prepared) error = %v", err)
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil {
		t.Fatalf("Owner(prepared) = %v, %v", owner, err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatalf("GetTokenUser() error = %v", err)
	}
	if !owner.Equals(user.User.Sid) {
		t.Fatalf("prepared owner = %s, want current user %s", owner, user.User.Sid)
	}
	control, _, err := descriptor.Control()
	if err != nil {
		t.Fatalf("Control(prepared) error = %v", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatal("prepared directory DACL remains inherited")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		t.Fatalf("DACL(prepared) = %v, %v", dacl, err)
	}
	system, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		t.Fatalf("StringToSid(SYSTEM) error = %v", err)
	}
	expected := map[string]uint8{user.User.Sid.String(): 0, system.String(): 0}
	if dacl.AceCount != 4 {
		t.Fatalf("prepared DACL ACE count = %d, want 4", dacl.AceCount)
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			t.Fatalf("GetAce(prepared, %d) error = %v", index, err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags&windows.INHERITED_ACE != 0 {
			t.Fatalf("prepared ACE %d type/flags = %d/%d, want explicit allow", index, ace.Header.AceType, ace.Header.AceFlags)
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		key := sid.String()
		if _, ok := expected[key]; !ok {
			t.Fatalf("prepared ACE %d SID = %s, want current user or SYSTEM", index, sid)
		}
		switch {
		case ace.Header.AceFlags == 0 && ace.Mask == fullFileAccess:
			expected[key] |= 1
		case ace.Header.AceFlags == windows.OBJECT_INHERIT_ACE|windows.CONTAINER_INHERIT_ACE|windows.INHERIT_ONLY_ACE && ace.Mask == windows.GENERIC_ALL:
			expected[key] |= 2
		default:
			t.Fatalf("prepared ACE %d mask/flags = %#x/%#x, want direct or inheritable full control", index, ace.Mask, ace.Header.AceFlags)
		}
	}
	for sid, forms := range expected {
		if forms != 3 {
			t.Fatalf("prepared DACL forms for SID %s = %d, want direct and inheritable", sid, forms)
		}
	}
	runtime.KeepAlive(system)
}

func assertParentStillGrantsEveryone(t *testing.T, path string) {
	t.Helper()
	descriptor, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatalf("GetNamedSecurityInfo(parent) error = %v", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		t.Fatalf("DACL(parent) = %v, %v", dacl, err)
	}
	everyone, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatalf("StringToSid(everyone) error = %v", err)
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			t.Fatalf("GetAce(parent, %d) error = %v", index, err)
		}
		if ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE && (*windows.SID)(unsafe.Pointer(&ace.SidStart)).Equals(everyone) {
			runtime.KeepAlive(everyone)
			return
		}
	}
	t.Fatal("parent DACL was changed while preparing child directory")
}
