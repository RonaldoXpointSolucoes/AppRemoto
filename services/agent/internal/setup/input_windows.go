//go:build windows

package setup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
	"golang.org/x/sys/windows"
)

var ErrInputCancelled = errors.New("installation cancelled before changes")

const (
	wmAppDiagDone    = 0x8001
	wmAppContextDone = 0x8002
	wmAppReserveDone = 0x8003

	cbAddString    = 0x0143
	cbResetContent = 0x014B
	cbGetCurSel    = 0x0147
	cbSetCurSel    = 0x014E
	cbnSelChange   = 1

	lbAddString    = 0x0180
	lbResetContent = 0x0184

	bmGetCheck  = 0x00F0
	bmSetCheck  = 0x00F1
	bstChecked  = 1
	enChange    = 0x0300
	emLimitText = 0x00C5
)

type operationChoice struct {
	Mode             string
	Label            string
	ReplacesDeviceID string
	PresetRole       string
	PresetName       string
}

func discoverLocalMachineContext() (deviceUUID string, rustdeskID string, currentHost string) {
	currentHost, _ = os.Hostname()
	if ps, err := paths(); err == nil {
		if prepareErr := state.PrepareIdentityDirectory(ps.Agent); prepareErr == nil {
			if id, loadErr := state.LoadOrCreateIdentity(filepath.Join(ps.Agent, "identity.json")); loadErr == nil {
				deviceUUID = id.DeviceUUID
			}
		}
	}
	if rdPath, err := findInstalledRustDesk(); err == nil {
		if rd, err := rustdesk.NewClient(nil, rustdesk.Options{ExecutablePath: rdPath, CommandTimeout: 5 * time.Second}); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if info, err := rd.Discover(ctx); err == nil {
				rustdeskID = info.ID
			}
			cancel()
		}
	}
	return deviceUUID, rustdeskID, currentHost
}

