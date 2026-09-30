//go:build windows

package state

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestLoadOrCreateIdentityAppliesAndValidatesRestrictedWindowsACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
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
	root := t.TempDir()
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
	dir := t.TempDir()
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
