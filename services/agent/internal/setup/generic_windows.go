//go:build windows

package setup

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/secret"
	"golang.org/x/sys/windows"
)

func ReadInstallationInput(report *Report) (*InstallationInput, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	f, err := os.Open(exe)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	p, err := ReadPackage(f, st.Size(), time.Now())
	if err != nil {
		return nil, err
	}
	defer func() { p.Generic.InstallerToken = ""; p.Provisioning.EnrollmentToken = "" }()
	if p.Generic.SchemaVersion != 2 {
		return nil, nil
	}
	return promptInstallation(report)
}

func prepareGeneric(ctx context.Context, p GenericProvisioning, input InstallationInput, ps Paths, report *Report) (Provisioning, error) {
	if !input.Valid() {
		return Provisioning{}, &preparationError{"PREPARATION_INPUT"}
	}
	report.Record(1, "PREPARATION_STATE", "START", nil)
	h, err := secureDir(ps.Data)
	if err != nil {
		return Provisioning{}, err
	}
	defer windows.CloseHandle(h)
	pending, err := privateExists(filepath.Join(ps.Agent, "enrollment-pending.json"))
	if err != nil {
		return Provisioning{}, err
	}
	credentials, err := privateExists(filepath.Join(ps.Agent, "enrollment-credentials.json"))
	if err != nil {
		return Provisioning{}, err
	}
	if pending != credentials {
		return Provisioning{}, &preparationError{"RECONCILIATION"}
	}
	var existingOrganization string
	if data, e := readPrivate(filepath.Join(ps.Data, "installation.json"), 4096); e == nil {
		var reg receipt
		if json.Unmarshal(data, &reg) != nil || !idPattern.MatchString(reg.OrganizationID) {
			return Provisioning{}, errStage
		}
		existingOrganization = reg.OrganizationID
	} else if !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return Provisioning{}, e
	}
	statePath := filepath.Join(ps.Data, "generic-request.dpapi")
	var saved preparationState
	if encrypted, e := readPrivate(statePath, MaxOverlay+4096); e == nil {
		plain, e := secret.Unprotect(encrypted)
		clear(encrypted)
		if e != nil {
			return Provisioning{}, e
		}
		e = json.Unmarshal(plain, &saved)
		clear(plain)
		if e != nil {
			return Provisioning{}, errStage
		}
	} else if !errors.Is(e, windows.ERROR_FILE_NOT_FOUND) {
		return Provisioning{}, e
	}
	defer func() {
		saved.Request.RequestSecret = ""
		if saved.Provisioning != nil {
			saved.Provisioning.EnrollmentToken = ""
		}
	}()
	reuse := reusePreparation(saved, p, input, existingOrganization, credentials, time.Now())
	// Saved credentials permit repair with a fresh single-use package. They never
	// authorize replaying an ambiguous initial enrollment with missing secrets.
	if !reuse {
		req, e := newPreparationRequest(p, input)
		if e != nil {
			return Provisioning{}, e
		}
		req.ExistingOrganizationID = existingOrganization
		saved = preparationState{Request: req}
		if e = savePreparationState(statePath, saved); e != nil {
			return Provisioning{}, e
		}
	}
	report.Record(1, "PREPARATION_STATE", "OK", nil)
	report.Record(1, "PREPARATION_REQUEST", "START", nil)
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	provisioning, err := prepareWithExpiredRenewal(p, input, existingOrganization, &saved, pending == credentials, func(next preparationState) error {
		report.Record(1, "PREPARATION_EXPIRED_RENEW", "START", nil)
		return savePreparationState(statePath, next)
	}, func(req preparationRequest) (Provisioning, error) {
		return prepareInstallation(requestCtx, preparationHTTPClient(), APIURL, p, req)
	})
	if err != nil {
		return Provisioning{}, err
	}
	saved.Provisioning = &provisioning
	report.Record(1, "PREPARATION_RESPONSE_SAVE", "START", nil)
	if err = savePreparationState(statePath, saved); err != nil {
		report.Record(1, "PREPARATION_RESPONSE_SAVE", "ERROR", err)
		return Provisioning{}, err
	}
	report.Record(1, "PREPARATION_RESPONSE_SAVE", "OK", nil)
	report.Record(1, "PREPARATION_REQUEST", "OK", nil)
	return provisioning, nil
}

func savePreparationState(path string, state preparationState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	defer clear(data)
	encrypted, err := protectMachine(data)
	if err != nil {
		return err
	}
	defer clear(encrypted)
	return replacePrivate(path, encrypted)
}

func preparationFailure(err error) string {
	var p *preparationError
	if errors.As(err, &p) && safeIdentifier(p.Code) {
		return p.Code
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "PREPARATION_TIMEOUT"
	}
	return "PREPARATION_STATE"
}

func cleanInput(s string) string { return strings.TrimSpace(s) }
