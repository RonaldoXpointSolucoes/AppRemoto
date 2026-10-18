package setup

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

const MaxWindowsHostnameLength = 15

type ComputerRoleDefinition struct {
	Code           string `json:"code"`
	Label          string `json:"label"`
	BasePrefix     string `json:"basePrefix"`
	Exclusive      bool   `json:"exclusive"`
	ExampleDefault string `json:"exampleDefault"`
}

var DefaultRoleCatalog = []ComputerRoleDefinition{
	{Code: "SERVIDOR", Label: "Servidor", BasePrefix: "SERVIDOR", Exclusive: true, ExampleDefault: "SERVIDOR"},
	{Code: "CAIXA", Label: "Caixa / PDV", BasePrefix: "CAIXA", Exclusive: false, ExampleDefault: "CAIXA-01"},
	{Code: "BALANCA", Label: "Balança", BasePrefix: "BALANCA", Exclusive: false, ExampleDefault: "BALANCA-01"},
	{Code: "GARCOM", Label: "Estação de garçom", BasePrefix: "GARCOM", Exclusive: false, ExampleDefault: "GARCOM-01"},
	{Code: "ESCRITORIO", Label: "Escritório", BasePrefix: "ESCRITORIO", Exclusive: false, ExampleDefault: "ESCRITORIO-01"},
	{Code: "COZINHA", Label: "Cozinha", BasePrefix: "COZINHA", Exclusive: false, ExampleDefault: "COZINHA-01"},
	{Code: "ESTOQUE", Label: "Estoque", BasePrefix: "ESTOQUE", Exclusive: false, ExampleDefault: "ESTOQUE-01"},
	{Code: "RETAGUARDA", Label: "Retaguarda", BasePrefix: "RETAGUARDA", Exclusive: false, ExampleDefault: "RETAGUARDA-01"},
	{Code: "PERSONALIZADO", Label: "Personalizado", BasePrefix: "PC", Exclusive: false, ExampleDefault: "PC-01"},
}

var windowsReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
	"LOCALHOST": true, "WORKGROUP": true, "DOMAIN": true, "ADMIN": true, "ADMINISTRATOR": true, "SYSTEM": true, "NULL": true, "NONE": true,
}

var digitsOnlyRegex = regexp.MustCompile(`^\d+$`)

func NormalizeCnpjDigits(raw string) string {
	var sb strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			sb.WriteRune(r)
		}
	}
	s := sb.String()
	if len(s) > 14 {
		return s[:14]
	}
	return s
}

func IsValidCnpj14(raw string) bool {
	d := NormalizeCnpjDigits(raw)
	if len(d) != 14 {
		return false
	}
	allSame := true
	for i := 1; i < len(d); i++ {
		if d[i] != d[0] {
			allSame = false
			break
		}
	}
	return !allSame
}

func FormatCnpj(raw string) string {
	d := NormalizeCnpjDigits(raw)
	if len(d) != 14 {
		return strings.TrimSpace(raw)
	}
	return fmt.Sprintf("%s.%s.%s/%s-%s", d[0:2], d[2:5], d[5:8], d[8:12], d[12:14])
}

func stripAccentsRune(r rune) rune {
	switch unicode.ToUpper(r) {
	case 'Á', 'À', 'Ã', 'Â', 'Ä':
		return 'A'
	case 'É', 'È', 'Ê', 'Ë':
		return 'E'
	case 'Í', 'Ì', 'Î', 'Ï':
		return 'I'
	case 'Ó', 'Ò', 'Õ', 'Ô', 'Ö':
		return 'O'
	case 'Ú', 'Ù', 'Û', 'Ü':
		return 'U'
	case 'Ç':
		return 'C'
	case 'Ñ':
		return 'N'
	default:
		return unicode.ToUpper(r)
	}
}

