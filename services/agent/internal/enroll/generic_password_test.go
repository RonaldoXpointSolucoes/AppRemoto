package enroll

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
)

const commonTestPassword = "Shared-synthetic-only-42!"

type rotationTestAPI struct {
	*fakeAPI
	stageCalls, confirmCalls     int
	stageError, confirmError     error
	stageRequest, confirmRequest api.EnrollRequest
	deviceID                     string
}

func (client *rotationTestAPI) GenericPassword(_ context.Context, token []byte, request api.EnrollRequest) (api.GenericPasswordResponse, error) {
	client.stageCalls++
	client.stageRequest = request
	id := client.deviceID
	if id == "" {
		id = client.response.DeviceID
	}
	return api.GenericPasswordResponse{DeviceID: id, RustDeskPassword: commonTestPassword, RotationID: "rotation-1"}, client.stageError
}
func (client *rotationTestAPI) ConfirmGenericPassword(_ context.Context, token []byte, request api.EnrollRequest) (api.GenericPasswordConfirmation, error) {
	client.confirmCalls++
	client.confirmRequest = request
	return api.GenericPasswordConfirmation{DeviceID: client.response.DeviceID, Applied: true}, client.confirmError
}
func (store *fakeArtifacts) ReplaceGenericPassword(data []byte) error {
	if store.failOn == genericPasswordArtifact {
		return errors.New("synthetic private failure")
	}
	store.values[genericPasswordArtifact] = append([]byte(nil), data...)
	return nil
}

func existingRotationFixture(t *testing.T) (*Service, *rotationTestAPI, *fakeRustDesk, *fakeArtifacts, Result) {
	t.Helper()
	base := successfulAPI()
	rd := &fakeRustDesk{}
	artifacts := newFakeArtifacts()
	s := newTestService(base, rd, artifacts, fakeProtector{})
	result, err := s.Run(context.Background(), []byte(testEnrollmentToken), validMetadata())
	if err != nil {
		t.Fatal(err)
	}
	client := &rotationTestAPI{fakeAPI: base}
	s.api = client
	s.genericInstallation = true
	return s, client, rd, artifacts, result
}

func TestGenericReinstallMigratesPasswordWithoutChangingIdentity(t *testing.T) {
	s, client, rd, artifacts, first := existingRotationFixture(t)
	before := append([]byte(nil), artifacts.values[credentialsArtifact]...)
	result, err := s.Run(context.Background(), []byte(strings.Repeat("n", 43)), validMetadata())
	if err != nil {
		t.Fatal(err)
	}
	if result.DeviceID != first.DeviceID || string(result.DeviceToken) != string(first.DeviceToken) || !result.Existing || client.calls != 1 || client.stageCalls != 1 || client.confirmCalls != 1 || rd.password != commonTestPassword {
		t.Fatal("generic migration failed")
	}
	if !bytes.Equal(before, artifacts.values[credentialsArtifact]) {
		t.Fatal("original identity credentials were replaced")
	}
	for _, secret := range []string{commonTestPassword, testDeviceToken, strings.Repeat("n", 43)} {
		if bytes.Contains(artifacts.values[genericPasswordArtifact], []byte(secret)) {
			t.Fatal("rotation proof persisted in plaintext")
		}
	}
	journal, exists, err := s.loadGenericPassword(client.request.DeviceUUID)
	if err != nil || !exists || !journal.Confirmed || journal.Password != commonTestPassword {
		t.Fatal("confirmed rotated credential not durable")
	}
	if _, err = s.Run(context.Background(), nil, validMetadata()); err != nil || client.stageCalls != 1 || client.confirmCalls != 1 {
		t.Fatal("ordinary restart repeated rotation")
	}
}

func TestGenericPasswordPreflightIsDurableBeforeServerMutation(t *testing.T) {
	s, client, rd, artifacts, _ := existingRotationFixture(t)
	artifacts.failOn = genericPasswordArtifact
	_, err := s.Run(context.Background(), []byte(strings.Repeat("n", 43)), validMetadata())
	if err == nil || client.stageCalls != 0 || client.confirmCalls != 0 || rd.passwordCalls != 1 {
		t.Fatal("password mutation preceded durable preflight")
	}
}

func TestGenericPasswordLostStageResponseResumesOriginalProofBeforeReconfigure(t *testing.T) {
	s, client, rd, _, _ := existingRotationFixture(t)
	client.stageError = errors.New("synthetic lost response")
	oldToken := strings.Repeat("n", 43)
	if _, err := s.Run(context.Background(), []byte(oldToken), validMetadata()); err == nil {
		t.Fatal("lost response reported success")
	}
	if rd.passwordCalls != 1 {
		t.Fatal("applied unavailable password")
	}
	client.stageError = nil
	if _, err := s.Run(context.Background(), nil, validMetadata()); err != nil {
		t.Fatal(err)
	}
	if client.reconfigureCalls != 1 || client.stageCalls != 2 || client.confirmCalls != 1 || client.confirmRequest.EnrollmentToken != oldToken || rd.password != commonTestPassword {
		t.Fatal("resume lost original proof or skipped pending rotation")
	}
}

func TestGenericPasswordLostConfirmResponseRetriesSavedPassword(t *testing.T) {
	s, client, rd, _, _ := existingRotationFixture(t)
	client.confirmError = errors.New("synthetic lost confirmation")
	if _, err := s.Run(context.Background(), []byte(strings.Repeat("n", 43)), validMetadata()); err == nil {
		t.Fatal("unconfirmed password reached heartbeat")
	}
	client.confirmError = nil
	if _, err := s.Run(context.Background(), nil, validMetadata()); err != nil {
		t.Fatal(err)
	}
	if client.stageCalls != 1 || client.confirmCalls != 2 || rd.passwordCalls != 3 || client.stageRequest != client.confirmRequest {
		t.Fatal("recovery changed the staged proof/password")
	}
}

func TestGenericPasswordRejectsWrongDeviceBeforeApplying(t *testing.T) {
	s, client, rd, _, _ := existingRotationFixture(t)
	client.deviceID = "wrong-device"
	if _, err := s.Run(context.Background(), []byte(strings.Repeat("n", 43)), validMetadata()); err == nil || rd.passwordCalls != 1 || client.confirmCalls != 0 {
		t.Fatal("wrong device password accepted")
	}
}
