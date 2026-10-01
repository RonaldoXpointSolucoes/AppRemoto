//go:build windows

package setup

import (
	"context"
	"errors"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"strings"
	"testing"
)

type fakeRunner func(context.Context, string, ...string) (rustdesk.CommandResult, error)

func (f fakeRunner) Run(c context.Context, p string, a ...string) (rustdesk.CommandResult, error) {
	return f(c, p, a...)
}
func TestConfigurePreservesUnrelatedOptionsAndVerifiesWrites(t *testing.T) {
	options := map[string]string{"unrelated": "keep", "approve-mode": "click", "verification-method": "use-temporary-password"}
	calls := 0
	runner := fakeRunner(func(_ context.Context, _ string, a ...string) (rustdesk.CommandResult, error) {
		calls++
		if len(a) < 2 || a[0] != "--option" {
			t.Fatal("unexpected command")
		}
		if len(a) == 3 {
			options[a[1]] = a[2]
			return rustdesk.CommandResult{}, nil
		}
		return rustdesk.CommandResult{Stdout: []byte(options[a[1]])}, nil
	})
	if e := configureWith(context.Background(), "RustDesk.exe", runner); e != nil {
		t.Fatal(e)
	}
	if calls != 12 || options["unrelated"] != "keep" || options["key"] != PublicKey || options["custom-rendezvous-server"] != IDServer || options["relay-server"] != RelayServer || options["approve-mode"] != "password" || options["verification-method"] != "use-permanent-password" {
		t.Fatal("configuration mismatch")
	}
}
func TestConfigureFailsClosedAndRedacts(t *testing.T) {
	for _, r := range []fakeRunner{
		func(context.Context, string, ...string) (rustdesk.CommandResult, error) {
			return rustdesk.CommandResult{}, errors.New("sensitive-detail")
		},
		func(_ context.Context, _ string, a ...string) (rustdesk.CommandResult, error) {
			if len(a) == 3 {
				return rustdesk.CommandResult{}, nil
			}
			return rustdesk.CommandResult{Stdout: []byte("wrong-server")}, nil
		},
	} {
		e := configureWith(context.Background(), "RustDesk.exe", r)
		if e == nil || strings.Contains(e.Error(), "sensitive-detail") {
			t.Fatal("unconfirmed configuration accepted or error leaked")
		}
	}
}
func TestRetryCannotChangeCustomerOrEnrollment(t *testing.T) {
	r := receipt{"enroll", "org", "pc"}
	p := Provisioning{EnrollmentID: "enroll", OrganizationID: "org", DeviceDisplayName: "pc"}
	if !sameInstall(r, p) {
		t.Fatal("same operation rejected")
	}
	for _, v := range []Provisioning{{EnrollmentID: "other", OrganizationID: "org", DeviceDisplayName: "pc"}, {EnrollmentID: "enroll", OrganizationID: "other", DeviceDisplayName: "pc"}, {EnrollmentID: "enroll", OrganizationID: "org", DeviceDisplayName: "other"}} {
		if sameInstall(r, v) {
			t.Fatal("installation replacement accepted")
		}
	}
}

func TestUnattendedPolicyRefusalHasSpecificFailure(t *testing.T) {
	options := map[string]string{}
	r := fakeRunner(func(_ context.Context, _ string, a ...string) (rustdesk.CommandResult, error) {
		if len(a) == 3 {
			if a[1] != "approve-mode" {
				options[a[1]] = a[2]
			}
			return rustdesk.CommandResult{}, nil
		}
		return rustdesk.CommandResult{Stdout: []byte(options[a[1]])}, nil
	})
	if !errors.Is(configureWith(context.Background(), "RustDesk.exe", r), errUnattended) {
		t.Fatal("unattended refusal not distinguished")
	}
}
