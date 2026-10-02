package enroll

import (
	"context"
	"encoding/json"
	"errors"
	"os"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
)

const genericPasswordArtifact = "generic-password.json"
const genericPasswordPurpose = "generic-password-rotation"

type genericPasswordAPI interface {
	GenericPassword(context.Context, []byte, api.EnrollRequest) (api.GenericPasswordResponse, error)
	ConfirmGenericPassword(context.Context, []byte, api.EnrollRequest) (api.GenericPasswordConfirmation, error)
}

type genericPasswordJournal struct {
	Version    int               `json:"version"`
	DeviceID   string            `json:"deviceId"`
	RotationID string            `json:"rotationId"`
	Password   string            `json:"password"`
	Request    api.EnrollRequest `json:"request"`
	Confirmed  bool              `json:"confirmed"`
}

func (store fileArtifacts) ReplaceGenericPassword(value []byte) error {
	return state.ReplaceGenericPassword(store.directory, value)
}

func (service *Service) loadGenericPassword(deviceUUID string) (genericPasswordJournal, bool, error) {
	data, err := service.artifacts.Load(genericPasswordArtifact, maxArtifactBytes)
	if errors.Is(err, os.ErrNotExist) {
		return genericPasswordJournal{}, false, nil
	}
	if err != nil {
		return genericPasswordJournal{}, false, ErrManualReconciliation
	}
	defer clear(data)
	plain, err := service.unprotectBound(genericPasswordPurpose, deviceUUID, data, 2, int(maxArtifactBytes))
	if err != nil {
		return genericPasswordJournal{}, false, ErrManualReconciliation
	}
	defer clear(plain)
	var saved genericPasswordJournal
	if decodeStrict(plain, &saved) != nil || saved.Version != 1 || saved.DeviceID == "" || len(saved.DeviceID) > 36 || len(saved.RotationID) > 36 || saved.Request.DeviceUUID != deviceUUID || api.ValidateEnrollRequest(saved.Request) != nil {
		return genericPasswordJournal{}, false, ErrManualReconciliation
	}
	if saved.Password == "" {
		if saved.RotationID != "" || saved.Confirmed {
			return genericPasswordJournal{}, false, ErrManualReconciliation
		}
	} else if len(saved.Password) < 8 || len(saved.Password) > 128 || saved.RotationID == "" {
		return genericPasswordJournal{}, false, ErrManualReconciliation
	}
	return saved, true, nil
}

func (service *Service) saveGenericPassword(deviceUUID string, saved genericPasswordJournal) error {
	store, ok := service.artifacts.(interface{ ReplaceGenericPassword([]byte) error })
	if !ok {
		return errors.New("rotation storage unavailable")
	}
	plain, err := json.Marshal(saved)
	if err != nil {
		return err
	}
	defer clear(plain)
	protected, err := service.protectBound(genericPasswordPurpose, deviceUUID, plain)
	if err != nil {
		return err
	}
	defer clear(protected)
	return store.ReplaceGenericPassword(protected)
}

func (service *Service) finishGenericPassword(ctx context.Context, deviceUUID string, deviceToken []byte, saved genericPasswordJournal) error {
	defer func() { saved.Password = ""; saved.Request.EnrollmentToken = "" }()
	client, ok := service.api.(genericPasswordAPI)
	if !ok {
		return errors.New("password confirmation unavailable")
	}
	if saved.Password == "" {
		var response api.GenericPasswordResponse
		if err := service.stage("GENERIC_PASSWORD_REQUEST", func() error {
			var err error
			response, err = client.GenericPassword(ctx, deviceToken, saved.Request)
			return err
		}); err != nil {
			return err
		}
		defer func() { response.RustDeskPassword = "" }()
		if response.DeviceID != saved.DeviceID || response.RotationID == "" || len(response.RotationID) > 36 || len(response.RustDeskPassword) < 8 || len(response.RustDeskPassword) > 128 {
			return errors.New("password preparation mismatch")
		}
		saved.Password = response.RustDeskPassword
		saved.RotationID = response.RotationID
		if err := service.stage("GENERIC_PASSWORD_STAGE", func() error { return service.saveGenericPassword(deviceUUID, saved) }); err != nil {
			return err
		}
	}
	if err := service.stage("GENERIC_PASSWORD_APPLY", func() error { return service.rustdesk.SetUnattendedPassword(ctx, saved.Password) }); err != nil {
		return err
	}
	if err := service.stage("GENERIC_PASSWORD_CONFIRM", func() error {
		response, err := client.ConfirmGenericPassword(ctx, deviceToken, saved.Request)
		if err != nil {
			return err
		}
		if response.DeviceID != saved.DeviceID || !response.Applied {
			return errors.New("password confirmation mismatch")
		}
		return nil
	}); err != nil {
		return err
	}
	saved.Confirmed = true
	return service.stage("GENERIC_PASSWORD_COMMIT", func() error { return service.saveGenericPassword(deviceUUID, saved) })
}

func (service *Service) resumeGenericPassword(ctx context.Context, deviceUUID string, result Result) error {
	saved, exists, err := service.loadGenericPassword(deviceUUID)
	defer func() { saved.Password = ""; saved.Request.EnrollmentToken = "" }()
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if saved.DeviceID != result.DeviceID {
		return ErrManualReconciliation
	}
	if saved.Confirmed {
		return nil
	}
	return service.finishGenericPassword(ctx, deviceUUID, result.DeviceToken, saved)
}

func (service *Service) rotateGenericPassword(ctx context.Context, deviceUUID string, result Result, request api.EnrollRequest) error {
	defer func() { request.EnrollmentToken = "" }()
	saved := genericPasswordJournal{Version: 1, DeviceID: result.DeviceID, Request: request}
	defer func() { saved.Password = ""; saved.Request.EnrollmentToken = "" }()
	if err := service.stage("GENERIC_PASSWORD_PREFLIGHT", func() error { return service.saveGenericPassword(deviceUUID, saved) }); err != nil {
		return err
	}
	return service.finishGenericPassword(ctx, deviceUUID, result.DeviceToken, saved)
}
