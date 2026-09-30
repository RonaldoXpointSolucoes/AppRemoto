package enroll

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/secret"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
)

const (
	pendingArtifact           = "enrollment-pending.json"
	credentialsArtifact       = "enrollment-credentials.json"
	configuredArtifact        = "rustdesk-configured.json"
	maxArtifactBytes    int64 = 128 * 1024
)

var (
	ErrManualReconciliation  = errors.New("enrollment state requires manual reconciliation")
	ErrRustDeskConfiguration = errors.New("RustDesk password configuration failed; retry without an enrollment token")
)

type APIClient interface {
	Enroll(context.Context, api.EnrollRequest) (api.EnrollResponse, error)
}
type RustDeskClient interface {
	Discover(context.Context) (rustdesk.Info, error)
	SetUnattendedPassword(context.Context, string) error
}
type Protector interface {
	Protect([]byte) ([]byte, error)
	Unprotect([]byte) ([]byte, error)
}
type artifactStore interface {
	Load(string, int64) ([]byte, error)
	Publish(string, []byte) error
}

type Metadata struct{ DisplayName, Hostname, OperatingSystem, OSVersion, AgentVersion string }
type Result struct {
	DeviceID                 string
	DeviceToken              []byte
	HeartbeatIntervalSeconds int
	Existing                 bool
}

type Options struct {
	StateDirectory string
	API            APIClient
	RustDesk       RustDeskClient
	Protector      Protector
}

type Service struct {
	api             APIClient
	rustdesk        RustDeskClient
	artifacts       artifactStore
	protector       Protector
	prepareIdentity func(string) error
	loadIdentity    func(string) (state.Identity, error)
	stateDirectory  string
}

type dpapiProtector struct{}

func (dpapiProtector) Protect(value []byte) ([]byte, error)   { return secret.Protect(value) }
func (dpapiProtector) Unprotect(value []byte) ([]byte, error) { return secret.Unprotect(value) }

type fileArtifacts struct{ directory string }

func (store fileArtifacts) Load(name string, maximum int64) ([]byte, error) {
	return state.LoadArtifact(store.directory, name, maximum)
}
func (store fileArtifacts) Publish(name string, value []byte) error {
	return state.PublishArtifact(store.directory, name, value)
}

func NewService(options Options) (*Service, error) {
	if options.StateDirectory == "" || options.API == nil || options.RustDesk == nil {
		return nil, errors.New("incomplete enrollment service configuration")
	}
	protector := options.Protector
	if protector == nil {
		protector = dpapiProtector{}
	}
	return &Service{api: options.API, rustdesk: options.RustDesk, protector: protector,
		artifacts: fileArtifacts{directory: options.StateDirectory}, prepareIdentity: state.PrepareIdentityDirectory,
		loadIdentity: state.LoadOrCreateIdentity, stateDirectory: options.StateDirectory}, nil
}

type marker struct {
	Version    int    `json:"version"`
	DeviceUUID string `json:"deviceUuid,omitempty"`
}
type protectedCredentials struct {
	Version                  int    `json:"version"`
	DeviceID                 string `json:"deviceId"`
	DeviceToken              []byte `json:"deviceTokenBlob"`
	RustDeskPassword         []byte `json:"rustdeskPasswordBlob"`
	HeartbeatIntervalSeconds int    `json:"heartbeatIntervalSeconds"`
}

func (service *Service) Run(ctx context.Context, enrollmentToken []byte, metadata Metadata) (Result, error) {
	if err := service.prepareIdentity(service.stateDirectory); err != nil {
		return Result{}, errors.New("prepare protected agent state failed")
	}
	identity, err := service.loadIdentity(filepath.Join(service.stateDirectory, "identity.json"))
	if err != nil {
		return Result{}, errors.New("load stable device identity failed")
	}
	pending, pendingExists, err := service.loadMarker(pendingArtifact)
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	credentials, credentialsExist, err := service.loadCredentials()
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	configured, configuredExists, err := service.loadMarker(configuredArtifact)
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	if credentialsExist {
		if !pendingExists || pending.DeviceUUID != identity.DeviceUUID {
			return Result{}, ErrManualReconciliation
		}
		if configuredExists && configured.Version != 1 {
			return Result{}, ErrManualReconciliation
		}
		return service.resume(ctx, credentials, configuredExists)
	}
	if configuredExists || pendingExists {
		return Result{}, ErrManualReconciliation
	}

	info, err := service.rustdesk.Discover(ctx)
	if err != nil {
		return Result{}, errors.New("trusted RustDesk discovery failed")
	}
	request := api.EnrollRequest{EnrollmentToken: string(enrollmentToken), DeviceUUID: identity.DeviceUUID,
		DisplayName: metadata.DisplayName, Hostname: metadata.Hostname, OperatingSystem: metadata.OperatingSystem,
		OSVersion: metadata.OSVersion, AgentVersion: metadata.AgentVersion, RustDeskID: info.ID, RustDeskVersion: info.Version}
	if err := api.ValidateEnrollRequest(request); err != nil {
		return Result{}, errors.New("invalid enrollment inputs")
	}
	pendingData, _ := json.Marshal(marker{Version: 1, DeviceUUID: identity.DeviceUUID})
	if err := service.artifacts.Publish(pendingArtifact, pendingData); err != nil {
		clear(pendingData)
		return Result{}, errors.New("persist enrollment preflight failed")
	}
	clear(pendingData)
	response, err := service.api.Enroll(ctx, request)
	request.EnrollmentToken = ""
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	return service.acceptResponse(ctx, response)
}

