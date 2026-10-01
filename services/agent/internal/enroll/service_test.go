package enroll

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
)

const (
	testEnrollmentToken = "synthetic-enrollment-token-00000000"
	testDeviceToken     = "dddddddddddddddddddddddddddddddd"
	testPassword        = "Password123!"
)

type fakeAPI struct {
	calls    int
	request  api.EnrollRequest
	response api.EnrollResponse
	err      error
}

func (client *fakeAPI) Enroll(_ context.Context, request api.EnrollRequest) (api.EnrollResponse, error) {
	client.calls++
	client.request = request
	return client.response, client.err
}

type fakeRustDesk struct {
	discoverCalls, passwordCalls int
	password                     string
	discoverErr, passwordErr     error
}

func (client *fakeRustDesk) Discover(context.Context) (rustdesk.Info, error) {
	client.discoverCalls++
	return rustdesk.Info{ExecutablePath: `C:\Program Files\RustDesk\RustDesk.exe`, ID: "123456789", Version: "1.4.2"}, client.discoverErr
}
func (client *fakeRustDesk) SetUnattendedPassword(_ context.Context, password string) error {
	client.passwordCalls++
	client.password = password
	return client.passwordErr
}

type fakeArtifacts struct {
	values map[string][]byte
	failOn string
}

func newFakeArtifacts() *fakeArtifacts { return &fakeArtifacts{values: make(map[string][]byte)} }
func (store *fakeArtifacts) Load(name string, _ int64) ([]byte, error) {
	value, ok := store.values[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), value...), nil
}
func (store *fakeArtifacts) Publish(name string, value []byte) error {
	if name == store.failOn {
		return errors.New("secret SENTINEL from filesystem")
	}
	if _, exists := store.values[name]; exists {
		return os.ErrExist
	}
	store.values[name] = append([]byte(nil), value...)
	return nil
}

type fakeProtector struct{ failValue string }

func (protector fakeProtector) Protect(value []byte) ([]byte, error) {
	if protector.failValue != "" && bytes.HasSuffix(value, []byte(protector.failValue)) {
		return nil, errors.New("DPAPI exposed " + string(value))
	}
	protected := append([]byte(nil), value...)
	for index := range protected {
		protected[index] ^= 0xa5
	}
	return protected, nil
}
func (fakeProtector) Unprotect(value []byte) ([]byte, error) {
	plaintext := append([]byte(nil), value...)
	for index := range plaintext {
		plaintext[index] ^= 0xa5
	}
	return plaintext, nil
}

func newTestService(apiClient *fakeAPI, rustDesk *fakeRustDesk, artifacts *fakeArtifacts, protector Protector) *Service {
	return &Service{api: apiClient, rustdesk: rustDesk, artifacts: artifacts, protector: protector,
		prepareIdentity: func(string) error { return nil },
		loadIdentity: func(string) (state.Identity, error) {
			return state.Identity{DeviceUUID: "00000000-0000-4000-8000-000000000001"}, nil
		},
		stateDirectory: `C:\safe-agent-state`}
}
func validMetadata() Metadata {
	return Metadata{DisplayName: "Test PC", Hostname: "test-pc", OperatingSystem: "Windows", OSVersion: "11", AgentVersion: "1.0.0"}
}
func successfulAPI() *fakeAPI {
	return &fakeAPI{response: api.EnrollResponse{DeviceID: "device-1", DeviceToken: testDeviceToken, RustDeskPassword: testPassword, HeartbeatIntervalSeconds: 30}}
}

func TestFirstRunEnrollsOnceProtectsBothSecretsAndConfiguresRustDesk(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	result, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if apiClient.calls != 1 || rustDesk.discoverCalls != 1 || rustDesk.passwordCalls != 1 {
		t.Fatalf("calls: api=%d discover=%d password=%d", apiClient.calls, rustDesk.discoverCalls, rustDesk.passwordCalls)
	}
	if apiClient.request.EnrollmentToken != testEnrollmentToken || apiClient.request.DeviceUUID == "" || apiClient.request.RustDeskID != "123456789" {
		t.Fatalf("unexpected request: %#v", apiClient.request)
	}
	if rustDesk.password != testPassword || string(result.DeviceToken) != testDeviceToken || result.Existing {
		t.Fatalf("unexpected result: %#v", result)
	}
	serialized := string(artifacts.values[credentialsArtifact])
	for _, plaintext := range []string{testEnrollmentToken, testDeviceToken, testPassword} {
		if strings.Contains(serialized, plaintext) {
			t.Fatalf("persisted state contains plaintext %q", plaintext)
		}
	}
	if _, ok := artifacts.values[pendingArtifact]; !ok {
		t.Fatal("preflight marker not persisted")
	}
	if _, ok := artifacts.values[configuredArtifact]; !ok {
		t.Fatal("configured marker not persisted")
	}
}

