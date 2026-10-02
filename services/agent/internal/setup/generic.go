package setup

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type GenericProvisioning struct {
	SchemaVersion  int    `json:"schemaVersion"`
	InstallerID    string `json:"installerId"`
	InstallerToken string `json:"installerToken"`
}

type InstallationInput struct {
	CompanyName       string `json:"companyName"`
	DeviceDisplayName string `json:"deviceDisplayName"`
}

type preparationRequest struct {
	InstallerID            string `json:"installerId"`
	RequestID              string `json:"requestId"`
	RequestSecret          string `json:"requestSecret"`
	CompanyName            string `json:"companyName"`
	DeviceDisplayName      string `json:"deviceDisplayName"`
	ExistingOrganizationID string `json:"existingOrganizationId,omitempty"`
}

type preparationState struct {
	Request      preparationRequest `json:"request"`
	Provisioning *Provisioning      `json:"provisioning,omitempty"`
}

type preparationError struct{ Code string }

func (e *preparationError) Error() string { return e.Code }

func validInstallationName(s string) bool {
	if !utf8.ValidString(s) || strings.TrimSpace(s) != s || utf8.RuneCountInString(s) < 1 || utf8.RuneCountInString(s) > 128 {
		return false
	}
	for _, c := range s {
		if unicode.IsControl(c) {
			return false
		}
	}
	return true
}

func (v InstallationInput) Valid() bool {
	return validInstallationName(v.CompanyName) && validInstallationName(v.DeviceDisplayName)
}

func decodeStrictObject(data []byte, target any, fields int) error {
	if len(data) == 0 || len(data) > MaxOverlay || !utf8.Valid(data) {
		return ErrOverlay
	}
	d := json.NewDecoder(bytes.NewReader(data))
	t, err := d.Token()
	if err != nil || t != json.Delim('{') {
		return ErrOverlay
	}
	seen := map[string]bool{}
	for d.More() {
		t, err := d.Token()
		if err != nil {
			return ErrOverlay
		}
		key, ok := t.(string)
		if !ok || seen[key] {
			return ErrOverlay
		}
		seen[key] = true
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return ErrOverlay
		}
	}
	if len(seen) != fields {
		return ErrOverlay
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return ErrOverlay
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return ErrOverlay
	}
	return nil
}

func ReadGenericOverlay(r io.ReaderAt, size int64) (GenericProvisioning, int64, error) {
	var p GenericProvisioning
	tail := make([]byte, 4+len(GenericMarker))
	if size < int64(len(tail))+2 {
		return p, 0, ErrOverlay
	}
	if _, err := r.ReadAt(tail, size-int64(len(tail))); err != nil || string(tail[4:]) != GenericMarker {
		return p, 0, ErrOverlay
	}
	n := int64(binary.LittleEndian.Uint32(tail[:4]))
	base := size - int64(len(tail)) - n
	if n < 1 || n > MaxOverlay || base < 2 {
		return p, 0, ErrOverlay
	}
	b := make([]byte, n)
	defer clear(b)
	if _, err := r.ReadAt(b, base); err != nil {
		return p, 0, ErrOverlay
	}
	if decodeStrictObject(b, &p, 3) != nil || p.SchemaVersion != 2 || !idPattern.MatchString(p.InstallerID) || !tokenPattern.MatchString(p.InstallerToken) {
		return GenericProvisioning{}, 0, ErrOverlay
	}
	return p, base, nil
}

func newPreparationRequest(p GenericProvisioning, input InstallationInput) (preparationRequest, error) {
	if !input.Valid() {
		return preparationRequest{}, ErrOverlay
	}
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return preparationRequest{}, err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return preparationRequest{}, err
	}
	defer clear(secret[:])
	return preparationRequest{InstallerID: p.InstallerID, RequestID: fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), RequestSecret: base64.RawURLEncoding.EncodeToString(secret[:]), CompanyName: input.CompanyName, DeviceDisplayName: input.DeviceDisplayName}, nil
}

