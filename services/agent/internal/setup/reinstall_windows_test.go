//go:build windows

package setup

import "testing"

// Display names are operator labels. They must not identify a Windows
// installation or require a technician to remember an earlier test name.
func TestNewPackageAcceptsNewDisplayName(t *testing.T) {
	previous := receipt{EnrollmentID: "old-package", OrganizationID: "same-customer", DeviceDisplayName: "Forgotten first name"}
	next := Provisioning{EnrollmentID: "new-package", OrganizationID: "same-customer", DeviceDisplayName: "New computer name"}
	for _, scenario := range []struct {
		name                 string
		pending, credentials bool
		want                 string
	}{
		{"attempt not sent", false, false, "REPLACE_UNUSED"},
		{"credentials saved", true, true, "RESUME"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if got := recoveryDecision(previous, next, scenario.pending, scenario.credentials); got != scenario.want {
				t.Fatalf("new display name blocked: got %s, want %s", got, scenario.want)
			}
		})
	}
}