func TestExistingEnrollmentNeverCallsEnrollOrRotatesCredentials(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	first, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if err != nil {
		t.Fatal(err)
	}
	credentialState := append([]byte(nil), artifacts.values[credentialsArtifact]...)
	second, err := service.Run(context.Background(), []byte("another-enrollment-token-00000000"), validMetadata())
	if err != nil {
		t.Fatal(err)
	}
	if apiClient.calls != 1 || rustDesk.passwordCalls != 1 || rustDesk.discoverCalls != 1 {
		t.Fatalf("existing enrollment caused side effects: api=%d discover=%d password=%d", apiClient.calls, rustDesk.discoverCalls, rustDesk.passwordCalls)
	}
	if !second.Existing || string(second.DeviceToken) != string(first.DeviceToken) || string(artifacts.values[credentialsArtifact]) != string(credentialState) {
		t.Fatal("credentials rotated")
	}
}

func TestDPAPIFailureLeavesDurableManualReconciliationState(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{failValue: testDeviceToken})
	_, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if !errors.Is(err, ErrManualReconciliation) || strings.Contains(err.Error(), testDeviceToken) {
		t.Fatalf("unexpected error: %v", err)
	}
	if apiClient.calls != 1 || rustDesk.passwordCalls != 0 {
		t.Fatalf("unexpected calls: api=%d password=%d", apiClient.calls, rustDesk.passwordCalls)
	}
	_, err = service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if !errors.Is(err, ErrManualReconciliation) || apiClient.calls != 1 {
		t.Fatalf("retry was not blocked: error=%v calls=%d", err, apiClient.calls)
	}
}

func TestRustDeskFailureResumesFromProtectedStateWithoutReenrollment(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{passwordErr: errors.New("failure mentions Password123!")}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	_, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if err == nil || strings.Contains(err.Error(), testPassword) {
		t.Fatalf("unexpected first error: %v", err)
	}
	if _, ok := artifacts.values[credentialsArtifact]; !ok {
		t.Fatal("protected recovery state was not persisted")
	}
	rustDesk.passwordErr = nil
	result, err := service.Run(context.Background(), nil, validMetadata())
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if apiClient.calls != 1 || rustDesk.passwordCalls != 2 || !result.Existing || string(result.DeviceToken) != testDeviceToken {
		t.Fatalf("unexpected resume: api=%d password=%d result=%#v", apiClient.calls, rustDesk.passwordCalls, result)
	}
}

func TestIndeterminateHTTPResponseIsNeverRetried(t *testing.T) {
	apiClient := successfulAPI()
	apiClient.err = &api.Error{Code: api.ErrorUnavailable}
	rustDesk, artifacts := &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	_, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if !errors.Is(err, ErrManualReconciliation) {
		t.Fatalf("unexpected error: %v", err)
	}
	apiClient.err = &api.Error{Code: api.ErrorEnrollmentDenied}
	_, err = service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if !errors.Is(err, ErrManualReconciliation) || apiClient.calls != 1 {
		t.Fatalf("indeterminate request retried: error=%v calls=%d", err, apiClient.calls)
	}
}

func TestSwappedProtectedFieldsFailBeforeAPIOrRustDeskUse(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	if _, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata()); err != nil {
		t.Fatal(err)
	}
	var credentials protectedCredentials
	if err := json.Unmarshal(artifacts.values[credentialsArtifact], &credentials); err != nil {
		t.Fatal(err)
	}
	credentials.DeviceToken, credentials.RustDeskPassword = credentials.RustDeskPassword, credentials.DeviceToken
	swapped, err := json.Marshal(credentials)
	if err != nil {
		t.Fatal(err)
	}
	artifacts.values[credentialsArtifact] = swapped
	delete(artifacts.values, configuredArtifact)
	apiClient.calls = 0
	rustDesk.discoverCalls = 0
	rustDesk.passwordCalls = 0

	_, err = service.Run(context.Background(), nil, validMetadata())
	if !errors.Is(err, ErrManualReconciliation) {
		t.Fatalf("swapped fields error = %v, want manual reconciliation", err)
	}
	if apiClient.calls != 0 || rustDesk.discoverCalls != 0 || rustDesk.passwordCalls != 0 {
		t.Fatalf("swapped fields reached a consumer: api=%d discover=%d password=%d", apiClient.calls, rustDesk.discoverCalls, rustDesk.passwordCalls)
	}
}