func NormalizeWindowsHostname(raw string) string {
	var sb strings.Builder
	lastHyphen := false
	for _, r := range strings.TrimSpace(raw) {
		u := stripAccentsRune(r)
		if (u >= 'A' && u <= 'Z') || (u >= '0' && u <= '9') {
			sb.WriteRune(u)
			lastHyphen = false
		} else if u == '-' || u == '_' || u == ' ' || u == '.' || u == '/' {
			if sb.Len() > 0 && !lastHyphen {
				sb.WriteByte('-')
				lastHyphen = true
			}
		}
	}
	res := strings.Trim(sb.String(), "-")
	if len(res) > MaxWindowsHostnameLength {
		res = strings.Trim(res[:MaxWindowsHostnameLength], "-")
	}
	return res
}

func ValidateWindowsHostname(raw string) (string, string, bool) {
	normalized := NormalizeWindowsHostname(raw)
	if normalized == "" {
		return "", "Informe um nome com letras (A-Z), números (0-9) ou hífen.", false
	}
	if len(normalized) > MaxWindowsHostnameLength {
		return normalized, fmt.Sprintf("O nome Windows deve ter no máximo %d caracteres.", MaxWindowsHostnameLength), false
	}
	if digitsOnlyRegex.MatchString(normalized) {
		return normalized, "O nome do computador no Windows não pode conter apenas números.", false
	}
	if windowsReservedNames[normalized] {
		return normalized, fmt.Sprintf("O nome \"%s\" é reservado pelo Windows e não pode ser utilizado.", normalized), false
	}
	return normalized, "", true
}

func RoleDefinitionByCode(code string) ComputerRoleDefinition {
	for _, item := range DefaultRoleCatalog {
		if strings.EqualFold(item.Code, code) {
			return item
		}
	}
	return DefaultRoleCatalog[1] // CAIXA
}

func InferRoleFromName(rawName string) string {
	norm := NormalizeWindowsHostname(rawName)
	if norm == "" {
		return "CAIXA"
	}
	if norm == "SERVIDOR" || strings.HasPrefix(norm, "SERVIDOR-") || norm == "SERVER" || strings.HasPrefix(norm, "SRV") {
		return "SERVIDOR"
	}
	for _, item := range DefaultRoleCatalog {
		if item.Code == "SERVIDOR" || item.Code == "PERSONALIZADO" {
			continue
		}
		if norm == item.BasePrefix || strings.HasPrefix(norm, item.BasePrefix+"-") || strings.HasPrefix(norm, item.BasePrefix) {
			return item.Code
		}
	}
	if strings.HasPrefix(norm, "PDV") || strings.HasPrefix(norm, "CX") {
		return "CAIXA"
	}
	return "PERSONALIZADO"
}

type ExistingCnpjComputer struct {
	DeviceID                string `json:"deviceId"`
	OrganizationID          string `json:"organizationId"`
	Nome                    string `json:"nome"`
	NomeNormalizado         string `json:"nomeNormalizado"`
	Funcao                  string `json:"funcao"`
	FuncaoLabel             string `json:"funcaoLabel"`
	Situacao                string `json:"situacao"`
	WindowsHostnameAtual    string `json:"windowsHostnameAtual"`
	WindowsHostnameDesejado string `json:"windowsHostnameDesejado,omitempty"`
	StatusRenomeacao        string `json:"statusRenomeacao"`
	RustDeskID              string `json:"rustdeskId"`
	DeviceUUID              string `json:"deviceUuid"`
	LastSeenAt              string `json:"lastSeenAt,omitempty"`
	SubstituiuDeviceID      string `json:"substituiuDeviceId,omitempty"`
}

type CnpjGroupSummary struct {
	OrganizationID    string `json:"organizationId"`
	Cnpj              string `json:"cnpj"`
	CnpjFormatado     string `json:"cnpjFormatado"`
	RazaoSocial       string `json:"razaoSocial"`
	NomeFantasia      string `json:"nomeFantasia,omitempty"`
	Status            string `json:"status"`
	TotalComputadores int    `json:"totalComputadores"`
	OnlineCount       int    `json:"onlineCount"`
	OfflineCount      int    `json:"offlineCount"`
}

