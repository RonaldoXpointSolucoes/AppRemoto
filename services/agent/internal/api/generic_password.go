package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
)

type GenericPasswordResponse struct {
	DeviceID         string `json:"deviceId"`
	RustDeskPassword string `json:"rustdeskPassword"`
	RotationID       string `json:"rotationId"`
}

type GenericPasswordConfirmation struct {
	DeviceID string `json:"deviceId"`
	Applied  bool   `json:"applied"`
}

func (client *Client) GenericPassword(ctx context.Context, token []byte, request EnrollRequest) (GenericPasswordResponse, error) {
	var response GenericPasswordResponse
	if err := client.genericPasswordRequest(ctx, "/v1/agent/generic-password", token, request, &response); err != nil {
		return GenericPasswordResponse{}, err
	}
	if !length(response.DeviceID, 1, 36) || !length(response.RotationID, 1, 36) || !length(response.RustDeskPassword, 8, 128) {
		return GenericPasswordResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	return response, nil
}

func (client *Client) ConfirmGenericPassword(ctx context.Context, token []byte, request EnrollRequest) (GenericPasswordConfirmation, error) {
	var response GenericPasswordConfirmation
	if err := client.genericPasswordRequest(ctx, "/v1/agent/generic-password/confirm", token, request, &response); err != nil {
		return GenericPasswordConfirmation{}, err
	}
	if !length(response.DeviceID, 1, 36) || !response.Applied {
		return GenericPasswordConfirmation{}, &Error{Code: ErrorUnexpectedResponse}
	}
	return response, nil
}

func (client *Client) genericPasswordRequest(ctx context.Context, path string, token []byte, request EnrollRequest, target any) error {
	if ValidateEnrollRequest(request) != nil || !validDeviceToken(token) {
		return &Error{Code: ErrorInvalidEnrollment}
	}
	body, err := json.Marshal(struct {
		EnrollRequest
		CurrentDeviceToken string `json:"currentDeviceToken"`
	}{request, string(token)})
	if err != nil {
		return &Error{Code: ErrorInvalidEnrollment}
	}
	defer clear(body)
	bounded, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	r, err := http.NewRequestWithContext(bounded, http.MethodPost, client.endpoint(path), bytes.NewReader(body))
	if err != nil {
		return &Error{Code: ErrorTransport}
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json")
	response, err := client.httpClient.Do(r)
	if err != nil {
		if bounded.Err() != nil {
			return &Error{Code: ErrorTransport, cause: bounded.Err()}
		}
		return &Error{Code: ErrorTransport}
	}
	defer response.Body.Close()
	data, err := readBounded(response.Body, maxResponseBytes)
	defer clear(data)
	if err != nil || !isJSONContentType(response.Header.Get("Content-Type")) {
		return &Error{Code: ErrorUnexpectedResponse}
	}
	if response.StatusCode == 200 {
		if decodeStrict(data, target) != nil {
			return &Error{Code: ErrorUnexpectedResponse}
		}
		return nil
	}
	var failure struct {
		Error struct {
			Code ErrorCode `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &failure) == nil {
		switch failure.Error.Code {
		case "GENERIC_PASSWORD_DENIED", "GENERIC_PASSWORD_UNAVAILABLE", "GENERIC_PASSWORD_POLICY_CHANGED":
			return &Error{Code: failure.Error.Code}
		}
	}
	return &Error{Code: ErrorUnavailable}
}
