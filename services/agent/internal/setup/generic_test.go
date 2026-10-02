package setup

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGenericPrepareUsesBoundProofAndAcceptsOnlyProvisioning(t *testing.T) {
	capability := GenericProvisioning{2, "installer-1", strings.Repeat("c", 43)}
	request, _ := newPreparationRequest(capability, InstallationInput{"Empresa", "PC"})
	request.ExistingOrganizationID = "org-1"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/agent/prepare-installation" || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer "+capability.InstallerToken {
			t.Error("wrong prepare authentication")
		}
		var received preparationRequest
		if json.NewDecoder(r.Body).Decode(&received) != nil || received != request {
			t.Error("request binding lost")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct {
			Provisioning
			OrganizationName string `json:"organizationName"`
		}{Provisioning{1, "enroll-1", strings.Repeat("e", 43), time.Now().Add(time.Minute).UTC().Format(time.RFC3339), "org-1", "PC"}, "Empresa"})
	}))
	defer server.Close()
	response, err := prepareInstallation(context.Background(), server.Client(), server.URL, capability, request)
	if err != nil || response.OrganizationID != "org-1" || response.EnrollmentID != "enroll-1" {
		t.Fatalf("unexpected preparation result: %v", err)
	}
}

func TestGenericPrepareErrorsAreBoundedAndRedacted(t *testing.T) {
	for _, tc := range []struct {
		status     int
		body, want string
	}{
		{403, `{"error":{"code":"GENERIC_INSTALLER_DENIED","detail":"sensitive capability"}}`, "GENERIC_INSTALLER_DENIED"},
		{409, `{"error":{"code":"GENERIC_INSTALLER_EXPIRED"}}`, "GENERIC_INSTALLER_EXPIRED"},
		{503, `sensitive private backend stack`, "PREPARATION_UNAVAILABLE"},
		{200, strings.Repeat("x", MaxOverlay+1), "PREPARATION_RESPONSE"},
		{200, `{"schemaVersion":1,"password":"sensitive"}`, "PREPARATION_RESPONSE"},
	} {
		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); w.Write([]byte(tc.body)) }))
		_, err := prepareInstallation(context.Background(), server.Client(), server.URL, GenericProvisioning{2, "id", strings.Repeat("t", 43)}, preparationRequest{})
		server.Close()
		var problem *preparationError
		if !errors.As(err, &problem) || problem.Code != tc.want || strings.Contains(err.Error(), "sensitive") {
			t.Fatalf("unsafe or incorrect error: %v", err)
		}
	}
}

func TestGenericPrepareExpiredLostResponseRenewsOnlyWithSafeLocalState(t *testing.T) {
	capability := GenericProvisioning{2, "installer-1", strings.Repeat("A", 43)}
	input := InstallationInput{"Empresa", "PC"}
	request, _ := newPreparationRequest(capability, input)
	for _, safe := range []bool{false, true} {
		saved := preparationState{Request: request}
		calls, persisted := 0, false
		_, err := prepareWithExpiredRenewal(capability, input, "", &saved, safe, func(next preparationState) error {
			if next.Request.RequestID == request.RequestID || next.Request.RequestSecret == request.RequestSecret {
				t.Fatal("expired request proof reused")
			}
			persisted = true
			return nil
		}, func(next preparationRequest) (Provisioning, error) {
			calls++
			if calls == 1 {
				return Provisioning{}, &preparationError{"GENERIC_INSTALLER_EXPIRED"}
			}
			if !persisted {
				t.Fatal("new request sent before durable proof")
			}
			return Provisioning{}, nil
		})
		if safe && (err != nil || calls != 2) || !safe && (err == nil || calls != 1) {
			t.Fatal("unsafe renewal or expired attempt stuck")
		}
	}
}

func TestGenericPrepareReusesUnsentAttemptAndRefreshesCompletedInstallation(t *testing.T) {
	p := GenericProvisioning{2, "installer-1", strings.Repeat("A", 43)}
	input := InstallationInput{"Empresa", "PC"}
	req, _ := newPreparationRequest(p, input)
	saved := preparationState{Request: req}
	if !reusePreparation(saved, p, input, "", false, time.Now()) {
		t.Fatal("lost prepare response did not preserve request proof")
	}
	if reusePreparation(saved, p, input, "", true, time.Now()) {
		t.Fatal("completed registration reused a consumed enrollment token")
	}
	if reusePreparation(saved, p, InstallationInput{"Empresa", "Novo nome"}, "", false, time.Now()) {
		t.Fatal("new label did not get a fresh package")
	}
	saved.Provisioning = &Provisioning{ExpiresAt: time.Now().Add(-time.Minute).Format(time.RFC3339)}
	if reusePreparation(saved, p, input, "", false, time.Now()) {
		t.Fatal("expired cached preparation reused")
	}
}
