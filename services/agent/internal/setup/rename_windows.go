//go:build windows

package setup

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"golang.org/x/sys/windows"
)

const (
	computerNamePhysicalDnsHostname = 5
	mbYesNo                         = 0x00000004
	mbIconQuestion                  = 0x00000020
	mbIconWarning                   = 0x00000030
	idYes                           = 6
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

func ApplyWindowsComputerRename(desiredName string, renameRequested bool) (statusRenomeacao string, erroRenomeacao string, needsReboot bool) {
	norm, msg, ok := ValidateWindowsHostname(desiredName)
	if !ok {
		return "ERRO", msg, false
	}
	if !renameRequested {
		return "NAO_SOLICITADO", "", false
	}

	currentHost, _ := os.Hostname()
	currentNorm := NormalizeWindowsHostname(currentHost)
	if currentNorm != "" && strings.EqualFold(currentNorm, norm) {
		return "CONFIRMADO", "", false
	}

	if joined, domainName := IsDomainJoinedWindows(); joined {
		return "ERRO", fmt.Sprintf("Computador em domínio Active Directory (%s): renomeação automática bloqueada por segurança.", domainName), false
	}

	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	setComputerNameExW := kernel32.NewProc("SetComputerNameExW")
	r1, _, callErr := setComputerNameExW.Call(
		uintptr(computerNamePhysicalDnsHostname),
		uintptr(unsafe.Pointer(ptr(norm))),
	)
	if r1 != 0 {
		return "APLICADO_AGUARDANDO_REBOOT", "", true
	}

	// Fallback seguro via PowerShell Rename-Computer caso SetComputerNameExW falhe
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
		fmt.Sprintf("Rename-Computer -NewName '%s' -Force -ErrorAction Stop", norm))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := cmd.CombinedOutput(); err != nil {
		detail := strings.TrimSpace(string(out))
		if detail == "" && callErr != nil {
			detail = callErr.Error()
		}
		if len(detail) > 200 {
			detail = detail[:200]
		}
		return "ERRO", fmt.Sprintf("Falha ao alterar o nome do Windows para %s: %s", norm, detail), false
	}
	return "APLICADO_AGUARDANDO_REBOOT", "", true
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
	state, err := LoadNamingState(ps)
	if err != nil {
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
	currentHost, _ := os.Hostname()
	currentNorm := NormalizeWindowsHostname(currentHost)
	if state.WindowsHostnameDesejado != "" && currentNorm != "" && strings.EqualFold(currentNorm, state.WindowsHostnameDesejado) {
		state.StatusRenomeacao = "CONFIRMADO"
		state.ErroRenomeacao = ""
		state.RebootPromptPending = false
		_ = SaveNamingState(ps, state)
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
	if err != nil || !state.RebootPromptPending || state.StatusRenomeacao != "APLICADO_AGUARDANDO_REBOOT" {
		summary := "Configuracao concluida. O computador esta disponivel na lista Dispositivos do painel XPoint."
		if err == nil && state.WindowsHostnameDesejado != "" {
			summary += fmt.Sprintf("\n\nIdentificação configurada: %s (%s)", state.WindowsHostnameDesejado, RoleDefinitionByCode(state.Role).Label)
			if state.StatusRenomeacao == "ERRO" && state.ErroRenomeacao != "" {
				summary += "\nAviso de renomeação do Windows: " + state.ErroRenomeacao
			}
		}
		summary += "\n\nLog: " + logPath
		Message(summary)
		return
	}

	state.RebootPromptPending = false
	_ = SaveNamingState(ps, state)

	currentHost, _ := os.Hostname()
	promptText := fmt.Sprintf(
		"Configuração concluída com sucesso!\n\n"+
			"• Nome configurado no painel: %s (%s)\n"+
			"• Nome atual no Windows: %s\n"+
			"• Novo nome real no Windows: %s (aguardando reinicialização)\n\n"+
			"Para que o novo nome do computador no Windows entre em vigor completamente, é necessário reiniciar o Windows.\n\n"+
			"Deseja reiniciar este computador agora?\n"+
			"(Clique em 'Não' para reiniciar depois; o acesso remoto já está ativo e funcionando.)",
		state.WindowsHostnameDesejado,
		RoleDefinitionByCode(state.Role).Label,
		currentHost,
		state.WindowsHostnameDesejado,
	)

	if AskYesNo(promptText, "XPoint Remote — Reinicialização do Windows", false) {
		cmd := exec.Command("shutdown.exe", "/r", "/t", "5", "/c", "XPoint Remote: aplicando novo nome do computador "+state.WindowsHostnameDesejado)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		_ = cmd.Start()
	}
}
