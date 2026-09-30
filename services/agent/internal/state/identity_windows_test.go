//go:build windows

package state

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestValidateRestrictedWindowsACLRejectsUnexpectedOwner(t *testing.T) {
	userSID, systemSID, err := identitySIDs()
	if err != nil {
		t.Fatalf("identitySIDs() error = %v", err)
	}
	everyone, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatalf("StringToSid() error = %v", err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{
		allowFullAccess(userSID, windows.TRUSTEE_IS_USER),
		allowFullAccess(systemSID, windows.TRUSTEE_IS_WELL_KNOWN_GROUP),
	}, nil)
	if err != nil {
		t.Fatalf("ACLFromEntries() error = %v", err)
	}
	descriptor, err := windows.NewSecurityDescriptor()
	if err != nil {
		t.Fatalf("NewSecurityDescriptor() error = %v", err)
	}
	if err := descriptor.SetDACL(acl, true, false); err != nil {
		t.Fatalf("SetDACL() error = %v", err)
	}
	if err := descriptor.SetControl(windows.SE_DACL_PROTECTED, windows.SE_DACL_PROTECTED); err != nil {
		t.Fatalf("SetControl() error = %v", err)
	}
	if err := descriptor.SetOwner(everyone, false); err != nil {
		t.Fatalf("SetOwner() error = %v", err)
	}
	runtime.KeepAlive(userSID)
	runtime.KeepAlive(systemSID)
	runtime.KeepAlive(everyone)

	err = validateSecurityDescriptor(descriptor)
	if err == nil || !strings.Contains(err.Error(), "owner") {
		t.Fatalf("validateSecurityDescriptor() error = %v, want unexpected owner error", err)
	}
}

func TestOpenIdentityDirectoryPreventsPathReplacement(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "state")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	if err := restrictIdentityDirectory(dir); err != nil {
		t.Fatalf("restrictIdentityDirectory() error = %v", err)
	}
	guard, err := openIdentityDirectory(dir)
	if err != nil {
		t.Fatalf("openIdentityDirectory() error = %v", err)
	}
	renamed := filepath.Join(root, "renamed")
	if err := os.Rename(dir, renamed); err == nil {
		guard.Close()
		t.Fatal("Rename() error = nil while guarded directory is open")
	}
	if err := guard.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if err := os.Rename(dir, renamed); err != nil {
		t.Fatalf("Rename() after Close() error = %v", err)
	}
}

func TestOpenIdentityDirectoryRejectsUntrustedWriter(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	everyone, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatalf("StringToSid() error = %v", err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.GRANT_ACCESS,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeValue: windows.TrusteeValueFromSID(everyone),
		},
	}}, nil)
	if err != nil {
		t.Fatalf("ACLFromEntries() error = %v", err)
	}
	if err := windows.SetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, acl, nil); err != nil {
		t.Fatalf("SetNamedSecurityInfo() error = %v", err)
	}
	runtime.KeepAlive(everyone)

	if guard, err := openIdentityDirectory(dir); err == nil {
		guard.Close()
		t.Fatal("openIdentityDirectory() error = nil, want untrusted writer rejection")
	}
}

func TestCreateRestrictedIdentityTempPreventsPathReplacement(t *testing.T) {
	dir := t.TempDir()
	temp, path, err := createRestrictedIdentityTemp(dir)
	if err != nil {
		t.Fatalf("createRestrictedIdentityTemp() error = %v", err)
	}
	defer os.Remove(path)
	renamed := path + ".renamed"
	if err := os.Rename(path, renamed); err == nil {
		temp.Close()
		t.Fatal("Rename() error = nil while temporary identity is open")
	}
	if err := temp.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if err := os.Rename(path, renamed); err != nil {
		t.Fatalf("Rename() after Close() error = %v", err)
	}
	if err := os.Rename(renamed, path); err != nil {
		t.Fatalf("restore temporary path: %v", err)
	}
}

func TestLoadOrCreateIdentityAppliesAndValidatesRestrictedWindowsACL(t *testing.T) {
	path := filepath.Join(identityTestDir(t), "identity.json")
	if _, err := LoadOrCreateIdentity(path); err != nil {
		t.Fatalf("LoadOrCreateIdentity() error = %v", err)
	}
	if err := validateRestrictedACL(path); err != nil {
		t.Fatalf("new identity ACL is not restricted: %v", err)
	}

	everyone, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatalf("StringToSid() error = %v", err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.GRANT_ACCESS,
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

	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want permissive existing ACL error")
	}
}

