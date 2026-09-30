//go:build windows

package state

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"golang.org/x/sys/windows"
)

func TestLoadArtifactRejectsUntrustedDirectory(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	if err := PrepareIdentityDirectory(directory); err != nil {
		t.Fatalf("PrepareIdentityDirectory: %v", err)
	}
	if err := PublishArtifact(directory, "enrollment-pending.json", []byte(`{"version":1}`)); err != nil {
		t.Fatalf("PublishArtifact: %v", err)
	}
	everyone, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatal(err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.GENERIC_ALL, AccessMode: windows.GRANT_ACCESS,
		Trustee: windows.TRUSTEE{TrusteeForm: windows.TRUSTEE_IS_SID, TrusteeValue: windows.TrusteeValueFromSID(everyone)},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(directory, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	runtime.KeepAlive(everyone)
	if value, err := LoadArtifact(directory, "enrollment-pending.json", 1024); err == nil {
		clear(value)
		t.Fatal("LoadArtifact accepted an untrusted state directory")
	}
	_ = os.Remove(filepath.Join(directory, "enrollment-pending.json"))
}