func promptInstallation(report *Report, generic GenericProvisioning) (*InstallationInput, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	user := windows.NewLazySystemDLL("user32.dll")
	kernel := windows.NewLazySystemDLL("kernel32.dll")
	gdi := windows.NewLazySystemDLL("gdi32.dll")
	create := user.NewProc("CreateWindowExW")
	def := user.NewProc("DefWindowProcW")
	send := user.NewProc("SendMessageW")

	deviceUUID, rustdeskID, currentHost := discoverLocalMachineContext()
	dataDivas := CollectDataDivasInfo()

	initialCnpj := ""
	initialCompany := ""
	initialFantasia := ""
	initialSerial := ""
	initialLocalMaq := ""
	if dataDivas != nil {
		initialCnpj = NormalizeCnpjDigits(dataDivas.CNPJ)
		initialCompany = dataDivas.RazaoSocial
		initialFantasia = dataDivas.NomeFantasia
		if initialCompany == "" {
			initialCompany = dataDivas.NomeFantasia
		}
		initialSerial = dataDivas.Serial
		initialLocalMaq = dataDivas.NomeMaq
	}
	if ps, err := paths(); err == nil {
		if savedState, err := LoadNamingState(ps); err == nil {
			if initialCnpj == "" && savedState.Cnpj != "" {
				initialCnpj = NormalizeCnpjDigits(savedState.Cnpj)
			}
			if initialCompany == "" && savedState.RazaoSocial != "" {
				initialCompany = savedState.RazaoSocial
			}
			if initialFantasia == "" && savedState.NomeFantasia != "" {
				initialFantasia = savedState.NomeFantasia
			}
		}
	}

	var (
		cnpjEdit, companyEdit, groupSummaryLabel      uintptr
		computersList                                 uintptr
		operationCombo, roleCombo, machineEdit        uintptr
		reasonLabel, renameCheckbox, statusLabel      uintptr
		queryCnpjBtn, checkBtn, installBtn, cancelBtn uintptr
	)

	var (
		mu               sync.Mutex
		loadedContext    *InstallationContextResponse
		operationChoices []operationChoice
		busy             atomic.Bool
		updatingControls atomic.Bool
		selected         *InstallationInput
		lastContextErr   error
		pendingReserve   *InstallationInput
		reserveErr       error
		conflictSuggest  string
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	setText := func(ctrl uintptr, text string) {
		user.NewProc("SetWindowTextW").Call(ctrl, uintptr(unsafe.Pointer(ptr(text))))
	}

	populateOperationCombo := func(ctxResp *InstallationContextResponse) {
		updatingControls.Store(true)
		defer updatingControls.Store(false)
		send.Call(operationCombo, cbResetContent, 0, 0)
		operationChoices = []operationChoice{
			{Mode: "NEW_INSTALL", Label: "Nova instalação neste CNPJ (sugerir próximo nome disponível)"},
		}
		selectedIndex := 0
		if ctxResp != nil && ctxResp.ExistingDevice != nil {
			ex := ctxResp.ExistingDevice
			operationChoices = append(operationChoices, operationChoice{
				Mode:       "REINSTALL_SAME_DEVICE",
				Label:      fmt.Sprintf("Reinstalação neste computador — manter %s (%s)", ex.NomeNormalizado, ex.FuncaoLabel),
				PresetRole: ex.Funcao,
				PresetName: ex.NomeNormalizado,
			})
			if ctxResp.DetectedOperation == "REINSTALL_SAME_DEVICE" {
				selectedIndex = len(operationChoices) - 1
			}
		}
		if ctxResp != nil {
			for _, comp := range ctxResp.Computers {
				if comp.Situacao == "substituido" || comp.Situacao == "liberado" {
					continue
				}
				if ctxResp.ExistingDevice != nil && comp.DeviceID == ctxResp.ExistingDevice.DeviceID {
					continue
				}
				operationChoices = append(operationChoices, operationChoice{
					Mode:             "REPLACE_DEVICE",
					Label:            fmt.Sprintf("Substituir computador antigo: %s (%s • %s)", comp.NomeNormalizado, comp.FuncaoLabel, strings.ToUpper(comp.Situacao)),
					ReplacesDeviceID: comp.DeviceID,
					PresetRole:       comp.Funcao,
					PresetName:       comp.NomeNormalizado,
				})
			}
		}
		for _, ch := range operationChoices {
			send.Call(operationCombo, cbAddString, 0, uintptr(unsafe.Pointer(ptr(ch.Label))))
		}
		send.Call(operationCombo, cbSetCurSel, uintptr(selectedIndex), 0)
	}

	populateComputersList := func(ctxResp *InstallationContextResponse, offline bool) {
		send.Call(computersList, lbResetContent, 0, 0)
		if offline {
			line := "Modo offline / sem resposta do servidor: aplicando sugestão local segura."
			send.Call(computersList, lbAddString, 0, uintptr(unsafe.Pointer(ptr(line))))
			return
		}
		if ctxResp == nil || len(ctxResp.Computers) == 0 {
			line := "Nenhum computador registrado anteriormente neste CNPJ — este será o 1º equipamento do grupo."
			send.Call(computersList, lbAddString, 0, uintptr(unsafe.Pointer(ptr(line))))
			return
		}
		for _, c := range ctxResp.Computers {
			sit := "OFFLINE"
			switch c.Situacao {
			case "online":
				sit = "ONLINE"
			case "substituido":
				sit = "SUBSTITUÍDO"
			case "pendente":
				sit = "PENDENTE"
			}
			winInfo := c.WindowsHostnameAtual
			if c.StatusRenomeacao == "APLICADO_AGUARDANDO_REBOOT" {
				winInfo += " (aguardando reboot)"
			}
			line := fmt.Sprintf("%-15s | %-18s | %-11s | Windows: %s", c.NomeNormalizado, c.FuncaoLabel, sit, winInfo)
			send.Call(computersList, lbAddString, 0, uintptr(unsafe.Pointer(ptr(line))))
		}
	}

	currentRoleCode := func() string {
		idx, _, _ := send.Call(roleCombo, cbGetCurSel, 0, 0)
		if int(idx) >= 0 && int(idx) < len(DefaultRoleCatalog) {
			return DefaultRoleCatalog[int(idx)].Code
		}
		return "CAIXA"
	}

	selectRoleCode := func(code string) {
		for i, item := range DefaultRoleCatalog {
			if strings.EqualFold(item.Code, code) {
				send.Call(roleCombo, cbSetCurSel, uintptr(i), 0)
				return
			}
		}
	}

	currentOperationChoice := func() operationChoice {
		idx, _, _ := send.Call(operationCombo, cbGetCurSel, 0, 0)
		if int(idx) >= 0 && int(idx) < len(operationChoices) {
			return operationChoices[int(idx)]
		}
		if len(operationChoices) > 0 {
			return operationChoices[0]
		}
		return operationChoice{Mode: "NEW_INSTALL", Label: "Nova instalação"}
	}

	recomputeSuggestion := func(overwriteName bool) {
		mu.Lock()
		ctxResp := loadedContext
		mu.Unlock()

		op := currentOperationChoice()
		roleCode := currentRoleCode()

		if (op.Mode == "REINSTALL_SAME_DEVICE" || op.Mode == "REPLACE_DEVICE") && op.PresetName != "" && overwriteName {
			updatingControls.Store(true)
			selectRoleCode(op.PresetRole)
			setText(machineEdit, op.PresetName)
			updatingControls.Store(false)
			if op.Mode == "REINSTALL_SAME_DEVICE" {
				setText(reasonLabel, fmt.Sprintf("Reinstalação detectada neste mesmo computador: mantendo o nome %s sem duplicar o cadastro.", op.PresetName))
			} else {
				setText(reasonLabel, fmt.Sprintf("Substituição selecionada: este computador assumirá o nome %s e o equipamento antigo será marcado como substituído.", op.PresetName))
			}
			return
		}

		var comps []ExistingCnpjComputer
		allowSame := ""
		if ctxResp != nil {
			comps = ctxResp.Computers
			if op.Mode == "REINSTALL_SAME_DEVICE" && ctxResp.ExistingDevice != nil {
				allowSame = ctxResp.ExistingDevice.NomeNormalizado
			} else if op.Mode == "REPLACE_DEVICE" {
				for _, c := range comps {
					if c.DeviceID == op.ReplacesDeviceID {
						allowSame = c.NomeNormalizado
						break
					}
				}
			}
		}

		customText := ""
		if roleCode == "PERSONALIZADO" || !overwriteName {
			customText = cleanInput(readControlText(user, machineEdit))
		}
		sug := LocalSuggestNameForRole(roleCode, comps, customText, allowSame)
		if overwriteName && roleCode != "PERSONALIZADO" {
			updatingControls.Store(true)
			setText(machineEdit, sug.SuggestedName)
			updatingControls.Store(false)
		}
		setText(reasonLabel, sug.Reason)
	}

	triggerContextFetch := func(hwnd uintptr) {
		rawCnpj := cleanInput(readControlText(user, cnpjEdit))
		cnpjDigits := NormalizeCnpjDigits(rawCnpj)
		if !IsValidCnpj14(cnpjDigits) {
			setText(groupSummaryLabel, "Informe um CNPJ válido de 14 dígitos para consultar os computadores já cadastrados na empresa.")
			populateComputersList(nil, false)
			populateOperationCombo(nil)
			recomputeSuggestion(true)
			return
		}
		if busy.Swap(true) {
			return
		}
		setText(cnpjEdit, FormatCnpj(cnpjDigits))
		user.NewProc("EnableWindow").Call(installBtn, 0)
		user.NewProc("EnableWindow").Call(queryCnpjBtn, 0)
		setText(statusLabel, "Status: Consultando grupo empresarial e computadores do CNPJ "+FormatCnpj(cnpjDigits)+" no Appwrite…")

		companyVal := cleanInput(readControlText(user, companyEdit))
		go func() {
			reqCtx, cancelReq := context.WithTimeout(ctx, 12*time.Second)
			defer cancelReq()
			resp, err := FetchInstallationContext(reqCtx, preparationHTTPClient(), APIURL, generic, InstallationContextRequest{
				Cnpj:                 cnpjDigits,
				RazaoSocial:          companyVal,
				NomeFantasia:         initialFantasia,
				Serial:               initialSerial,
				DeviceUUID:           deviceUUID,
				RustDeskID:           rustdeskID,
				WindowsHostnameAtual: currentHost,
			})
			mu.Lock()
			if err == nil {
				loadedContext = &resp
				lastContextErr = nil
			} else {
				loadedContext = nil
				lastContextErr = err
			}
			mu.Unlock()
			if ctx.Err() == nil {
				user.NewProc("PostMessageW").Call(hwnd, wmAppContextDone, 0, 0)
			}
		}()
	}

	procedure := syscall.NewCallback(func(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
		switch msg {
		case 0x10: // WM_CLOSE
			user.NewProc("DestroyWindow").Call(hwnd)
			return 0
		case 0x2: // WM_DESTROY
			cancel()
			user.NewProc("PostQuitMessage").Call(0)
			return 0
		case wmAppDiagDone:
			busy.Store(false)
			user.NewProc("EnableWindow").Call(installBtn, 1)
			user.NewProc("EnableWindow").Call(checkBtn, 1)
			user.NewProc("EnableWindow").Call(queryCnpjBtn, 1)
			text := "Status: Verificação concluída. Conexão com os servidores confirmada."
			if wparam != 0 {
				text = "Status: A verificação encontrou uma pendência de rede. Abra o log para ver a etapa."
			}
			setText(statusLabel, text)
			return 0
		case wmAppContextDone:
			busy.Store(false)
			user.NewProc("EnableWindow").Call(installBtn, 1)
			user.NewProc("EnableWindow").Call(queryCnpjBtn, 1)
			mu.Lock()
			ctxResp := loadedContext
			err := lastContextErr
			mu.Unlock()
			if err != nil || ctxResp == nil {
				setText(groupSummaryLabel, "Modo offline: não foi possível consultar o servidor agora. Sugestão calculada localmente.")
				populateComputersList(nil, true)
				populateOperationCombo(nil)
				recomputeSuggestion(true)
				setText(statusLabel, "Status: Servidor indisponível para consulta prévia (modo contingência ativo).")
				return 0
			}
			if cleanInput(readControlText(user, companyEdit)) == "" && ctxResp.Group.RazaoSocial != "" {
				setText(companyEdit, ctxResp.Group.RazaoSocial)
			}
			opDesc := "Nova instalação"
			if ctxResp.DetectedOperation == "REINSTALL_SAME_DEVICE" && ctxResp.ExistingDevice != nil {
				opDesc = "Reinstalação detectada (" + ctxResp.ExistingDevice.NomeNormalizado + ")"
			}
			setText(groupSummaryLabel, fmt.Sprintf(
				"Grupo CNPJ %s • %d computador(es) vinculado(s) (%d online, %d offline) • %s",
				ctxResp.Group.CnpjFormatado,
				ctxResp.Group.TotalComputadores,
				ctxResp.Group.OnlineCount,
				ctxResp.Group.OfflineCount,
				opDesc,
			))
			populateComputersList(ctxResp, false)
			populateOperationCombo(ctxResp)
			updatingControls.Store(true)
			selectRoleCode(ctxResp.DefaultRole)
			setText(machineEdit, ctxResp.DefaultSuggestion.SuggestedName)
			updatingControls.Store(false)
			setText(reasonLabel, ctxResp.DefaultSuggestion.Reason)
			setText(statusLabel, "Status: Computadores do CNPJ carregados. Confirme a função e o nome para instalar.")
			return 0
		case wmAppReserveDone:
			busy.Store(false)
			user.NewProc("EnableWindow").Call(installBtn, 1)
			user.NewProc("EnableWindow").Call(queryCnpjBtn, 1)
			user.NewProc("EnableWindow").Call(checkBtn, 1)
			mu.Lock()
			resInput := pendingReserve
			err := reserveErr
			nextSug := conflictSuggest
			mu.Unlock()
			if err == nil && resInput != nil {
				selected = resInput
				user.NewProc("DestroyWindow").Call(hwnd)
				return 0
			}
			errMsg := ""
			if err != nil {
				errMsg = err.Error()
			}
			if strings.Contains(errMsg, "NAME_ALREADY_IN_USE") {
				if nextSug != "" {
					updatingControls.Store(true)
					setText(machineEdit, nextSug)
					updatingControls.Store(false)
				}
				Message("O nome selecionado acabou de ser ocupado ou já está em uso neste CNPJ.\n\n" + errMsg + "\n\nAtualizamos a sugestão com o próximo nome disponível.")
				triggerContextFetch(hwnd)
				return 0
			}
			if AskYesNo(
				"Não foi possível reservar o nome online no servidor agora ("+errMsg+").\n\nDeseja prosseguir com a instalação usando o nome "+resInput.DesiredHostname+" em modo de contingência (sincronização automática ao conectar)?",
				"XPoint Remote — Contingência de Rede",
				true,
			) {
				resInput.OfflineFallback = true
				selected = resInput
				user.NewProc("DestroyWindow").Call(hwnd)
			} else {
				setText(statusLabel, "Status: Reserva de nome cancelada pelo técnico. Verifique a função ou conexão.")
			}
			return 0
		case 0x111: // WM_COMMAND
			id := uint16(wparam & 0xFFFF)
			notifyCode := uint16((wparam >> 16) & 0xFFFF)
			if updatingControls.Load() {
				return 0
			}
			switch id {
			case 14: // operationCombo
				if notifyCode == cbnSelChange {
					recomputeSuggestion(true)
				}
				return 0
			case 15: // roleCombo
				if notifyCode == cbnSelChange {
					recomputeSuggestion(true)
				}
				return 0
			case 11: // machineEdit
				if notifyCode == enChange {
					typed := cleanInput(readControlText(user, machineEdit))
					norm, msg, ok := ValidateWindowsHostname(typed)
					if !ok && typed != "" {
						setText(reasonLabel, "Atenção: "+msg)
					} else if ok {
						roleCode := currentRoleCode()
						if roleCode == "PERSONALIZADO" {
							recomputeSuggestion(false)
						} else {
							setText(reasonLabel, fmt.Sprintf("Nome Windows formatado: %s (%d/%d caracteres).", norm, len(norm), MaxWindowsHostnameLength))
						}
					}
				}
				return 0
			case 5: // Consultar CNPJ button
				triggerContextFetch(hwnd)
				return 0
			case 1: // Instalar Acesso button
				if busy.Load() {
					return 0
				}
				rawMachine := cleanInput(readControlText(user, machineEdit))
				normName, validationMsg, validHost := ValidateWindowsHostname(rawMachine)
				if !validHost {
					Message("Nome do computador inválido para o Windows:\n\n" + validationMsg + "\n\nUse até 15 caracteres (letras A-Z, números 0-9 e hífen, sem acentos).")
					return 0
				}
				rawCnpj := NormalizeCnpjDigits(cleanInput(readControlText(user, cnpjEdit)))
				companyText := cleanInput(readControlText(user, companyEdit))
				if companyText == "" {
					if initialFantasia != "" {
						companyText = initialFantasia
					} else if IsValidCnpj14(rawCnpj) {
						companyText = "CNPJ " + FormatCnpj(rawCnpj)
					} else {
						companyText = "Remote Platform E2E"
					}
				}
				roleCode := currentRoleCode()
				opChoice := currentOperationChoice()
				chk, _, _ := send.Call(renameCheckbox, bmGetCheck, 0, 0)
				renameWin := chk == bstChecked

				// Proteção adicional: se o computador atual já se chama SERVIDOR no Windows e o técnico escolheu outro nome
				if renameWin && strings.EqualFold(NormalizeWindowsHostname(currentHost), "SERVIDOR") && !strings.EqualFold(normName, "SERVIDOR") {
					if !AskYesNo(
						fmt.Sprintf("Atenção: Este computador atualmente se chama 'SERVIDOR' no Windows.\n\nVocê selecionou renomeá-lo para '%s' (%s).\n\nTem certeza de que deseja alterar o nome real deste computador no Windows?", normName, RoleDefinitionByCode(roleCode).Label),
						"Confirmação de Segurança — Computador SERVIDOR",
						true,
					) {
						return 0
					}
				}

				candidateInput := &InstallationInput{
					CompanyName:       companyText,
					DeviceDisplayName: normName,
					Cnpj:              rawCnpj,
					RazaoSocial:       companyText,
					NomeFantasia:      initialFantasia,
					Role:              roleCode,
					DesiredHostname:   normName,
					OperationMode:     opChoice.Mode,
					ReplacesDeviceID:  opChoice.ReplacesDeviceID,
					RenameWindows:     renameWin,
				}
				if !candidateInput.Valid() {
					Message("Informe os dados da empresa e do computador (até 128 caracteres).")
					return 0
				}

				if !IsValidCnpj14(rawCnpj) || deviceUUID == "" {
					selected = candidateInput
					user.NewProc("DestroyWindow").Call(hwnd)
					return 0
				}

				// Reserva atômica do nome no backend antes de iniciar a instalação
				busy.Store(true)
				user.NewProc("EnableWindow").Call(installBtn, 0)
				user.NewProc("EnableWindow").Call(queryCnpjBtn, 0)
				user.NewProc("EnableWindow").Call(checkBtn, 0)
				setText(statusLabel, fmt.Sprintf("Status: Reservando o nome %s para o CNPJ %s no servidor…", normName, FormatCnpj(rawCnpj)))

				go func() {
					reqCtx, cancelReq := context.WithTimeout(ctx, 12*time.Second)
					defer cancelReq()
					res, err := RequestReserveName(reqCtx, preparationHTTPClient(), APIURL, generic, ReserveNameRequest{
						Cnpj:                 rawCnpj,
						NormalizedName:       normName,
						Role:                 roleCode,
						DeviceUUID:           deviceUUID,
						RustDeskID:           rustdeskID,
						WindowsHostnameAtual: currentHost,
						OperationMode:        opChoice.Mode,
						ReplacesDeviceID:     opChoice.ReplacesDeviceID,
						RenameWindows:        renameWin,
						RazaoSocial:          companyText,
						NomeFantasia:         initialFantasia,
					})
					var nextSuggested string
					if err != nil && strings.Contains(err.Error(), "NAME_ALREADY_IN_USE") {
						if sug, sugErr := RequestNameSuggestion(reqCtx, preparationHTTPClient(), APIURL, generic, SuggestNameRequest{
							Cnpj:          rawCnpj,
							Role:          roleCode,
							DeviceUUID:    deviceUUID,
							RustDeskID:    rustdeskID,
							OperationMode: opChoice.Mode,
						}); sugErr == nil {
							nextSuggested = sug.SuggestedName
						}
					}
					mu.Lock()
					if err == nil {
						candidateInput.ReservationID = res.ReservationID
					}
					pendingReserve = candidateInput
					reserveErr = err
					conflictSuggest = nextSuggested
					mu.Unlock()
					if ctx.Err() == nil {
						user.NewProc("PostMessageW").Call(hwnd, wmAppReserveDone, 0, 0)
					}
				}()
				return 0
			case 2: // Cancelar
				user.NewProc("DestroyWindow").Call(hwnd)
				return 0
			case 3: // Verificar conexão
				if busy.Swap(true) {
					return 0
				}
				user.NewProc("EnableWindow").Call(installBtn, 0)
				user.NewProc("EnableWindow").Call(checkBtn, 0)
				user.NewProc("EnableWindow").Call(queryCnpjBtn, 0)
				setText(statusLabel, "Status: Verificando conexão com o servidor e componentes locais…")
				go func() {
					failed := runDiagnostics(ctx, report)
					if ctx.Err() == nil {
						var result uintptr
						if failed {
							result = 1
						}
						user.NewProc("PostMessageW").Call(hwnd, wmAppDiagDone, result, 0)
					}
				}()
				return 0
			case 4: // Abrir log
				OpenLog(report)
				return 0
			}
		}
		value, _, _ := def.Call(hwnd, uintptr(msg), wparam, lparam)
		return value
	})

	instance, _, _ := kernel.NewProc("GetModuleHandleW").Call(0)
	icon, _, _ := user.NewProc("LoadIconW").Call(instance, 1)
	if icon == 0 {
		icon, _, _ = user.NewProc("LoadIconW").Call(0, 32512)
	}
	name := ptr("XPointGenericSetupInput")
	wc := windowClass{Size: uint32(unsafe.Sizeof(windowClass{})), Procedure: procedure, Instance: instance, Icon: icon, SmallIcon: icon, Background: 6, Name: name}
	atom, _, _ := user.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&wc)))
	if atom == 0 {
		return nil, errors.New("input window unavailable")
	}
	defer user.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(name)), instance)

	winW, winH := 780, 660
	screenX, _, _ := user.NewProc("GetSystemMetrics").Call(0)
	screenY, _, _ := user.NewProc("GetSystemMetrics").Call(1)
	hwnd, _, _ := create.Call(0, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(ptr("XPoint Remote — Identificação do Computador (v"+Version+")"))), 0x10C80000, (screenX-uintptr(winW))/2, (screenY-uintptr(winH))/2, uintptr(winW), uintptr(winH), 0, 0, instance, 0)
	if hwnd == 0 {
		return nil, errors.New("input window unavailable")
	}
	if icon != 0 {
		send.Call(hwnd, 0x80, 1, icon)
		send.Call(hwnd, 0x80, 0, icon)
	}

	titleFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-19)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	labelFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-13)), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	bodyFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-13)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	monoFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Consolas"))))
	smallFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	for _, f := range []uintptr{titleFont, labelFont, bodyFont, monoFont, smallFont} {
		if f != 0 {
			defer gdi.NewProc("DeleteObject").Call(f)
		}
	}

	controlWithFont := func(class, text string, x, y, w, h int, id uintptr, extra uint32, f uintptr) uintptr {
		value, _, _ := create.Call(0, uintptr(unsafe.Pointer(ptr(class))), uintptr(unsafe.Pointer(ptr(text))), uintptr(0x50000000|extra), uintptr(x), uintptr(y), uintptr(w), uintptr(h), hwnd, id, instance, 0)
		if f != 0 {
			send.Call(value, 0x30, f, 1)
		}
		return value
	}

	// Cabeçalho
	controlWithFont("STATIC", "Identificação do Computador — Gestão Inteligente por CNPJ", 24, 14, 720, 24, 0, 0, titleFont)
	controlWithFont("STATIC", FormatDataDivasSummary(dataDivas), 24, 40, 720, 18, 0, 0, smallFont)

	// Bloco 1: Identificação Empresarial
	controlWithFont("STATIC", "CNPJ da Empresa:", 24, 66, 200, 18, 0, 0, labelFont)
	cnpjEdit = controlWithFont("EDIT", FormatCnpj(initialCnpj), 24, 86, 190, 26, 12, 0x00810080, bodyFont)
	queryCnpjBtn = controlWithFont("BUTTON", "Consultar CNPJ", 222, 85, 126, 28, 5, 0x00010000, bodyFont)

	controlWithFont("STATIC", "Razão Social / Nome da Empresa:", 362, 66, 380, 18, 0, 0, labelFont)
	companyEdit = controlWithFont("EDIT", initialCompany, 362, 86, 380, 26, 13, 0x00810080, bodyFont)

	groupSummaryLabel = controlWithFont("STATIC", "Aguardando consulta dos computadores vinculados ao CNPJ…", 24, 118, 718, 18, 0, 0, smallFont)

	// Bloco 2: Computadores já existentes no CNPJ
	controlWithFont("STATIC", "Computadores já registrados neste CNPJ (Nome | Função | Situação | Nome no Windows):", 24, 142, 718, 18, 0, 0, labelFont)
	computersList = controlWithFont("LISTBOX", "", 24, 162, 718, 112, 16, 0x00A00001, monoFont)

	// Bloco 3: Configuração da máquina atual
	controlWithFont("STATIC", "Tipo de operação nesta máquina:", 24, 280, 348, 18, 0, 0, labelFont)
	operationCombo = controlWithFont("COMBOBOX", "", 24, 300, 348, 220, 14, 0x00210003, bodyFont)

	controlWithFont("STATIC", "Função do computador:", 390, 280, 352, 18, 0, 0, labelFont)
	roleCombo = controlWithFont("COMBOBOX", "", 390, 300, 352, 260, 15, 0x00210003, bodyFont)
	for _, item := range DefaultRoleCatalog {
		label := fmt.Sprintf("%s (%s)", item.Label, item.ExampleDefault)
		send.Call(roleCombo, cbAddString, 0, uintptr(unsafe.Pointer(ptr(label))))
	}

	controlWithFont("STATIC", "Nome padronizado do computador (máx. 15 caracteres A-Z, 0-9 e hífen):", 24, 336, 718, 18, 0, 0, labelFont)
	initialRole := InferRoleFromName(initialLocalMaq)
	if initialLocalMaq == "" {
		initialRole = InferRoleFromName(currentHost)
	}
	if initialRole == "PERSONALIZADO" {
		initialRole = "CAIXA"
	}
	selectRoleCode(initialRole)
	initialSug := LocalSuggestNameForRole(initialRole, nil, "", "")
	machineEdit = controlWithFont("EDIT", initialSug.SuggestedName, 24, 356, 718, 28, 11, 0x00810080, titleFont)
	send.Call(machineEdit, emLimitText, MaxWindowsHostnameLength, 0)

	reasonLabel = controlWithFont("STATIC", initialSug.Reason, 24, 390, 718, 34, 0, 0, smallFont)

	renameLabel := fmt.Sprintf("Alterar também o nome real deste computador no Windows para o nome selecionado (atual: %s)", currentHost)
	renameCheckbox = controlWithFont("BUTTON", renameLabel, 24, 428, 718, 24, 17, 0x00010003, labelFont)
	send.Call(renameCheckbox, bmSetCheck, bstChecked, 0)

	controlWithFont("STATIC", "A renomeação do Windows não reinicia a máquina automaticamente: ao final da instalação, você poderá escolher reiniciar agora ou depois.", 24, 456, 718, 20, 0, 0, smallFont)

	statusLabel = controlWithFont("STATIC", "Status: Pronto para instalar.", 24, 484, 718, 36, 0, 0, bodyFont)

	// Botões de ação
	checkBtn = controlWithFont("BUTTON", "Verificar conexão", 24, 534, 156, 36, 3, 0x00010000, bodyFont)
	controlWithFont("BUTTON", "Abrir log", 190, 534, 110, 36, 4, 0x00010000, bodyFont)
	cancelBtn = controlWithFont("BUTTON", "Cancelar", 460, 534, 112, 36, 2, 0x00010000, bodyFont)
	_ = cancelBtn
	installBtn = controlWithFont("BUTTON", "Instalar Acesso", 582, 534, 160, 36, 1, 0x00010001, labelFont)

	controlWithFont("STATIC", "RustDesk 1.4.9 • GNU AGPLv3 • XPoint Remote v"+Version+" • XPoint Soluções", 24, 584, 718, 20, 0, 0, smallFont)

	populateOperationCombo(nil)
	populateComputersList(nil, false)
	user.NewProc("SetFocus").Call(machineEdit)
	user.NewProc("UpdateWindow").Call(hwnd)

	// Se o CNPJ foi lido automaticamente do C:\DataDivas\config.ini, dispara a consulta ao abrir a janela
	if IsValidCnpj14(initialCnpj) {
		triggerContextFetch(hwnd)
	}

	var message windowMessage
	for {
		value, _, _ := user.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if value == 0 || int32(value) == -1 {
			break
		}
		dialog, _, _ := user.NewProc("IsDialogMessageW").Call(hwnd, uintptr(unsafe.Pointer(&message)))
		if dialog == 0 {
			user.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&message)))
			user.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&message)))
		}
	}
	if selected == nil {
		return nil, ErrInputCancelled
	}
	return selected, nil
}

