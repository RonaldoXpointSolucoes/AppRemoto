//go:build windows

package setup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/enroll"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
	"golang.org/x/sys/windows"
)

func TestInstallerRecoveryMarkersAcrossAccounts(t *testing.T) {
	dir := os.Getenv("XPOINT_TEST_STATE_DIR")
	if dir == "" {
		t.Skip("requires isolated two-account verification directory")
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if user.User.Sid.String() == "S-1-5-18" {
		h, err := secureDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer windows.CloseHandle(h)
		if err := state.PrepareIdentityDirectory(filepath.Join(dir, "identity")); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"enrollment-pending.json", "enrollment-credentials.json"} {
			if err := state.PublishArtifact(filepath.Join(dir, "identity"), name, []byte(`{"fixture":true}`)); err != nil {
				t.Fatal(err)
			}
		}
		return
	}
	if !Elevated() {
		t.Fatal("recovery probe must run as an elevated administrator")
	}
	for _, name := range []string{"enrollment-pending.json", "enrollment-credentials.json"} {
		exists, err := privateExists(filepath.Join(dir, "identity", name))
		if err != nil || !exists {
			t.Fatalf("probe %s: exists=%v error=%v", name, exists, err)
		}
	}
	if exists, err := privateExists(filepath.Join(dir, "identity", "rustdesk-configured.json")); err != nil || exists {
		t.Fatalf("missing probe: exists=%v error=%v", exists, err)
	}
}

type systemFixtureAPI struct{ calls int }

func (f *systemFixtureAPI) Enroll(_ context.Context, _ api.EnrollRequest) (api.EnrollResponse, error) {
	f.calls++
	return api.EnrollResponse{DeviceID: "system-fixture", DeviceToken: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", RustDeskPassword: "Fixture-password-123", HeartbeatIntervalSeconds: 30}, nil
}

type systemFixtureRustDesk struct{}

func (systemFixtureRustDesk) Discover(context.Context) (rustdesk.Info, error) {
	return rustdesk.Info{ID: "123456789", Version: "1.4.3"}, nil
}
func (systemFixtureRustDesk) SetUnattendedPassword(context.Context, string) error { return nil }

// Run this binary as SYSTEM to exercise the actual installer folder policy.
// Only temporary files, synthetic API/RustDesk responses and local DPAPI are used.
func TestInstallerStateRoundTripInProtectedDirectory(t *testing.T) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if user.User.Sid.String() != "S-1-5-18" {
		t.Skip("requires LocalSystem; run the isolated SYSTEM verification")
	}
	for _, owner := range []string{"S-1-5-18", "S-1-5-32-544"} {
		t.Run(owner, func(t *testing.T) {
			restore := fixtureDefaultOwner(t, owner)
			defer restore()
			installerStateRoundTrip(t)
		})
	}
}

func fixtureDefaultOwner(t *testing.T, owner string) func() {
	t.Helper()
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY|windows.TOKEN_ADJUST_DEFAULT, &token); err != nil {
		t.Fatal(err)
	}
	var buffer [256]byte
	var size uint32
	if err := windows.GetTokenInformation(token, windows.TokenOwner, &buffer[0], uint32(len(buffer)), &size); err != nil {
		token.Close()
		t.Fatal(err)
	}
	current := *(**windows.SID)(unsafe.Pointer(&buffer[0]))
	original, err := windows.StringToSid(current.String())
	if err != nil {
		token.Close()
		t.Fatal(err)
	}
	selected, err := windows.StringToSid(owner)
	if err != nil {
		token.Close()
		t.Fatal(err)
	}
	if err := windows.SetTokenInformation(token, windows.TokenOwner, (*byte)(unsafe.Pointer(&selected)), uint32(unsafe.Sizeof(selected))); err != nil {
		token.Close()
		t.Fatal(err)
	}
	return func() {
		if err := windows.SetTokenInformation(token, windows.TokenOwner, (*byte)(unsafe.Pointer(&original)), uint32(unsafe.Sizeof(original))); err != nil {
			t.Error(err)
		}
		token.Close()
	}
}

func installerStateRoundTrip(t *testing.T) {
	data := filepath.Join(t.TempDir(), "data")
	installerHandle, err := secureDir(data)
	if err != nil {
		t.Fatalf("installer directory: %v", err)
	}
	defer windows.CloseHandle(installerHandle)
	serviceHandle, err := secureDir(data)
	if err != nil {
		t.Fatalf("service directory: %v", err)
	}
	defer windows.CloseHandle(serviceHandle)
	directory := filepath.Join(data, "identity")
	if err := state.PrepareIdentityDirectory(directory); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := state.LoadOrCreateIdentity(filepath.Join(directory, "identity.json")); err != nil {
		t.Fatalf("identity: %v", err)
	}
	client := &systemFixtureAPI{}
	en, err := enroll.NewService(enroll.Options{StateDirectory: directory, API: client, RustDesk: systemFixtureRustDesk{}})
	if err != nil {
		t.Fatal(err)
	}
	meta := enroll.Metadata{DisplayName: "SYSTEM fixture", Hostname: "fixture", OperatingSystem: "Windows", OSVersion: "11", AgentVersion: Version}
	first, err := en.Run(context.Background(), []byte("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), meta)
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}
	defer clear(first.DeviceToken)
	second, err := en.Run(context.Background(), nil, meta)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	defer clear(second.DeviceToken)
	if client.calls != 1 || !second.Existing {
		t.Fatal("existing enrollment was not preserved")
	}
}