func (service *Service) acceptResponse(ctx context.Context, response api.EnrollResponse) (Result, error) {
	deviceToken := []byte(response.DeviceToken)
	password := []byte(response.RustDeskPassword)
	response.DeviceToken, response.RustDeskPassword = "", ""
	protectedToken, err := service.protector.Protect(deviceToken)
	if err != nil {
		clear(deviceToken)
		clear(password)
		return Result{}, ErrManualReconciliation
	}
	protectedPassword, err := service.protector.Protect(password)
	if err != nil {
		clear(deviceToken)
		clear(password)
		clear(protectedToken)
		return Result{}, ErrManualReconciliation
	}
	credentials := protectedCredentials{Version: 1, DeviceID: response.DeviceID, DeviceToken: protectedToken,
		RustDeskPassword: protectedPassword, HeartbeatIntervalSeconds: response.HeartbeatIntervalSeconds}
	serialized, err := json.Marshal(credentials)
	clear(protectedToken)
	clear(protectedPassword)
	if err != nil {
		clear(deviceToken)
		clear(password)
		return Result{}, ErrManualReconciliation
	}
	if err := service.artifacts.Publish(credentialsArtifact, serialized); err != nil {
		clear(serialized)
		clear(deviceToken)
		clear(password)
		return Result{}, ErrManualReconciliation
	}
	clear(serialized)
	if err := service.rustdesk.SetUnattendedPassword(ctx, string(password)); err != nil {
		clear(deviceToken)
		clear(password)
		return Result{}, ErrRustDeskConfiguration
	}
	clear(password)
	if err := service.publishConfigured(); err != nil {
		clear(deviceToken)
		return Result{}, ErrRustDeskConfiguration
	}
	return Result{DeviceID: response.DeviceID, DeviceToken: deviceToken,
		HeartbeatIntervalSeconds: response.HeartbeatIntervalSeconds}, nil
}

func (service *Service) resume(ctx context.Context, credentials protectedCredentials, configured bool) (Result, error) {
	deviceToken, err := service.protector.Unprotect(credentials.DeviceToken)
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	if !configured {
		password, err := service.protector.Unprotect(credentials.RustDeskPassword)
		if err != nil {
			clear(deviceToken)
			return Result{}, ErrManualReconciliation
		}
		if err := service.rustdesk.SetUnattendedPassword(ctx, string(password)); err != nil {
			clear(password)
			clear(deviceToken)
			return Result{}, ErrRustDeskConfiguration
		}
		clear(password)
		if err := service.publishConfigured(); err != nil {
			clear(deviceToken)
			return Result{}, ErrRustDeskConfiguration
		}
	}
	return Result{DeviceID: credentials.DeviceID, DeviceToken: deviceToken,
		HeartbeatIntervalSeconds: credentials.HeartbeatIntervalSeconds, Existing: true}, nil
}

func (service *Service) publishConfigured() error {
	data, _ := json.Marshal(marker{Version: 1})
	defer clear(data)
	return service.artifacts.Publish(configuredArtifact, data)
}

func (service *Service) loadMarker(name string) (marker, bool, error) {
	data, err := service.artifacts.Load(name, 1024)
	if errors.Is(err, os.ErrNotExist) {
		return marker{}, false, nil
	}
	if err != nil {
		return marker{}, false, err
	}
	defer clear(data)
	var value marker
	if decodeStrict(data, &value) != nil || value.Version != 1 {
		return marker{}, false, errors.New("invalid marker")
	}
	return value, true, nil
}

func (service *Service) loadCredentials() (protectedCredentials, bool, error) {
	data, err := service.artifacts.Load(credentialsArtifact, maxArtifactBytes)
	if errors.Is(err, os.ErrNotExist) {
		return protectedCredentials{}, false, nil
	}
	if err != nil {
		return protectedCredentials{}, false, err
	}
	defer clear(data)
	var value protectedCredentials
	if decodeStrict(data, &value) != nil || value.Version != 1 || value.DeviceID == "" || len(value.DeviceID) > 36 ||
		len(value.DeviceToken) == 0 || len(value.RustDeskPassword) == 0 || value.HeartbeatIntervalSeconds < 10 || value.HeartbeatIntervalSeconds > 300 {
		clear(value.DeviceToken)
		clear(value.RustDeskPassword)
		return protectedCredentials{}, false, errors.New("invalid credentials")
	}
	return value, true, nil
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