func TestProtectedFieldsAreCryptographicallyBoundToStableIdentity(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	if _, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata()); err != nil {
		t.Fatal(err)
	}
	const otherUUID = "00000000-0000-4000-8000-000000000002"
	service.loadIdentity = func(string) (state.Identity, error) { return state.Identity{DeviceUUID: otherUUID}, nil }
	pending, err := json.Marshal(marker{Version: 1, DeviceUUID: otherUUID})
	if err != nil {
		t.Fatal(err)
	}
	artifacts.values[pendingArtifact] = pending
	apiClient.calls = 0
	rustDesk.discoverCalls = 0
	rustDesk.passwordCalls = 0

	_, err = service.Run(context.Background(), nil, validMetadata())
	if !errors.Is(err, ErrManualReconciliation) {
		t.Fatalf("identity substitution error = %v", err)
	}
	if apiClient.calls != 0 || rustDesk.discoverCalls != 0 || rustDesk.passwordCalls != 0 {
		t.Fatalf("identity substitution reached a consumer: api=%d discover=%d password=%d", apiClient.calls, rustDesk.discoverCalls, rustDesk.passwordCalls)
	}
}

func TestLegacyUnboundCredentialStateFailsClosed(t *testing.T) {
	apiClient, rustDesk, artifacts := successfulAPI(), &fakeRustDesk{}, newFakeArtifacts()
	service := newTestService(apiClient, rustDesk, artifacts, fakeProtector{})
	if _, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata()); err != nil {
		t.Fatal(err)
	}
	var credentials protectedCredentials
	if err := json.Unmarshal(artifacts.values[credentialsArtifact], &credentials); err != nil {
		t.Fatal(err)
	}
	credentials.Version = 1
	legacy, err := json.Marshal(credentials)
	if err != nil {
		t.Fatal(err)
	}
	artifacts.values[credentialsArtifact] = legacy
	apiClient.calls = 0
	rustDesk.discoverCalls = 0
	rustDesk.passwordCalls = 0
	_, err = service.Run(context.Background(), nil, validMetadata())
	if !errors.Is(err, ErrManualReconciliation) {
		t.Fatalf("legacy state error = %v", err)
	}
	if apiClient.calls != 0 || rustDesk.discoverCalls != 0 || rustDesk.passwordCalls != 0 {
		t.Fatalf("legacy state reached a consumer: api=%d discover=%d password=%d", apiClient.calls, rustDesk.discoverCalls, rustDesk.passwordCalls)
	}
}

func TestFileArtifactsUsePreparedRestrictedDirectoryAndAtomicPublication(t *testing.T) {
	if os.PathSeparator != '\\' {
		t.Skip("Windows ACL integration test")
	}
	directory := filepath.Join(t.TempDir(), "agent-state")
	if err := state.PrepareIdentityDirectory(directory); err != nil {
		t.Fatalf("PrepareIdentityDirectory: %v", err)
	}
	store := fileArtifacts{directory: directory}
	value := []byte(`{"version":1}`)
	if _, err := store.Load(pendingArtifact, 1024); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing artifact error = %v", err)
	}
	if err := store.Publish(pendingArtifact, value); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	loaded, err := store.Load(pendingArtifact, 1024)
	if err != nil || string(loaded) != string(value) {
		t.Fatalf("Load: value=%q error=%v", loaded, err)
	}
	if err := store.Publish(pendingArtifact, []byte("replacement")); !errors.Is(err, os.ErrExist) {
		t.Fatalf("append-only artifact was replaceable: %v", err)
	}
}

func TestServiceRoundTripUsesRealCurrentUserDPAPI(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows DPAPI integration test")
	}
	apiClient, rustDesk := successfulAPI(), &fakeRustDesk{}
	directory := filepath.Join(t.TempDir(), "agent-state")
	service, err := NewService(Options{StateDirectory: directory, API: apiClient, RustDesk: rustDesk})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	second, err := service.Run(context.Background(), nil, validMetadata())
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	if apiClient.calls != 1 || !second.Existing || string(first.DeviceToken) != string(second.DeviceToken) {
		t.Fatalf("credentials were not reused: calls=%d first=%#v second=%#v", apiClient.calls, first, second)
	}
	data, err := os.ReadFile(filepath.Join(directory, credentialsArtifact))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(data)
	for _, plaintext := range []string{testEnrollmentToken, testDeviceToken, testPassword} {
		if strings.Contains(string(data), plaintext) {
			t.Fatalf("DPAPI artifact contains plaintext %q", plaintext)
		}
	}
}