func int32ToPtr(n int32) uintptr { return uintptr(int64(n)) }

func readControlText(user *windows.LazyDLL, control uintptr) string {
	buf := make([]uint16, 258)
	n, _, _ := user.NewProc("GetWindowTextW").Call(control, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n >= uintptr(len(buf)-1) {
		return ""
	}
	return windows.UTF16ToString(buf)
}

func OpenLog(report *Report) {
	if report == nil {
		return
	}
	if err := windows.ShellExecute(0, ptr("open"), ptr(report.Path()), nil, nil, 1); err != nil {
		Message("Não foi possível abrir o log automaticamente. Arquivo: " + report.Path())
	}
}

func runDiagnostics(ctx context.Context, report *Report) bool {
	failed := false
	check := func(operation string, probe func(context.Context) error) {
		report.Record(0, operation, "START", nil)
		bounded, cancel := context.WithTimeout(ctx, 6*time.Second)
		defer cancel()
		if err := probe(bounded); err != nil {
			failed = true
			report.Record(0, operation, "ERROR", err)
		} else {
			report.Record(0, operation, "OK", nil)
		}
	}
	check("DIAGNOSTIC_API_HTTPS", func(c context.Context) error {
		req, err := http.NewRequestWithContext(c, http.MethodGet, APIURL+"/health", nil)
		if err != nil {
			return err
		}
		response, err := preparationHTTPClient().Do(req)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 256))
		if err != nil {
			return err
		}
		if response.StatusCode != 200 || string(data) != "{\"status\":\"ok\"}" {
			return errors.New("health check failed")
		}
		return nil
	})
	for i, address := range []string{IDServer, RelayServer} {
		check(fmt.Sprintf("DIAGNOSTIC_TCP_%d", i+1), func(c context.Context) error {
			dialer := net.Dialer{}
			conn, err := dialer.DialContext(c, "tcp", address)
			if err != nil {
				return err
			}
			return conn.Close()
		})
	}
	report.Record(0, "DIAGNOSTIC_RUSTDESK_INSTALLED", "START", nil)
	if _, err := findInstalledRustDesk(); err != nil {
		report.Record(0, "DIAGNOSTIC_RUSTDESK_WILL_INSTALL", "OK", nil)
	} else {
		report.Record(0, "DIAGNOSTIC_RUSTDESK_INSTALLED", "OK", nil)
	}
	return failed
}
