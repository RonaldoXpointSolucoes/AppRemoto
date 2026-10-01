package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	defaultRequestTimeout = 15 * time.Second
	maxResponseBytes      = 64 * 1024
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type EnrollRequest struct {
	EnrollmentToken string `json:"enrollmentToken"`
	DeviceUUID      string `json:"deviceUuid"`
	DisplayName     string `json:"displayName"`
	Hostname        string `json:"hostname"`
	OperatingSystem string `json:"operatingSystem"`
	OSVersion       string `json:"osVersion"`
	AgentVersion    string `json:"agentVersion"`
	RustDeskID      string `json:"rustdeskId"`
	RustDeskVersion string `json:"rustdeskVersion"`
}

type EnrollResponse struct {
	DeviceID                 string `json:"deviceId"`
	DeviceToken              string `json:"deviceToken"`
	RustDeskPassword         string `json:"rustdeskPassword"`
	HeartbeatIntervalSeconds int    `json:"heartbeatIntervalSeconds"`
}

type HeartbeatRequest struct {
	AgentVersion    string `json:"agentVersion"`
	RustDeskVersion string `json:"rustdeskVersion"`
	RustDeskID      string `json:"rustdeskId"`
	OperatingSystem string `json:"operatingSystem"`
	OSVersion       string `json:"osVersion"`
}