type SuggestNameResponse struct {
	SuggestedName   string   `json:"suggestedName"`
	NormalizedName  string   `json:"normalizedName"`
	Role            string   `json:"role"`
	RoleLabel       string   `json:"roleLabel"`
	Available       bool     `json:"available"`
	Reason          string   `json:"reason"`
	OccupiedNumbers []int    `json:"occupiedNumbers"`
	OccupiedNames   []string `json:"occupiedNames"`
}

type InstallationContextRequest struct {
	Cnpj                 string `json:"cnpj"`
	RazaoSocial          string `json:"razaoSocial,omitempty"`
	NomeFantasia         string `json:"nomeFantasia,omitempty"`
	Serial               string `json:"serial,omitempty"`
	DeviceUUID           string `json:"deviceUuid,omitempty"`
	RustDeskID           string `json:"rustdeskId,omitempty"`
	WindowsHostnameAtual string `json:"windowsHostnameAtual,omitempty"`
}

type InstallationContextResponse struct {
	Group             CnpjGroupSummary         `json:"group"`
	Computers         []ExistingCnpjComputer   `json:"computers"`
	DetectedOperation string                   `json:"detectedOperation"`
	ExistingDevice    *ExistingCnpjComputer    `json:"existingDevice"`
	Catalog           []ComputerRoleDefinition `json:"catalog"`
	DefaultRole       string                   `json:"defaultRole"`
	DefaultSuggestion SuggestNameResponse      `json:"defaultSuggestion"`
	ServerTime        string                   `json:"serverTime"`
}

type SuggestNameRequest struct {
	Cnpj             string `json:"cnpj"`
	Role             string `json:"role"`
	CustomName       string `json:"customName,omitempty"`
	DeviceUUID       string `json:"deviceUuid,omitempty"`
	RustDeskID       string `json:"rustdeskId,omitempty"`
	OperationMode    string `json:"operationMode,omitempty"`
	ReplacesDeviceID string `json:"replacesDeviceId,omitempty"`
}

type ReserveNameRequest struct {
	Cnpj                 string `json:"cnpj"`
	NormalizedName       string `json:"normalizedName"`
	Role                 string `json:"role"`
	DeviceUUID           string `json:"deviceUuid"`
	RustDeskID           string `json:"rustdeskId,omitempty"`
	WindowsHostnameAtual string `json:"windowsHostnameAtual"`
	OperationMode        string `json:"operationMode"`
	ReplacesDeviceID     string `json:"replacesDeviceId,omitempty"`
	RenameWindows        bool   `json:"renameWindows"`
	RazaoSocial          string `json:"razaoSocial,omitempty"`
	NomeFantasia         string `json:"nomeFantasia,omitempty"`
}

type ReserveNameResponse struct {
	ReservationID  string `json:"reservationId"`
	OrganizationID string `json:"organizationId"`
	Cnpj           string `json:"cnpj"`
	NormalizedName string `json:"normalizedName"`
	Role           string `json:"role"`
	OperationMode  string `json:"operationMode"`
	UniqueKey      string `json:"uniqueKey"`
	ExpiresAt      string `json:"expiresAt"`
}

type ConfirmNameRequest struct {
	ReservationID           string `json:"reservationId,omitempty"`
	Cnpj                    string `json:"cnpj"`
	DeviceUUID              string `json:"deviceUuid"`
	RustDeskID              string `json:"rustdeskId"`
	NormalizedName          string `json:"normalizedName"`
	Role                    string `json:"role"`
	OperationMode           string `json:"operationMode"`
	ReplacesDeviceID        string `json:"replacesDeviceId,omitempty"`
	WindowsHostnameAtual    string `json:"windowsHostnameAtual"`
	WindowsHostnameDesejado string `json:"windowsHostnameDesejado"`
	StatusRenomeacao        string `json:"statusRenomeacao"`
	ErroRenomeacao          string `json:"erroRenomeacao,omitempty"`
}

