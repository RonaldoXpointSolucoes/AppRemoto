package setup

import (
	"errors"
	"testing"
)

func TestRustDeskExistingInstallationNeverRunsBundledPayload(t *testing.T) {
	path, reused, err := reuseOrInstallRustDesk(func() (string, error) { return "existing-rustdesk", nil }, func() (bool, error) { t.Fatal("unexpected service discovery"); return false, nil }, true, func() (string, error) { t.Fatal("existing installation must not be overwritten"); return "", nil })
	if err != nil || !reused || path != "existing-rustdesk" {
		t.Fatalf("reuse failed: %q %v %v", path, reused, err)
	}
}
func TestRustDeskAbsentUsesPayloadAndConflictsNeverInstall(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		exists, bundled, wantInstall bool
		wantCode                     string
	}{{"missing", false, true, true, ""}, {"portable or conflicting service", true, true, false, "RUSTDESK_CONFLICT"}, {"legacy missing", false, false, false, "RUSTDESK_MISSING"}} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			path, reused, err := reuseOrInstallRustDesk(func() (string, error) { return "", errors.New("not found") }, func() (bool, error) { return tc.exists, nil }, tc.bundled, func() (string, error) { calls++; return "new-rustdesk", nil })
			if reused || (calls == 1) != tc.wantInstall {
				t.Fatalf("payload actions=%d reuse=%v", calls, reused)
			}
			if tc.wantInstall {
				if err != nil || path != "new-rustdesk" {
					t.Fatalf("install result %q %v", path, err)
				}
			} else {
				var failed *preparationError
				if !errors.As(err, &failed) || failed.Code != tc.wantCode {
					t.Fatalf("error %v", err)
				}
			}
		})
	}
}
