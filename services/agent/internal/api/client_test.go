package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var validEnrollRequest = EnrollRequest{
	EnrollmentToken: "synthetic-enrollment-token-00000000",
	DeviceUUID:      "00000000-0000-4000-8000-000000000001",
	DisplayName:     "Test PC", Hostname: "test-pc", OperatingSystem: "Windows",
	OSVersion: "11", AgentVersion: "1.0.0", RustDeskID: "123456789", RustDeskVersion: "1.4.2",
}

const validEnrollResponse = `{"deviceId":"device-1","deviceToken":"tttttttttttttttttttttttttttttttt","rustdeskPassword":"Password123!","heartbeatIntervalSeconds":30}`

func testClient(t *testing.T, handler http.Handler, timeout time.Duration) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := NewClient(server.URL, Options{HTTPClient: server.Client(), AllowHTTPForTests: true, RequestTimeout: timeout})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return client
}

func TestEnrollSendsExactContractWithoutCredentialsInURLOrHeaders(t *testing.T) {
	client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.EscapedPath() != "/v1/agent/enroll" || request.URL.RawQuery != "" {
			t.Errorf("unexpected request target: %s %s", request.Method, request.URL.String())
		}
		if request.Header.Get("Authorization") != "" {
			t.Error("enrollment must not send Authorization")
		}
		if got := request.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		want := `{"enrollmentToken":"synthetic-enrollment-token-00000000","deviceUuid":"00000000-0000-4000-8000-000000000001","displayName":"Test PC","hostname":"test-pc","operatingSystem":"Windows","osVersion":"11","agentVersion":"1.0.0","rustdeskId":"123456789","rustdeskVersion":"1.4.2"}`
		if string(body) != want {
			t.Errorf("body mismatch\n got: %s\nwant: %s", body, want)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(validEnrollResponse))
	}), time.Second)
	got, err := client.Enroll(context.Background(), validEnrollRequest)
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if got.DeviceID != "device-1" || got.HeartbeatIntervalSeconds != 30 {
		t.Fatalf("unexpected response: %#v", got)
	}
}

func TestEnrollAppliesContextDeadlineAndMakesOneAttempt(t *testing.T) {
	var calls atomic.Int32
	client := testClient(t, http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		time.Sleep(100 * time.Millisecond)
	}), 30*time.Millisecond)
	_, err := client.Enroll(context.Background(), validEnrollRequest)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", calls.Load())
	}
}

func TestEnrollMapsOnlyDocumentedStatuses(t *testing.T) {
	tests := []struct {
		status int
		code   string
		want   ErrorCode
	}{
		{400, "INVALID_ENROLLMENT", ErrorInvalidEnrollment}, {403, "ENROLLMENT_DENIED", ErrorEnrollmentDenied},
		{429, "ENROLLMENT_RATE_LIMITED", ErrorRateLimited}, {503, "ENROLLMENT_UNAVAILABLE", ErrorUnavailable},
		{418, "OTHER", ErrorUnexpectedResponse},
	}
	for _, test := range tests {
		t.Run(fmt.Sprintf("%d", test.status), func(t *testing.T) {
			client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.WriteHeader(test.status)
				_, _ = fmt.Fprintf(response, `{"error":{"code":%q,"message":"generic"}}`, test.code)
			}), time.Second)
			_, err := client.Enroll(context.Background(), validEnrollRequest)
			if !IsCode(err, test.want) {
				t.Fatalf("error = %v, want code %s", err, test.want)
			}
		})
	}
}

func TestEnrollRejectsMalformedErrorContract(t *testing.T) {
	for _, body := range []string{
		`{"error":{"code":"ENROLLMENT_DENIED","message":"generic","requestId":""}}`,
		`{"error":{"code":"ENROLLMENT_DENIED","message":"generic","unknown":true}}`,
		`{"error":{"code":"ENROLLMENT_UNAVAILABLE","message":"generic"}}`,
	} {
		client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(http.StatusForbidden)
			_, _ = response.Write([]byte(body))
		}), time.Second)
		_, err := client.Enroll(context.Background(), validEnrollRequest)
		if !IsCode(err, ErrorUnexpectedResponse) {
			t.Fatalf("body %s: error = %v", body, err)
		}
	}
}

func TestEnrollRejectsMalformedOrAmbiguousResponses(t *testing.T) {
	tests := []struct{ name, contentType, body string }{
		{"wrong content type", "text/plain", validEnrollResponse},
		{"unknown field", "application/json", strings.TrimSuffix(validEnrollResponse, "}") + `,"extra":true}`},
		{"trailing json", "application/json", validEnrollResponse + `{}`},
		{"short token", "application/json", strings.Replace(validEnrollResponse, strings.Repeat("t", 32), "short", 1)},
		{"fractional interval", "application/json", strings.Replace(validEnrollResponse, `30}`, `30.5}`, 1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", test.contentType)
				_, _ = response.Write([]byte(test.body))
			}), time.Second)
			_, err := client.Enroll(context.Background(), validEnrollRequest)
			if !IsCode(err, ErrorUnexpectedResponse) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestEnrollCapsResponseBodyAndNeverFollowsRedirects(t *testing.T) {
	var destinationCalls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { destinationCalls.Add(1) }))
	t.Cleanup(destination.Close)
	tests := []http.Handler{
		http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
		}),
		http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			http.Redirect(response, request, destination.URL, http.StatusTemporaryRedirect)
		}),
	}
	for index, handler := range tests {
		client := testClient(t, handler, time.Second)
		_, err := client.Enroll(context.Background(), validEnrollRequest)
		if !IsCode(err, ErrorUnexpectedResponse) {
			t.Fatalf("case %d: error = %v", index, err)
		}
	}
	if destinationCalls.Load() != 0 {
		t.Fatalf("redirect destination received %d calls", destinationCalls.Load())
	}
}

