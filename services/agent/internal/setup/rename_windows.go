//go:build windows

package setup

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"golang.org/x/sys/windows"
)

const (
	mbYesNo        = 0x00000004
	mbIconQuestion = 0x00000020
	mbIconWarning  = 0x00000030
	idYes          = 6
)

func AskYesNo(question, title string, warning bool) bool {
	if title == "" {
		title = "XPoint Remote"
	}
	flags := uintptr(mbYesNo | mbIconQuestion)
	if warning {
		flags = uintptr(mbYesNo | mbIconWarning)
	}
	ret, _, _ := windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(
		0,
		uintptr(unsafe.Pointer(ptr(question))),
		uintptr(unsafe.Pointer(ptr(title))),
		flags,
	)
	return ret == idYes
}

func IsDomainJoinedWindows() (bool, string) {
	var domain *uint16
	var joinStatus uint32
	err := syscall.NetGetJoinInformation(nil, &domain, &joinStatus)
	if err != nil {
		return false, ""
	}
	defer syscall.NetApiBufferFree((*byte)(unsafe.Pointer(domain)))
	name := ""
	if domain != nil {
		name = windows.UTF16PtrToString(domain)
	}
	return joinStatus == syscall.NetSetupDomainName, name
}

func ApplyWindowsComputerRename(_ string, _ bool) (statusRenomeacao string, erroRenomeacao string, needsReboot bool) {
	return "NAO_SOLICITADO", "", false
}

func namingStatePath(ps Paths) string {
	return filepath.Join(ps.Data, "naming-state.json")
}

func SaveNamingState(ps Paths, state PersistedNamingState) error {
	h, err := secureDir(ps.Data)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return replacePrivate(namingStatePath(ps), b)
}

func LoadNamingState(ps Paths) (PersistedNamingState, error) {
	var state PersistedNamingState
	data, err := readPrivate(namingStatePath(ps), 8192)
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return PersistedNamingState{}, err
	}
	return state, nil
}

func EnrichDataDivasWithNamingState(info *api.DataDivasInfo, ps Paths) *api.DataDivasInfo {
	info = EnrichDataDivasWithTelemetry(info)
	state, err := LoadNamingState(ps)
	if err != nil {
		info.UltimaSincronizacao = time.Now().UTC().Format(time.RFC3339)
		return info
	}
	if info == nil {
		info = &api.DataDivasInfo{}
	}
	if state.Cnpj != "" && info.CNPJ == "" {
		info.CNPJ = FormatCnpj(state.Cnpj)
	}
	if state.RazaoSocial != "" && info.RazaoSocial == "" {
		info.RazaoSocial = state.RazaoSocial
	}
	if state.NomeFantasia != "" && info.NomeFantasia == "" {
		info.NomeFantasia = state.NomeFantasia
	}
	if state.Role != "" {
		info.Funcao = state.Role
	}
	if state.WindowsHostnameDesejado != "" {
		info.WindowsHostnameDesejado = state.WindowsHostnameDesejado
		if info.NomeMaq == "" {
			info.NomeMaq = state.WindowsHostnameDesejado
		}
	}
	if state.StatusRenomeacao != "" {
		info.StatusRenomeacao = state.StatusRenomeacao
	}
	if state.ErroRenomeacao != "" {
		info.ErroRenomeacao = state.ErroRenomeacao
	}
	if state.ReservationID != "" {
		info.ReservaID = state.ReservationID
	}
	if state.ReplacesDeviceID != "" {
		info.SubstituiuDeviceID = state.ReplacesDeviceID
	}
	info.UltimaSincronizacao = time.Now().UTC().Format(time.RFC3339)
	return info
}

func PromptCompletionAndOptionalReboot(logPath string) {
	ps, err := paths()
	if err != nil {
		Message("Configuracao concluida. O computador esta disponivel na lista Dispositivos do painel XPoint.\n\nLog: " + logPath)
		return
	}
	state, err := LoadNamingState(ps)
	summary := "Configuracao concluida. O computador esta disponivel na lista Dispositivos do painel XPoint."
	if err == nil && state.WindowsHostnameDesejado != "" {
		summary += fmt.Sprintf("\n\nIdentificação configurada no painel: %s (%s)", state.WindowsHostnameDesejado, RoleDefinitionByCode(state.Role).Label)
	}
	summary += "\n\nLog: " + logPath
	Message(summary)
}