type HeartbeatResponse struct {
	DeviceID   string    `json:"deviceId"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type ErrorCode string

const (
	ErrorInvalidEnrollment    ErrorCode = "INVALID_ENROLLMENT"
	ErrorEnrollmentDenied     ErrorCode = "ENROLLMENT_DENIED"
	ErrorRateLimited          ErrorCode = "ENROLLMENT_RATE_LIMITED"
	ErrorUnavailable          ErrorCode = "ENROLLMENT_UNAVAILABLE"
	ErrorUnexpectedResponse   ErrorCode = "UNEXPECTED_RESPONSE"
	ErrorTransport            ErrorCode = "TRANSPORT_ERROR"
	ErrorInvalidHeartbeat     ErrorCode = "INVALID_HEARTBEAT"
	ErrorUnauthenticated      ErrorCode = "UNAUTHENTICATED"
	ErrorHeartbeatForbidden   ErrorCode = "HEARTBEAT_FORBIDDEN"
	ErrorHeartbeatUnavailable ErrorCode = "HEARTBEAT_UNAVAILABLE"
)

type Error struct {
	Code  ErrorCode
	cause error
}

func (err *Error) Error() string {
	switch err.Code {
	case ErrorInvalidEnrollment:
		return "invalid enrollment request"
	case ErrorEnrollmentDenied:
		return "enrollment denied"
	case ErrorRateLimited:
		return "enrollment rate limited"
	case ErrorUnavailable:
		return "enrollment service unavailable"
	case ErrorTransport:
		return "API transport failed"
	case ErrorInvalidHeartbeat:
		return "invalid heartbeat request"
	case ErrorUnauthenticated:
		return "device authentication failed"
	case ErrorHeartbeatForbidden:
		return "device heartbeat forbidden"
	case ErrorHeartbeatUnavailable:
		return "heartbeat service unavailable"
	default:
		return "unexpected API response"
	}
}

func (err *Error) Unwrap() error { return err.cause }

func IsCode(err error, code ErrorCode) bool {
	var apiErr *Error
	return errors.As(err, &apiErr) && apiErr.Code == code
}

type Options struct {
	HTTPClient        *http.Client
	RequestTimeout    time.Duration
	AllowHTTPForTests bool
}

type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
	timeout    time.Duration
}

func NewClient(baseURL string, options Options) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("invalid API base URL")
	}
	if parsed.Scheme != "https" {
		if parsed.Scheme != "http" || !options.AllowHTTPForTests || options.HTTPClient == nil {
			return nil, errors.New("API base URL must use HTTPS")
		}
	}
	if options.RequestTimeout < 0 {
		return nil, errors.New("API request timeout must not be negative")
	}
	timeout := options.RequestTimeout
	if timeout == 0 {
		timeout = defaultRequestTimeout
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	clientCopy := *httpClient
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{baseURL: parsed, httpClient: &clientCopy, timeout: timeout}, nil
}

func (client *Client) Enroll(ctx context.Context, request EnrollRequest) (EnrollResponse, error) {
	if err := ValidateEnrollRequest(request); err != nil {
		return EnrollResponse{}, &Error{Code: ErrorInvalidEnrollment}
	}
	body, err := json.Marshal(request)
	if err != nil {
		return EnrollResponse{}, &Error{Code: ErrorInvalidEnrollment}
	}
	defer clear(body)
	requestCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(requestCtx, http.MethodPost, client.endpoint("/v1/agent/enroll"), bytes.NewReader(body))
	if err != nil {
		return EnrollResponse{}, &Error{Code: ErrorTransport}
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	response, err := client.httpClient.Do(httpRequest)
	if err != nil {
		if requestCtx.Err() != nil {
			return EnrollResponse{}, &Error{Code: ErrorTransport, cause: requestCtx.Err()}
		}
		return EnrollResponse{}, &Error{Code: ErrorTransport}
	}
	defer response.Body.Close()
	data, err := readBounded(response.Body, maxResponseBytes)
	if err != nil {
		return EnrollResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	defer clear(data)
	if !isJSONContentType(response.Header.Get("Content-Type")) {
		return EnrollResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	if response.StatusCode == http.StatusOK {
		var result EnrollResponse
		if decodeStrict(data, &result) != nil || validateEnrollResponse(result) != nil {
			return EnrollResponse{}, &Error{Code: ErrorUnexpectedResponse}
		}
		return result, nil
	}
	return EnrollResponse{}, mapErrorResponse(response.StatusCode, data, map[int]ErrorCode{
		400: ErrorInvalidEnrollment, 403: ErrorEnrollmentDenied, 429: ErrorRateLimited, 503: ErrorUnavailable,
	})
}

type ReconfigureResponse struct {
	DeviceID     string `json:"deviceId"`
	Reconfigured bool   `json:"reconfigured"`
}

func (client *Client) Reconfigure(ctx context.Context, deviceToken []byte, request EnrollRequest) (ReconfigureResponse, error) {
	if err := ValidateEnrollRequest(request); err != nil || !validDeviceToken(deviceToken) {
		return ReconfigureResponse{}, &Error{Code: ErrorInvalidEnrollment}
	}
	body, err := json.Marshal(struct {
		EnrollRequest
		CurrentDeviceToken string `json:"currentDeviceToken"`
	}{request, string(deviceToken)})
	if err != nil {
		return ReconfigureResponse{}, &Error{Code: ErrorInvalidEnrollment}
	}
	defer clear(body)
	requestCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(requestCtx, http.MethodPost, client.endpoint("/v1/agent/reconfigure"), bytes.NewReader(body))
	if err != nil {
		return ReconfigureResponse{}, &Error{Code: ErrorTransport}
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	response, err := client.httpClient.Do(httpRequest)
	if err != nil {
		if requestCtx.Err() != nil {
			return ReconfigureResponse{}, &Error{Code: ErrorTransport, cause: requestCtx.Err()}
		}
		return ReconfigureResponse{}, &Error{Code: ErrorTransport}
	}
	defer response.Body.Close()
	data, err := readBounded(response.Body, maxResponseBytes)
	if err != nil {
		return ReconfigureResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	defer clear(data)
	if !isJSONContentType(response.Header.Get("Content-Type")) {
		return ReconfigureResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	if response.StatusCode == http.StatusOK {
		var result ReconfigureResponse
		if decodeStrict(data, &result) != nil || !length(result.DeviceID, 1, 36) || !result.Reconfigured {
			return ReconfigureResponse{}, &Error{Code: ErrorUnexpectedResponse}
		}
		return result, nil
	}
	return ReconfigureResponse{}, mapErrorResponse(response.StatusCode, data, map[int]ErrorCode{
		400: ErrorInvalidEnrollment, 403: ErrorEnrollmentDenied, 429: ErrorRateLimited, 503: ErrorUnavailable,
	})
}

func (client *Client) Heartbeat(ctx context.Context, deviceToken []byte, request HeartbeatRequest) (HeartbeatResponse, error) {
	if !validDeviceToken(deviceToken) {
		return HeartbeatResponse{}, &Error{Code: ErrorUnauthenticated}
	}
	if !length(request.AgentVersion, 1, 64) || !length(request.RustDeskVersion, 1, 64) ||
		!length(request.RustDeskID, 1, 64) || !length(request.OperatingSystem, 1, 64) || !length(request.OSVersion, 1, 128) {
		return HeartbeatResponse{}, &Error{Code: ErrorInvalidHeartbeat}
	}
	body, err := json.Marshal(request)
	if err != nil {
		return HeartbeatResponse{}, &Error{Code: ErrorInvalidHeartbeat}
	}
	defer clear(body)
	requestCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(requestCtx, http.MethodPost, client.endpoint("/v1/agent/heartbeat"), bytes.NewReader(body))
	if err != nil {
		return HeartbeatResponse{}, &Error{Code: ErrorTransport}
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+string(deviceToken))
	response, err := client.httpClient.Do(httpRequest)
	if err != nil {
		if requestCtx.Err() != nil {
			return HeartbeatResponse{}, &Error{Code: ErrorTransport, cause: requestCtx.Err()}
		}
		return HeartbeatResponse{}, &Error{Code: ErrorTransport}
	}
	defer response.Body.Close()
	data, err := readBounded(response.Body, maxResponseBytes)
	if err != nil {
		return HeartbeatResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	defer clear(data)
	if !isJSONContentType(response.Header.Get("Content-Type")) {
		return HeartbeatResponse{}, &Error{Code: ErrorUnexpectedResponse}
	}
	if response.StatusCode == http.StatusOK {
		var result HeartbeatResponse
		if decodeStrict(data, &result) != nil || !length(result.DeviceID, 1, 36) || result.LastSeenAt.IsZero() {
			return HeartbeatResponse{}, &Error{Code: ErrorUnexpectedResponse}
		}
		return result, nil
	}
	return HeartbeatResponse{}, mapErrorResponse(response.StatusCode, data, map[int]ErrorCode{
		400: ErrorInvalidHeartbeat, 401: ErrorUnauthenticated, 403: ErrorHeartbeatForbidden, 503: ErrorHeartbeatUnavailable,
	})
}

func (client *Client) endpoint(path string) string {
	endpoint := *client.baseURL
	endpoint.Path = path
	return endpoint.String()
}

func validDeviceToken(token []byte) bool {
	if len(token) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(string(token))
	if err != nil || len(decoded) != 32 {
		clear(decoded)
		return false
	}
	canonical := base64.RawURLEncoding.EncodeToString(decoded)
	clear(decoded)
	return canonical == string(token)
}

func ValidateEnrollRequest(value EnrollRequest) error {
	if !length(value.EnrollmentToken, 32, 512) || !uuidPattern.MatchString(value.DeviceUUID) ||
		!length(value.DisplayName, 1, 128) || !length(value.Hostname, 1, 255) ||
		!length(value.OperatingSystem, 1, 64) || !length(value.OSVersion, 1, 128) ||
		!length(value.AgentVersion, 1, 64) || !length(value.RustDeskID, 1, 64) ||
		!length(value.RustDeskVersion, 1, 64) {
		return errors.New("invalid enrollment payload")
	}
	return nil
}

func validateEnrollResponse(value EnrollResponse) error {
	if !length(value.DeviceID, 1, 36) || !length(value.DeviceToken, 32, 512) ||
		!length(value.RustDeskPassword, 8, 128) || value.HeartbeatIntervalSeconds < 10 || value.HeartbeatIntervalSeconds > 300 {
		return errors.New("invalid enrollment response")
	}
	return nil
}

func length(value string, minimum, maximum int) bool {
	return len(value) >= minimum && len(value) <= maximum
}

func readBounded(reader io.Reader, maximum int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maximum {
		clear(data)
		return nil, errors.New("response exceeds limit")
	}
	return data, nil
}

func isJSONContentType(value string) bool {
	mediaType, parameters, err := mime.ParseMediaType(value)
	if err != nil || mediaType != "application/json" {
		return false
	}
	for name, value := range parameters {
		if !strings.EqualFold(name, "charset") || !strings.EqualFold(value, "utf-8") {
			return false
		}
	}
	return true
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

func mapErrorResponse(status int, data []byte, expected map[int]ErrorCode) error {
	type errorDetail struct {
		Code      string  `json:"code"`
		Message   string  `json:"message"`
		RequestID *string `json:"requestId,omitempty"`
	}
	type errorEnvelope struct {
		Error errorDetail `json:"error"`
	}
	var envelope errorEnvelope
	if decodeStrict(data, &envelope) != nil || envelope.Error.Message == "" || len(envelope.Error.Message) > 256 ||
		(envelope.Error.RequestID != nil && (len(*envelope.Error.RequestID) == 0 || len(*envelope.Error.RequestID) > 128)) {
		return &Error{Code: ErrorUnexpectedResponse}
	}
	code, ok := expected[status]
	if !ok || string(code) != envelope.Error.Code {
		return &Error{Code: ErrorUnexpectedResponse}
	}
	return &Error{Code: code}
}