type errorTransport struct{ secret string }

func (transport errorTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("transport exposed " + transport.secret + " password=private")
}

func TestClientRejectsInsecureProductionConfigurationAndRedactsErrors(t *testing.T) {
	if _, err := NewClient("http://api.example.test", Options{}); err == nil {
		t.Fatal("production HTTP base URL accepted")
	}
	if _, err := NewClient("http://api.example.test", Options{AllowHTTPForTests: true}); err == nil {
		t.Fatal("test HTTP accepted without an injected client")
	}
	if _, err := NewClient("https://user:password@api.example.test/?token=secret", Options{}); err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "password") {
		t.Fatalf("unsafe base URL error: %v", err)
	}
	secret := validEnrollRequest.EnrollmentToken
	client, err := NewClient("https://api.example.test", Options{HTTPClient: &http.Client{Transport: errorTransport{secret: secret}}, RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Enroll(context.Background(), validEnrollRequest)
	if err == nil || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "password") {
		t.Fatalf("error was not redacted: %v", err)
	}
}

func TestHeartbeatSendsBearerAndExactProductionContract(t *testing.T) {
	deviceToken := []byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v1/agent/heartbeat" || request.URL.RawQuery != "" {
			t.Errorf("unexpected target: %s %s", request.Method, request.URL.String())
		}
		if got := request.Header.Get("Authorization"); got != "Bearer "+string(deviceToken) {
			t.Errorf("Authorization = %q", got)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		want := `{"agentVersion":"1.0.0","rustdeskVersion":"1.4.2","rustdeskId":"123456789","operatingSystem":"Windows","osVersion":"11.0.26100"}`
		if string(body) != want {
			t.Errorf("body = %s, want %s", body, want)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"deviceId":"device-1","lastSeenAt":"2026-09-30T12:00:00.000Z"}`))
	}), time.Second)
	got, err := client.Heartbeat(context.Background(), deviceToken, HeartbeatRequest{
		AgentVersion: "1.0.0", RustDeskVersion: "1.4.2", RustDeskID: "123456789", OperatingSystem: "Windows", OSVersion: "11.0.26100",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.DeviceID != "device-1" || got.LastSeenAt.IsZero() {
		t.Fatalf("response = %#v", got)
	}
}

func TestHeartbeatStrictStatusMalformedAndSecretRedaction(t *testing.T) {
	token := []byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	request := HeartbeatRequest{AgentVersion: "1", RustDeskVersion: "1", RustDeskID: "123", OperatingSystem: "Windows", OSVersion: "11"}
	tests := []struct {
		status int
		body   string
		want   ErrorCode
	}{
		{400, `{"error":{"code":"INVALID_HEARTBEAT","message":"Invalid heartbeat"}}`, ErrorInvalidHeartbeat},
		{401, `{"error":{"code":"UNAUTHENTICATED","message":"Authentication required"}}`, ErrorUnauthenticated},
		{403, `{"error":{"code":"HEARTBEAT_FORBIDDEN","message":"Access denied"}}`, ErrorHeartbeatForbidden},
		{503, `{"error":{"code":"HEARTBEAT_UNAVAILABLE","message":"Unavailable"}}`, ErrorHeartbeatUnavailable},
		{200, `{"deviceId":"device-1","lastSeenAt":"bad","extra":true}`, ErrorUnexpectedResponse},
	}
	for _, test := range tests {
		client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(test.status)
			_, _ = response.Write([]byte(test.body))
		}), time.Second)
		_, err := client.Heartbeat(context.Background(), token, request)
		if !IsCode(err, test.want) {
			t.Fatalf("status %d: error = %v, want %s", test.status, err, test.want)
		}
		if strings.Contains(err.Error(), string(token)) {
			t.Fatalf("token leaked in error: %v", err)
		}
	}

	httpClient := &http.Client{Transport: errorTransport{secret: string(token)}}
	client, err := NewClient("https://api.example.test", Options{HTTPClient: httpClient, RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Heartbeat(context.Background(), token, request)
	if err == nil || strings.Contains(err.Error(), string(token)) || strings.Contains(err.Error(), "private") {
		t.Fatalf("transport error leaked: %v", err)
	}
}

func TestHeartbeatRejectsInvalidBearerBeforeNetwork(t *testing.T) {
	var calls atomic.Int32
	client := testClient(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }), time.Second)
	_, err := client.Heartbeat(context.Background(), []byte("not-a-device-token"), HeartbeatRequest{
		AgentVersion: "1", RustDeskVersion: "1", RustDeskID: "123", OperatingSystem: "Windows", OSVersion: "11",
	})
	if !IsCode(err, ErrorUnauthenticated) || calls.Load() != 0 {
		t.Fatalf("error=%v calls=%d", err, calls.Load())
	}
}

func TestHeartbeatNeverForwardsBearerOnRedirect(t *testing.T) {
	token := []byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	var destinationCalls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		destinationCalls.Add(1)
		if request.Header.Get("Authorization") != "" {
			t.Error("bearer was forwarded")
		}
	}))
	defer destination.Close()
	client := testClient(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, destination.URL, http.StatusTemporaryRedirect)
	}), time.Second)
	_, err := client.Heartbeat(context.Background(), token, HeartbeatRequest{
		AgentVersion: "1", RustDeskVersion: "1", RustDeskID: "123", OperatingSystem: "Windows", OSVersion: "11",
	})
	if !IsCode(err, ErrorUnexpectedResponse) || destinationCalls.Load() != 0 {
		t.Fatalf("error=%v destination calls=%d", err, destinationCalls.Load())
	}
}