func TestLoadOrCreateIdentityRejectsFileSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.json")
	if err := os.WriteFile(target, []byte(`{"device_uuid":"388f7765-7ec2-423f-8fa7-d3135d4d0467"}`), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	path := filepath.Join(dir, "identity.json")
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("file symlinks unavailable: %v", err)
	}

	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want reparse-point error")
	}
}

func TestLoadOrCreateIdentityRejectsDirectorySymlinkInPath(t *testing.T) {
	root := t.TempDir()
	realDir := filepath.Join(root, "real")
	if err := os.Mkdir(realDir, 0o700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	linkedDir := filepath.Join(root, "linked")
	if err := os.Symlink(realDir, linkedDir); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}

	if _, err := LoadOrCreateIdentity(filepath.Join(linkedDir, "identity.json")); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want reparse directory error")
	}
}

func TestLoadOrCreateIdentityRejectsDirectoryJunctionInPath(t *testing.T) {
	root := t.TempDir()
	realDir := filepath.Join(root, "real")
	if err := os.Mkdir(realDir, 0o700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	junction := filepath.Join(root, "junction")
	createJunction(t, junction, realDir)

	if _, err := LoadOrCreateIdentity(filepath.Join(junction, "identity.json")); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want junction error")
	}
}

func TestPrepareIdentityDirectoryRejectsJunctionParentBeforeCreating(t *testing.T) {
	root := t.TempDir()
	realParent := filepath.Join(root, "real")
	if err := os.Mkdir(realParent, 0o700); err != nil {
		t.Fatalf("Mkdir(real parent) error = %v", err)
	}
	junction := filepath.Join(root, "junction")
	createJunction(t, junction, realParent)

	if err := PrepareIdentityDirectory(filepath.Join(junction, "agent-state")); err == nil {
		t.Fatal("PrepareIdentityDirectory() error = nil, want junction rejection")
	}
	if _, err := os.Lstat(filepath.Join(realParent, "agent-state")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("directory was created behind junction, Lstat() error = %v", err)
	}
}

func TestPrepareIdentityDirectoryPinsParentBeforeMutation(t *testing.T) {
	parent := traversalOnlyAncestorFixture(t)
	target := filepath.Join(parent, "agent-state")
	renamed := parent + "-renamed"
	stop := errors.New("stop after parent pin")
	originalHook := identityDirectoryParentPinnedHook
	called := false
	identityDirectoryParentPinnedHook = func() error {
		called = true
		pointer, err := windows.UTF16PtrFromString(parent)
		if err != nil {
			return err
		}
		handle, err := windows.CreateFile(pointer, windows.DELETE,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
			windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
		if err == nil {
			windows.CloseHandle(handle)
			return errors.New("parent permits delete access while pinned")
		}
		if !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			return err
		}
		if err := os.Rename(parent, renamed); err == nil {
			return errors.New("parent replacement succeeded before identity mutation")
		}
		return stop
	}
	defer func() { identityDirectoryParentPinnedHook = originalHook }()

	if err := PrepareIdentityDirectory(target); !errors.Is(err, stop) {
		t.Fatalf("PrepareIdentityDirectory() error = %v, want parent-pinned stop", err)
	}
	if !called {
		t.Fatal("parent-pinned hook was not reached")
	}
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("identity directory was mutated before pinned-parent hook, Lstat() error = %v", err)
	}
	if _, err := os.Lstat(parent); err != nil {
		t.Fatalf("pinned parent was replaced: %v", err)
	}
	if _, err := os.Lstat(renamed); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("renamed parent exists, Lstat() error = %v", err)
	}
	if err := os.Rename(parent, renamed); err != nil {
		t.Fatalf("Rename() after releasing parent pin: %v", err)
	}
}