type PersistedNamingState struct {
	Cnpj                    string `json:"cnpj,omitempty"`
	RazaoSocial             string `json:"razaoSocial,omitempty"`
	NomeFantasia            string `json:"nomeFantasia,omitempty"`
	Role                    string `json:"role,omitempty"`
	WindowsHostnameDesejado string `json:"windowsHostnameDesejado,omitempty"`
	StatusRenomeacao        string `json:"statusRenomeacao,omitempty"`
	ErroRenomeacao          string `json:"erroRenomeacao,omitempty"`
	ReservationID           string `json:"reservationId,omitempty"`
	OperationMode           string `json:"operationMode,omitempty"`
	ReplacesDeviceID        string `json:"replacesDeviceId,omitempty"`
	RebootPromptPending     bool   `json:"rebootPromptPending,omitempty"`
}

// LocalSuggestNameForRole aplica exatamente a mesma lógica de lacunas sequenciais no instalador
// (tanto com a lista de computadores do servidor quanto em modo fallback offline).
func LocalSuggestNameForRole(roleCode string, computers []ExistingCnpjComputer, customName string, allowSameName string) SuggestNameResponse {
	roleDef := RoleDefinitionByCode(roleCode)
	allowNorm := NormalizeWindowsHostname(allowSameName)
	occupiedSet := make(map[string]bool)
	var occupiedNames []string
	for _, c := range computers {
		if c.Situacao == "substituido" || c.Situacao == "liberado" {
			continue
		}
		norm := NormalizeWindowsHostname(c.NomeNormalizado)
		if norm == "" {
			norm = NormalizeWindowsHostname(c.Nome)
		}
		if norm != "" && norm != allowNorm && !occupiedSet[norm] {
			occupiedSet[norm] = true
			occupiedNames = append(occupiedNames, norm)
		}
	}
	sort.Strings(occupiedNames)

	if roleDef.Code == "PERSONALIZADO" && strings.TrimSpace(customName) != "" {
		norm, msg, ok := ValidateWindowsHostname(customName)
		if !ok {
			return SuggestNameResponse{
				SuggestedName:  norm,
				NormalizedName: norm,
				Role:           roleDef.Code,
				RoleLabel:      roleDef.Label,
				Available:      false,
				Reason:         msg,
				OccupiedNames:  occupiedNames,
			}
		}
		if occupiedSet[norm] {
			return SuggestNameResponse{
				SuggestedName:  norm,
				NormalizedName: norm,
				Role:           roleDef.Code,
				RoleLabel:      roleDef.Label,
				Available:      false,
				Reason:         fmt.Sprintf("O nome %s já está ocupado neste CNPJ.", norm),
				OccupiedNames:  occupiedNames,
			}
		}
		return SuggestNameResponse{
			SuggestedName:  norm,
			NormalizedName: norm,
			Role:           roleDef.Code,
			RoleLabel:      roleDef.Label,
			Available:      true,
			Reason:         fmt.Sprintf("Nome personalizado %s disponível para este CNPJ.", norm),
			OccupiedNames:  occupiedNames,
		}
	}

	if roleDef.Exclusive {
		if !occupiedSet["SERVIDOR"] {
			return SuggestNameResponse{
				SuggestedName:  "SERVIDOR",
				NormalizedName: "SERVIDOR",
				Role:           roleDef.Code,
				RoleLabel:      roleDef.Label,
				Available:      true,
				Reason:         "Recomendamos SERVIDOR (função principal exclusiva livre neste CNPJ).",
				OccupiedNames:  occupiedNames,
			}
		}
		return SuggestNameResponse{
			SuggestedName:   "SERVIDOR",
			NormalizedName:  "SERVIDOR",
			Role:            roleDef.Code,
			RoleLabel:       roleDef.Label,
			Available:       false,
			Reason:          "O nome SERVIDOR é exclusivo e já está em uso neste CNPJ. Selecione Substituir computador caso seja a mesma máquina.",
			OccupiedNumbers: []int{1},
			OccupiedNames:   occupiedNames,
		}
	}

	prefix := roleDef.BasePrefix
	var occupiedNumbers []int
	numMap := make(map[int]bool)
	for _, name := range occupiedNames {
		if strings.HasPrefix(name, prefix+"-") {
			suffix := strings.TrimPrefix(name, prefix+"-")
			if n, err := strconv.Atoi(suffix); err == nil && n > 0 && !numMap[n] {
				numMap[n] = true
				occupiedNumbers = append(occupiedNumbers, n)
			}
		}
	}
	sort.Ints(occupiedNumbers)

	candidateNum := 1
	for numMap[candidateNum] {
		candidateNum++
	}
	numStr := fmt.Sprintf("%02d", candidateNum)
	maxPrefixLen := MaxWindowsHostnameLength - 1 - len(numStr)
	safePrefix := prefix
	if len(safePrefix) > maxPrefixLen {
		safePrefix = safePrefix[:maxPrefixLen]
	}
	candidate := fmt.Sprintf("%s-%s", safePrefix, numStr)

	var reason string
	if len(occupiedNumbers) == 0 {
		reason = fmt.Sprintf("Recomendamos %s como primeiro equipamento da função %s neste CNPJ.", candidate, roleDef.Label)
	} else {
		var usedLabels []string
		for _, n := range occupiedNumbers {
			if len(usedLabels) < 4 {
				usedLabels = append(usedLabels, fmt.Sprintf("%s-%02d", safePrefix, n))
			}
		}
		reason = fmt.Sprintf("Recomendamos %s porque %s já estão em uso neste CNPJ.", candidate, strings.Join(usedLabels, ", "))
	}

	return SuggestNameResponse{
		SuggestedName:   candidate,
		NormalizedName:  candidate,
		Role:            roleDef.Code,
		RoleLabel:       roleDef.Label,
		Available:       true,
		Reason:          reason,
		OccupiedNumbers: occupiedNumbers,
		OccupiedNames:   occupiedNames,
	}
}

