package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenericPasswordUsesProtectedBodyAndStrictResponses(t *testing.T) {
	var called []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = append(called, r.URL.Path)
		if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" {
			t.Error("credential in header or URL")
		}
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		if payload["currentDeviceToken"] != strings.Repeat("A", 43) || payload["enrollmentToken"] != validEnrollRequest.EnrollmentToken {
			t.Error("proof missing")
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/confirm") {
			w.Write([]byte(`{"deviceId":"device-1","applied":true}`))
		} else {
			w.Write([]byte(`{"deviceId":"device-1","rustdeskPassword":"synthetic-secret-42","rotationId":"rotation-1"}`))
		}
	}))
	defer server.Close()
	client, err := NewClient(server.URL, Options{HTTPClient: server.Client(), AllowHTTPForTests: true})
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.GenericPassword(context.Background(), []byte(strings.Repeat("A", 43)), validEnrollRequest)
	if err != nil || response.DeviceID != "device-1" {
		t.Fatal(err)
	}
	confirm, err := client.ConfirmGenericPassword(context.Background(), []byte(strings.Repeat("A", 43)), validEnrollRequest)
	if err != nil || !confirm.Applied || len(called) != 2 {
		t.Fatal("confirmation failed")
	}
}