// Removing LIST_DIRECTORY and READ_EA must not prevent traversal to a child.
func traversalOnlyAncestorFixture(t *testing.T) string {
	t.Helper()
	ancestor := filepath.Join(t.TempDir(), "ancestor with traversal access")
	parent := filepath.Join(ancestor, "parent")
	if err := os.MkdirAll(parent, 0o700); err != nil {
		t.Fatal(err)
	}
	descriptor, err := windows.GetNamedSecurityInfo(ancestor, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	original, _, err := descriptor.DACL()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := windows.SetNamedSecurityInfo(ancestor, windows.SE_FILE_OBJECT,
			windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
			nil, nil, original, nil); err != nil {
			t.Errorf("restore ancestor ACL: %v", err)
		}
		runtime.KeepAlive(descriptor)
	})
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	parentACL, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{
		allowInheritedFullAccess(user.User.Sid, windows.TRUSTEE_IS_USER),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(parent, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, parentACL, nil); err != nil {
		t.Fatal(err)
	}
	entry := allowFullAccess(user.User.Sid, windows.TRUSTEE_IS_USER)
	entry.AccessPermissions = windows.FILE_TRAVERSE | windows.FILE_READ_ATTRIBUTES | windows.SYNCHRONIZE | windows.READ_CONTROL | windows.WRITE_DAC | fileAddSubdirectory
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{entry}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(ancestor, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	runtime.KeepAlive(user)
	return parent
}

func TestPrepareIdentityDirectoryTraversesWithoutListingAncestors(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "existing"}[existing], func(t *testing.T) {
			parent := traversalOnlyAncestorFixture(t)
			dir := filepath.Join(parent, "agent-state")
			var before os.FileInfo
			if existing {
				if err := os.Mkdir(dir, 0o700); err != nil {
					t.Fatal(err)
				}
				var err error
				before, err = os.Stat(dir)
				if err != nil {
					t.Fatal(err)
				}
			}
			if err := PrepareIdentityDirectory(dir); err != nil {
				t.Fatalf("PrepareIdentityDirectory() through traversal-only ancestor: %v", err)
			}
			if existing {
				after, err := os.Stat(dir)
				if err != nil || !os.SameFile(before, after) {
					t.Fatalf("existing directory was replaced: %v", err)
				}
			}
		})
	}
}

func TestVerifyRelativeDirectoryLeafRejectsDistinctFileID(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	parent, err := pinIdentityParent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	descriptor, err := newIdentityDirectorySecurityDescriptor()
	if err != nil {
		t.Fatal(err)
	}
	handle, created, err := openOrCreateIdentityDirectoryRelative(parent.handle(), parent.leaf, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if !created {
		t.Fatal("missing leaf was not reported as newly created")
	}
	if err := verifyRelativeDirectoryLeaf(parent.handle(), parent.leaf, handle); err != nil {
		t.Fatalf("matching directory file ID was rejected: %v", err)
	}
	other, _, err := openOrCreateIdentityDirectoryRelative(parent.handle(), "other", descriptor)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(other)
	if err := verifyRelativeDirectoryLeaf(parent.handle(), parent.leaf, other); err == nil ||
		!strings.Contains(err.Error(), "does not match pinned parent leaf") {
		t.Fatalf("distinct directory file ID error = %v, want mismatch", err)
	}
	reopened, created, err := openOrCreateIdentityDirectoryRelative(parent.handle(), parent.leaf, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(reopened)
	if created {
		t.Fatal("existing leaf was reported as newly created")
	}
	if err := verifyRelativeDirectoryLeaf(parent.handle(), parent.leaf, reopened); err != nil {
		t.Fatalf("reopened directory file ID was rejected: %v", err)
	}
}

func TestLoadOrCreateIdentityRejectsJunctionAsIdentityFile(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	path := filepath.Join(root, "identity.json")
	createJunction(t, path, target)

	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want final reparse-point error")
	}
}

func TestLoadOrCreateIdentityRejectsJunctionTemporaryFile(t *testing.T) {
	root := identityTestDir(t)
	target := filepath.Join(root, "target")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	createJunction(t, filepath.Join(root, ".identity-linked.tmp"), target)

	if _, err := LoadOrCreateIdentity(filepath.Join(root, "identity.json")); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want temporary reparse-point error")
	}
}

func TestLoadOrCreateIdentityRejectsReparseTemporaryFile(t *testing.T) {
	dir := identityTestDir(t)
	target := filepath.Join(dir, "target.tmp")
	if err := os.WriteFile(target, []byte("target"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	stalePath := filepath.Join(dir, ".identity-linked.tmp")
	if err := os.Symlink(target, stalePath); err != nil {
		t.Skipf("file symlinks unavailable: %v", err)
	}

	if _, err := LoadOrCreateIdentity(filepath.Join(dir, "identity.json")); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want reparse temporary file error")
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("temporary link target was damaged: %v", err)
	}
}

func createJunction(t *testing.T, path, target string) {
	t.Helper()
	if output, err := exec.Command("cmd.exe", "/c", "mklink", "/J", path, target).CombinedOutput(); err != nil {
		t.Skipf("directory junctions unavailable: %v (%s)", err, output)
	}
}