func postInstallerJSON(ctx context.Context, client *http.Client, url string, installerToken string, reqBody any, respBody any) error {
	b, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}
	defer clear(b)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+installerToken)
	req.Header.Set("Cache-Control", "no-store")
	resp, err := client.Do(req)
	req.Header.Del("Authorization")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return err
	}
	defer clear(data)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var env struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &env) == nil && env.Error.Message != "" {
			return fmt.Errorf("%s: %s", env.Error.Code, env.Error.Message)
		}
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	if respBody != nil {
		return json.Unmarshal(data, respBody)
	}
	return nil
}

func FetchInstallationContext(ctx context.Context, client *http.Client, endpoint string, p GenericProvisioning, req InstallationContextRequest) (InstallationContextResponse, error) {
	var out InstallationContextResponse
	err := postInstallerJSON(ctx, client, endpoint+"/v1/agent/installation/context", p.InstallerToken, req, &out)
	return out, err
}

func RequestNameSuggestion(ctx context.Context, client *http.Client, endpoint string, p GenericProvisioning, req SuggestNameRequest) (SuggestNameResponse, error) {
	var out SuggestNameResponse
	err := postInstallerJSON(ctx, client, endpoint+"/v1/agent/installation/suggest-name", p.InstallerToken, req, &out)
	return out, err
}

func RequestReserveName(ctx context.Context, client *http.Client, endpoint string, p GenericProvisioning, req ReserveNameRequest) (ReserveNameResponse, error) {
	var out ReserveNameResponse
	err := postInstallerJSON(ctx, client, endpoint+"/v1/agent/installation/reserve-name", p.InstallerToken, req, &out)
	return out, err
}

func RequestConfirmName(ctx context.Context, client *http.Client, endpoint string, p GenericProvisioning, req ConfirmNameRequest) error {
	return postInstallerJSON(ctx, client, endpoint+"/v1/agent/installation/confirm-name", p.InstallerToken, req, nil)
}
