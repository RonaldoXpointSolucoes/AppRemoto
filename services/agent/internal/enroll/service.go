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
	pendingArtifact               = "enrollment-pending.json"
	credentialsArtifact           = "enrollment-credentials.json"
	configuredArtifact            = "rustdesk-configured.json"
	maxArtifactBytes        int64 = 128 * 1024
	credentialsVersion            = 2
	deviceTokenPurpose            = "device-token"
	rustDeskPasswordPurpose       = "rustdesk-password"
	secretBindingMagic            = "appremoto-agent-secret-v1\x00"
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
	Progress       func(operation, result string, err error)
}

type Service struct {
	api             APIClient
	rustdesk        RustDeskClient
	artifacts       artifactStore
	protector       Protector
	prepareIdentity func(string) error
	loadIdentity    func(string) (state.Identity, error)
	stateDirectory  string
	progress        func(operation, result string, err error)
}

// StageError preserves the OS cause for safe numeric diagnostics without
// including filenames, credentials or arbitrary underlying text in Error().
type StageError struct {
	Operation string
	cause     error
}

func (e *StageError) Error() string { return e.Operation + " failed" }
func (e *StageError) Unwrap() error { return e.cause }

func (service *Service) stage(operation string, action func() error) error {
	if service.progress != nil {
		service.progress(operation, "START", nil)
	}
	if err := action(); err != nil {
		failure := &StageError{Operation: operation, cause: err}
		if service.progress != nil {
			service.progress(operation, "ERROR", failure)
		}
		return failure
	}
	if service.progress != nil {
		service.progress(operation, "OK", nil)
	}
	return nil
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
		loadIdentity: state.LoadOrCreateIdentity, stateDirectory: options.StateDirectory, progress: options.Progress}, nil
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
	if err := service.stage("IDENTITY_DIRECTORY_PREPARE", func() error { return service.prepareIdentity(service.stateDirectory) }); err != nil {
		return Result{}, err
	}
	var identity state.Identity
	if err := service.stage("IDENTITY_LOAD_CREATE", func() error {
		var err error
		identity, err = service.loadIdentity(filepath.Join(service.stateDirectory, "identity.json"))
		return err
	}); err != nil {
		return Result{}, err
	}
	var pending, configured marker
	var credentials protectedCredentials
	var pendingExists, credentialsExist, configuredExists bool
	if err := service.stage("PENDING_STATE_READ", func() error {
		var err error
		pending, pendingExists, err = service.loadMarker(pendingArtifact)
		if err != nil {
			return errors.Join(ErrManualReconciliation, err)
		}
		return nil
	}); err != nil {
		return Result{}, err
	}
	if err := service.stage("CREDENTIALS_READ", func() error {
		var err error
		credentials, credentialsExist, err = service.loadCredentials()
		if err != nil {
			return errors.Join(ErrManualReconciliation, err)
		}
		return nil
	}); err != nil {
		return Result{}, err
	}
	if err := service.stage("PASSWORD_STATE_READ", func() error {
		var err error
		configured, configuredExists, err = service.loadMarker(configuredArtifact)
		if err != nil {
			return errors.Join(ErrManualReconciliation, err)
		}
		return nil
	}); err != nil {
		return Result{}, err
	}
	if credentialsExist {
		if !pendingExists || pending.DeviceUUID != identity.DeviceUUID {
			return Result{}, ErrManualReconciliation
		}
		if configuredExists && configured.Version != 1 {
			return Result{}, ErrManualReconciliation
		}
		return service.resume(ctx, identity.DeviceUUID, credentials, configuredExists)
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
	if err := service.stage("ENROLLMENT_PREFLIGHT_WRITE", func() error { return service.artifacts.Publish(pendingArtifact, pendingData) }); err != nil {
		clear(pendingData)
		return Result{}, err
	}
	clear(pendingData)
	response, err := service.api.Enroll(ctx, request)
	request.EnrollmentToken = ""
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	return service.acceptResponse(ctx, identity.DeviceUUID, response)
}

func (service *Service) acceptResponse(ctx context.Context, deviceUUID string, response api.EnrollResponse) (Result, error) {
	deviceToken := []byte(response.DeviceToken)
	password := []byte(response.RustDeskPassword)
	response.DeviceToken, response.RustDeskPassword = "", ""
	protectedToken, err := service.protectBound(deviceTokenPurpose, deviceUUID, deviceToken)
	if err != nil {
		clear(protectedToken)
		clear(deviceToken)
		clear(password)
		return Result{}, ErrManualReconciliation
	}
	protectedPassword, err := service.protectBound(rustDeskPasswordPurpose, deviceUUID, password)
	if err != nil {
		clear(protectedPassword)
		clear(deviceToken)
		clear(password)
		clear(protectedToken)
		return Result{}, ErrManualReconciliation
	}
	credentials := protectedCredentials{Version: credentialsVersion, DeviceID: response.DeviceID, DeviceToken: protectedToken,
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

func (service *Service) resume(ctx context.Context, deviceUUID string, credentials protectedCredentials, configured bool) (Result, error) {
	defer clear(credentials.DeviceToken)
	defer clear(credentials.RustDeskPassword)
	deviceToken, err := service.unprotectBound(deviceTokenPurpose, deviceUUID, credentials.DeviceToken, 32, 512)
	if err != nil {
		return Result{}, ErrManualReconciliation
	}
	if !configured {
		password, err := service.unprotectBound(rustDeskPasswordPurpose, deviceUUID, credentials.RustDeskPassword, 8, 128)
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

func (service *Service) protectBound(purpose, deviceUUID string, plaintext []byte) ([]byte, error) {
	prefix := secretBindingPrefix(purpose, deviceUUID)
	bound := make([]byte, 0, len(prefix)+len(plaintext))
	bound = append(bound, prefix...)
	bound = append(bound, plaintext...)
	clear(prefix)
	protected, err := service.protector.Protect(bound)
	clear(bound)
	return protected, err
}

func (service *Service) unprotectBound(purpose, deviceUUID string, protected []byte, minimum, maximum int) ([]byte, error) {
	bound, err := service.protector.Unprotect(protected)
	if err != nil {
		clear(bound)
		return nil, err
	}
	defer clear(bound)
	prefix := secretBindingPrefix(purpose, deviceUUID)
	defer clear(prefix)
	if !bytes.HasPrefix(bound, prefix) {
		return nil, errors.New("protected secret binding mismatch")
	}
	plaintext := bound[len(prefix):]
	if len(plaintext) < minimum || len(plaintext) > maximum {
		return nil, errors.New("protected secret length is invalid")
	}
	return append([]byte(nil), plaintext...), nil
}

func secretBindingPrefix(purpose, deviceUUID string) []byte {
	prefix := make([]byte, 0, len(secretBindingMagic)+len(purpose)+len(deviceUUID)+2)
	prefix = append(prefix, secretBindingMagic...)
	prefix = append(prefix, purpose...)
	prefix = append(prefix, 0)
	prefix = append(prefix, deviceUUID...)
	prefix = append(prefix, 0)
	return prefix
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
	if decodeStrict(data, &value) != nil || value.Version != credentialsVersion || value.DeviceID == "" || len(value.DeviceID) > 36 ||
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