// No generic token or password enters command arguments, disk logs or errors.
func prepareInstallation(ctx context.Context, client *http.Client, endpoint string, p GenericProvisioning, req preparationRequest) (Provisioning, error) {
	b, err := json.Marshal(req)
	if err != nil {
		return Provisioning{}, err
	}
	defer clear(b)
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/v1/agent/prepare-installation", bytes.NewReader(b))
	if err != nil {
		return Provisioning{}, &preparationError{"PREPARATION_REQUEST"}
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+p.InstallerToken)
	r.Header.Set("Cache-Control", "no-store")
	response, err := client.Do(r)
	r.Header.Del("Authorization")
	if err != nil {
		if ctx.Err() != nil {
			return Provisioning{}, ctx.Err()
		}
		return Provisioning{}, &preparationError{"PREPARATION_NETWORK"}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, MaxOverlay+1))
	defer clear(data)
	if err != nil || len(data) > MaxOverlay {
		return Provisioning{}, &preparationError{"PREPARATION_RESPONSE"}
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		code := "PREPARATION_UNAVAILABLE"
		switch response.StatusCode {
		case 400:
			code = "PREPARATION_INPUT"
		case 401, 403:
			code = "INSTALLER_NOT_AUTHORIZED"
		case 409:
			code = "PREPARATION_CONFLICT"
		case 429:
			code = "PREPARATION_RATE_LIMIT"
		}
		var failure struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &failure) == nil {
			switch failure.Error.Code {
			case "GENERIC_INSTALLER_DENIED", "GENERIC_INSTALLER_UNAVAILABLE", "GENERIC_INSTALLER_REQUEST_CONFLICT", "GENERIC_INSTALLER_EXPIRED", "ORGANIZATION_CONFLICT", "GENERIC_INSTALLER_RATE_LIMITED":
				code = failure.Error.Code
			}
		}
		return Provisioning{}, &preparationError{code}
	}
	var out struct {
		Provisioning
		OrganizationName string `json:"organizationName"`
	}
	if decodeStrictObject(data, &out, 7) != nil || !validInstallationName(out.OrganizationName) {
		return Provisioning{}, &preparationError{"PREPARATION_RESPONSE"}
	}
	plain, err := json.Marshal(out.Provisioning)
	if err != nil {
		return Provisioning{}, &preparationError{"PREPARATION_RESPONSE"}
	}
	defer clear(plain)
	v, err := Decode(plain, time.Now())
	if err != nil || v.DeviceDisplayName != req.DeviceDisplayName {
		return Provisioning{}, &preparationError{"PREPARATION_RESPONSE"}
	}
	return v, nil
}

func preparationHTTPClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}
}

func reusePreparation(saved preparationState, p GenericProvisioning, input InstallationInput, existingOrganization string, credentials bool, now time.Time) bool {
	if credentials || saved.Request.InstallerID != p.InstallerID || saved.Request.CompanyName != input.CompanyName || saved.Request.DeviceDisplayName != input.DeviceDisplayName || saved.Request.ExistingOrganizationID != existingOrganization || !idPattern.MatchString(saved.Request.RequestID) || len(saved.Request.RequestSecret) != 43 || !tokenPattern.MatchString(saved.Request.RequestSecret) {
		return false
	}
	if saved.Provisioning != nil {
		expiry, err := time.Parse(time.RFC3339, saved.Provisioning.ExpiresAt)
		return err == nil && expiry.After(now)
	}
	return true
}

func prepareWithExpiredRenewal(p GenericProvisioning, input InstallationInput, existingOrganization string, saved *preparationState, canRenew bool, save func(preparationState) error, send func(preparationRequest) (Provisioning, error)) (Provisioning, error) {
	provisioning, err := send(saved.Request)
	var failure *preparationError
	if !canRenew || !errors.As(err, &failure) || failure.Code != "GENERIC_INSTALLER_EXPIRED" {
		return provisioning, err
	}
	req, err := newPreparationRequest(p, input)
	if err != nil {
		return Provisioning{}, err
	}
	req.ExistingOrganizationID = existingOrganization
	*saved = preparationState{Request: req}
	if err = save(*saved); err != nil {
		return Provisioning{}, err
	}
	return send(saved.Request)
}
