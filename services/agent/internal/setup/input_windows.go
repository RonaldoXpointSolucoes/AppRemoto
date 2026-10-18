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

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
	"golang.org/x/sys/windows"
)

var ErrInputCancelled = errors.New("installation cancelled before changes")

const (
	wmAppDiagDone    = 0x8001
	wmAppContextDone = 0x8002
	wmAppReserveDone = 0x8003

	wmPaint           = 0x000F
	wmEraseBkgnd      = 0x0014
	wmDrawItem        = 0x002B
	wmCtlColorEdit    = 0x0133
	wmCtlColorListBox = 0x0134
	wmCtlColorBtn     = 0x0135
	wmCtlColorStatic  = 0x0138

	cbAddString       = 0x0143
	cbResetContent    = 0x014B
	cbGetCurSel       = 0x0147
	cbSetCurSel       = 0x014E
	cbSetDroppedWidth = 0x0160
	cbnSelChange      = 1

	lbAddString          = 0x0180
	lbResetContent       = 0x0184
	lbSetHorizontalExent = 0x0194

	bmGetCheck  = 0x00F0
	bmSetCheck  = 0x00F1
	bstChecked  = 1
	enChange    = 0x0300
	emLimitText = 0x00C5

	bsOwnerDraw = 0x0000000B
	odsSelected = 0x0001
	odsDisabled = 0x0004

	dtCenter     = 0x0001
	dtVCenter    = 0x0004
	dtSingleLine = 0x0020
)

type winRect struct {
	Left, Top, Right, Bottom int32
}

type paintStruct struct {
	Hdc         uintptr
	Erase       int32
	RcPaint     winRect
	Restore     int32
	IncUpdate   int32
	RgbReserved [32]byte
}

type drawItemStruct struct {
	CtlType    uint32
	CtlID      uint32
	ItemID     uint32
	ItemAction uint32
	ItemState  uint32
	HwndItem   uintptr
	Hdc        uintptr
	RcItem     winRect
	ItemData   uintptr
}

type operationChoice struct {
	Mode             string
	Label            string
	ReplacesDeviceID string
	PresetRole       string
	PresetName       string
}

func rgb(r, g, b byte) uintptr {
	return uintptr(uint32(r) | (uint32(g) << 8) | (uint32(b) << 16))
}

func enableModernWindowFrame(hwnd uintptr) {
	dwm := windows.NewLazySystemDLL("dwmapi.dll")
	setAttr := dwm.NewProc("DwmSetWindowAttribute")
	if setAttr.Find() != nil {
		return
	}
	// DWMWA_WINDOW_CORNER_PREFERENCE (33) = DWMWCP_ROUND (2)
	cornerPref := uint32(2)
	setAttr.Call(hwnd, 33, uintptr(unsafe.Pointer(&cornerPref)), 4)
}

func formatDataDivasLines(dd *api.DataDivasInfo, currentHost string) (string, string) {
	hostText := currentHost
	if hostText == "" {
		hostText = "Não identificado"
	}
	if dd == nil {
		return "Arquivo C:\\DataDivas\\config.ini não localizado neste computador — preenchimento assistido habilitado.",
			fmt.Sprintf("Hostname atual no Windows: %s  •  Segurança: Criptografia TLS ativa e pacote verificado XPoint Soluções", hostText)
	}
	empresa := dd.NomeFantasia
	if empresa == "" {
		empresa = dd.RazaoSocial
	}
	if empresa == "" {
		empresa = "Não informado"
	}
	doc := dd.CNPJ
	if d := NormalizeCnpjDigits(doc); len(d) == 14 {
		doc = FormatCnpj(d)
	} else if doc == "" {
		doc = "Não informado"
	}
	serial := dd.Serial
	if serial == "" {
		serial = "—"
	}
	ipLocal := dd.IPMaq
	if ipLocal == "" {
		ipLocal = "Automático"
	}
	ipServer := dd.IPDataDivas
	if ipServer == "" {
		ipServer = "Local"
	}
	line1 := fmt.Sprintf("Empresa: %s   •   CNPJ/Doc: %s   •   Serial: %s", empresa, doc, serial)
	line2 := fmt.Sprintf("Host Windows Atual: %s   •   IP Máquina: %s   •   Servidor DataDivas: %s", hostText, ipLocal, ipServer)
	return line1, line2
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

	if dpiProc := user.NewProc("SetProcessDPIAware"); dpiProc.Find() == nil {
		dpiProc.Call()
	}

	create := user.NewProc("CreateWindowExW")
	def := user.NewProc("DefWindowProcW")
	send := user.NewProc("SendMessageW")
	invalidate := user.NewProc("InvalidateRect")

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

	// Paleta de Cores SaaS Enterprise (RGB)
	colCanvasBg := rgb(241, 245, 249)     // #F1F5F9 Slate 100
	colHeaderBg := rgb(15, 23, 42)        // #0F172A Slate 900
	colAccentCyan := rgb(6, 182, 212)     // #06B6D4 Cyan 500
	colBadgeBg := rgb(6, 78, 59)          // #064E3B Emerald 900
	colBadgeBorder := rgb(16, 185, 129)   // #10B981 Emerald 500
	colDdCardBg := rgb(240, 249, 255)     // #F0F9FF Sky 50
	colDdBorder := rgb(186, 230, 253)     // #BAE6FD Sky 200
	colCardBg := rgb(255, 255, 255)       // #FFFFFF Pure White
	colCardBorder := rgb(203, 213, 225)   // #CBD5E1 Slate 300
	colCalloutBg := rgb(236, 253, 245)    // #ECFDF5 Emerald 50
	colCalloutBorder := rgb(167, 243, 208) // #A7F3D0 Emerald 200
	colStatusBg := rgb(248, 250, 252)     // #F8FAFC Slate 50

	createSolidBrush := gdi.NewProc("CreateSolidBrush")
	deleteObject := gdi.NewProc("DeleteObject")

	brushCanvas, _, _ := createSolidBrush.Call(colCanvasBg)
	brushHeader, _, _ := createSolidBrush.Call(colHeaderBg)
	brushAccent, _, _ := createSolidBrush.Call(colAccentCyan)
	brushBadge, _, _ := createSolidBrush.Call(colBadgeBg)
	brushDdCard, _, _ := createSolidBrush.Call(colDdCardBg)
	brushCard, _, _ := createSolidBrush.Call(colCardBg)
	brushCallout, _, _ := createSolidBrush.Call(colCalloutBg)
	brushStatus, _, _ := createSolidBrush.Call(colStatusBg)

	for _, b := range []uintptr{brushCanvas, brushHeader, brushAccent, brushBadge, brushDdCard, brushCard, brushCallout, brushStatus} {
		if b != 0 {
			defer deleteObject.Call(b)
		}
	}

	var (
		headerTitleCtrl, headerSubCtrl                uintptr
		badgeTitleCtrl, badgeSubCtrl                  uintptr
		ddTitleCtrl, ddLine1Ctrl, ddLine2Ctrl         uintptr
		sec1TitleCtrl, sec2TitleCtrl                  uintptr
		cnpjEdit, companyEdit, groupSummaryLabel      uintptr
		computersList                                 uintptr
		operationCombo, roleCombo, machineEdit        uintptr
		reasonTitleCtrl, reasonLabel                  uintptr
		renameCheckbox, renameHintCtrl                uintptr
		statusLabel, footerCtrl                       uintptr
		queryCnpjBtn, checkBtn, logBtn                uintptr
		installBtn, cancelBtn                         uintptr
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
		invalidate.Call(ctrl, 0, 1)
	}

	populateOperationCombo := func(ctxResp *InstallationContextResponse) {
		updatingControls.Store(true)
		defer updatingControls.Store(false)
		send.Call(operationCombo, cbResetContent, 0, 0)
		operationChoices = []operationChoice{
			{Mode: "NEW_INSTALL", Label: "Nova instalação neste CNPJ (sugerir próximo disponível)"},
		}
		selectedIndex := 0
		if ctxResp != nil && ctxResp.ExistingDevice != nil {
			ex := ctxResp.ExistingDevice
			operationChoices = append(operationChoices, operationChoice{
				Mode:       "REINSTALL_SAME_DEVICE",
				Label:      fmt.Sprintf("Reinstalação nesta máquina — manter %s (%s)", ex.NomeNormalizado, ex.FuncaoLabel),
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
		send.Call(operationCombo, cbSetDroppedWidth, 620, 0)
		send.Call(operationCombo, cbSetCurSel, uintptr(selectedIndex), 0)
	}

	populateComputersList := func(ctxResp *InstallationContextResponse, offline bool) {
		send.Call(computersList, lbResetContent, 0, 0)
		if offline {
			line := "  ⚡ Modo Contingência Local: sem resposta prévia do servidor. Sugestão local segura ativa."
			send.Call(computersList, lbAddString, 0, uintptr(unsafe.Pointer(ptr(line))))
			send.Call(computersList, lbSetHorizontalExent, 780, 0)
			return
		}
		if ctxResp == nil || len(ctxResp.Computers) == 0 {
			line := "  ✓ Nenhum computador registrado anteriormente neste CNPJ — este será o 1º equipamento do grupo empresarial."
			send.Call(computersList, lbAddString, 0, uintptr(unsafe.Pointer(ptr(line))))
			send.Call(computersList, lbSetHorizontalExent, 780, 0)
			return
		}
		for _, c := range ctxResp.Computers {
			sit := "● OFFLINE"
			switch c.Situacao {
			case "online":
				sit = "● ONLINE "
			case "substituido":
				sit = "○ SUBSTIT."
			case "pendente":
				sit = "◐ PENDENTE"
			}
			winInfo := c.WindowsHostnameAtual
			if c.StatusRenomeacao == "APLICADO_AGUARDANDO_REBOOT" {
				winInfo += " (aguardando reinício)"
			}
			line := fmt.Sprintf("  %-15s │ %-18s │ %-11s │ Host Windows: %s", c.NomeNormalizado, c.FuncaoLabel, sit, winInfo)
			send.Call(computersList, lbAddString, 0, uintptr(unsafe.Pointer(ptr(line))))
		}
		send.Call(computersList, lbSetHorizontalExent, 860, 0)
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
				setText(reasonLabel, fmt.Sprintf("Reinstalação reconhecida nesta máquina: mantendo o nome %s sem duplicar o cadastro no CNPJ.", op.PresetName))
			} else {
				setText(reasonLabel, fmt.Sprintf("Substituição autorizada: este computador assumirá %s e o equipamento antigo será marcado como substituído.", op.PresetName))
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
			if len(cnpjDigits) == 11 {
				setText(groupSummaryLabel, "ℹ️ Documento de 11 dígitos (CPF/Demo) detectado. Para agrupar computadores por CNPJ, digite os 14 dígitos e clique em Consultar CNPJ.")
			} else {
				setText(groupSummaryLabel, "ℹ️ Informe um CNPJ válido de 14 dígitos e clique em Consultar CNPJ para sincronizar os computadores da empresa.")
			}
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
		setText(statusLabel, "🔄 Consultando grupo empresarial e computadores do CNPJ "+FormatCnpj(cnpjDigits)+" no servidor XPoint…")

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

	var boldBtnFont, bodyFont uintptr

	drawCard := func(hdc uintptr, left, top, right, bottom int32, fillBrush, borderColor, topStripeBrush uintptr) {
		fillRect := user.NewProc("FillRect")
		createPen := gdi.NewProc("CreatePen")
		selectObj := gdi.NewProc("SelectObject")
		roundRect := gdi.NewProc("RoundRect")

		pen, _, _ := createPen.Call(0, 1, borderColor)
		oldPen, _, _ := selectObj.Call(hdc, pen)
		oldBrush, _, _ := selectObj.Call(hdc, fillBrush)
		roundRect.Call(hdc, uintptr(left), uintptr(top), uintptr(right), uintptr(bottom), 12, 12)
		selectObj.Call(hdc, oldBrush)
		selectObj.Call(hdc, oldPen)
		deleteObject.Call(pen)

		if topStripeBrush != 0 {
			stripe := winRect{Left: left + 1, Top: top + 6, Right: left + 5, Bottom: bottom - 6}
			fillRect.Call(hdc, uintptr(unsafe.Pointer(&stripe)), topStripeBrush)
		}
	}

	drawOwnerButton := func(dis *drawItemStruct) {
		fillRect := user.NewProc("FillRect")
		createPen := gdi.NewProc("CreatePen")
		selectObj := gdi.NewProc("SelectObject")
		roundRect := gdi.NewProc("RoundRect")
		setBkMode := gdi.NewProc("SetBkMode")
		setTextColor := gdi.NewProc("SetTextColor")
		drawTextW := user.NewProc("DrawTextW")

		// Limpa o fundo com o canvas/card
		bgBase := brushCanvas
		if dis.CtlID == 5 {
			bgBase = brushCard
		}
		fillRect.Call(dis.Hdc, uintptr(unsafe.Pointer(&dis.RcItem)), bgBase)

		isPressed := (dis.ItemState & odsSelected) != 0
		isDisabled := (dis.ItemState & odsDisabled) != 0

		var btnBgColor, btnBorderColor, txtColor uintptr
		useBold := false

		switch dis.CtlID {
		case 1: // Botão Primário: Instalar Acesso Seguro
			useBold = true
			if isDisabled {
				btnBgColor = rgb(148, 163, 184)
				btnBorderColor = rgb(148, 163, 184)
				txtColor = rgb(241, 245, 249)
			} else if isPressed {
				btnBgColor = rgb(4, 120, 87) // Emerald 700
				btnBorderColor = rgb(6, 95, 70)
				txtColor = rgb(255, 255, 255)
			} else {
				btnBgColor = rgb(5, 150, 105) // Emerald 600
				btnBorderColor = rgb(4, 120, 87)
				txtColor = rgb(255, 255, 255)
			}
		case 5: // Botão Consultar CNPJ
			useBold = true
			if isDisabled {
				btnBgColor = rgb(226, 232, 240)
				btnBorderColor = rgb(203, 213, 225)
				txtColor = rgb(148, 163, 184)
			} else if isPressed {
				btnBgColor = rgb(3, 105, 161) // Sky 700
				btnBorderColor = rgb(7, 89, 133)
				txtColor = rgb(255, 255, 255)
			} else {
				btnBgColor = rgb(2, 132, 199) // Sky 600
				btnBorderColor = rgb(3, 105, 161)
				txtColor = rgb(255, 255, 255)
			}
		default: // Botões Secundários (Verificar Conexão, Abrir Log, Cancelar)
			if isDisabled {
				btnBgColor = rgb(241, 245, 249)
				btnBorderColor = rgb(203, 213, 225)
				txtColor = rgb(148, 163, 184)
			} else if isPressed {
				btnBgColor = rgb(226, 232, 240)
				btnBorderColor = rgb(148, 163, 184)
				txtColor = rgb(15, 23, 42)
			} else {
				btnBgColor = rgb(255, 255, 255)
				btnBorderColor = rgb(148, 163, 184)
				txtColor = rgb(30, 41, 59)
			}
		}

		btnBrush, _, _ := createSolidBrush.Call(btnBgColor)
		btnPen, _, _ := createPen.Call(0, 1, btnBorderColor)
		oldBrush, _, _ := selectObj.Call(dis.Hdc, btnBrush)
		oldPen, _, _ := selectObj.Call(dis.Hdc, btnPen)

		roundRect.Call(
			dis.Hdc,
			uintptr(dis.RcItem.Left),
			uintptr(dis.RcItem.Top),
			uintptr(dis.RcItem.Right),
			uintptr(dis.RcItem.Bottom),
			10,
			10,
		)

		selectObj.Call(dis.Hdc, oldBrush)
		selectObj.Call(dis.Hdc, oldPen)
		deleteObject.Call(btnBrush)
		deleteObject.Call(btnPen)

		fontToUse := bodyFont
		if useBold && boldBtnFont != 0 {
			fontToUse = boldBtnFont
		}
		var oldFont uintptr
		if fontToUse != 0 {
			oldFont, _, _ = selectObj.Call(dis.Hdc, fontToUse)
		}

		setBkMode.Call(dis.Hdc, 1) // TRANSPARENT
		setTextColor.Call(dis.Hdc, txtColor)
		text := readControlText(user, dis.HwndItem)
		rc := dis.RcItem
		drawTextW.Call(
			dis.Hdc,
			uintptr(unsafe.Pointer(ptr(text))),
			uintptr(^uint(0)), // -1 null-terminated
			uintptr(unsafe.Pointer(&rc)),
			dtCenter|dtVCenter|dtSingleLine,
		)
		if oldFont != 0 {
			selectObj.Call(dis.Hdc, oldFont)
		}
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
		case wmEraseBkgnd:
			var rc winRect
			user.NewProc("GetClientRect").Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			user.NewProc("FillRect").Call(wparam, uintptr(unsafe.Pointer(&rc)), brushCanvas)
			return 1
		case wmPaint:
			var ps paintStruct
			hdc, _, _ := user.NewProc("BeginPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
			if hdc != 0 {
				var rc winRect
				user.NewProc("GetClientRect").Call(hwnd, uintptr(unsafe.Pointer(&rc)))
				user.NewProc("FillRect").Call(hdc, uintptr(unsafe.Pointer(&rc)), brushCanvas)

				// 1. Top Enterprise Dark Header Banner (0..72)
				headerRect := winRect{Left: 0, Top: 0, Right: rc.Right, Bottom: 72}
				user.NewProc("FillRect").Call(hdc, uintptr(unsafe.Pointer(&headerRect)), brushHeader)
				accentRect := winRect{Left: 0, Top: 0, Right: rc.Right, Bottom: 4}
				user.NewProc("FillRect").Call(hdc, uintptr(unsafe.Pointer(&accentRect)), brushAccent)

				// Security Badge Pill inside Header (Right side)
				drawCard(hdc, 578, 12, 860, 60, brushBadge, colBadgeBorder, 0)

				// 2. Card 1: Dados Detectados Localmente (DataDivas & Hostname)
				drawCard(hdc, 20, 82, 860, 148, brushDdCard, colDdBorder, brushAccent)

				// 3. Card 2: Identificação Empresarial & Computadores do CNPJ
				drawCard(hdc, 20, 156, 860, 356, brushCard, colCardBorder, 0)

				// 4. Card 3: Classificação Inteligente & Renomeação Segura do Windows
				drawCard(hdc, 20, 364, 860, 568, brushCard, colCardBorder, 0)

				// Callout box de recomendação dentro do Card 3
				drawCard(hdc, 310, 448, 844, 504, brushCallout, colCalloutBorder, 0)

				// 5. Card 4: Barra de Status Operacional
				drawCard(hdc, 20, 576, 860, 606, brushStatus, colCardBorder, 0)

				user.NewProc("EndPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
			}
			return 0
		case wmDrawItem:
			if lparam != 0 {
				dis := (*drawItemStruct)(unsafe.Pointer(lparam))
				if dis.CtlType == 4 { // ODT_BUTTON
					drawOwnerButton(dis)
					return 1
				}
			}
		case wmCtlColorStatic, wmCtlColorBtn:
			setBkMode := gdi.NewProc("SetBkMode")
			setBkColor := gdi.NewProc("SetBkColor")
			setTextColor := gdi.NewProc("SetTextColor")
			setBkMode.Call(wparam, 2) // OPAQUE com cor idêntica ao card

			switch lparam {
			case headerTitleCtrl:
				setTextColor.Call(wparam, rgb(255, 255, 255))
				setBkColor.Call(wparam, colHeaderBg)
				return brushHeader
			case headerSubCtrl:
				setTextColor.Call(wparam, rgb(148, 163, 184))
				setBkColor.Call(wparam, colHeaderBg)
				return brushHeader
			case badgeTitleCtrl:
				setTextColor.Call(wparam, rgb(110, 231, 183))
				setBkColor.Call(wparam, colBadgeBg)
				return brushBadge
			case badgeSubCtrl:
				setTextColor.Call(wparam, rgb(209, 250, 229))
				setBkColor.Call(wparam, colBadgeBg)
				return brushBadge
			case ddTitleCtrl:
				setTextColor.Call(wparam, rgb(3, 105, 161))
				setBkColor.Call(wparam, colDdCardBg)
				return brushDdCard
			case ddLine1Ctrl, ddLine2Ctrl:
				setTextColor.Call(wparam, rgb(15, 23, 42))
				setBkColor.Call(wparam, colDdCardBg)
				return brushDdCard
			case reasonTitleCtrl:
				setTextColor.Call(wparam, rgb(6, 95, 70))
				setBkColor.Call(wparam, colCalloutBg)
				return brushCallout
			case reasonLabel:
				setTextColor.Call(wparam, rgb(4, 120, 87))
				setBkColor.Call(wparam, colCalloutBg)
				return brushCallout
			case statusLabel:
				setTextColor.Call(wparam, rgb(15, 23, 42))
				setBkColor.Call(wparam, colStatusBg)
				return brushStatus
			case footerCtrl:
				setTextColor.Call(wparam, rgb(100, 116, 139))
				setBkColor.Call(wparam, colCanvasBg)
				return brushCanvas
			case sec1TitleCtrl, sec2TitleCtrl:
				setTextColor.Call(wparam, rgb(15, 23, 42))
				setBkColor.Call(wparam, colCardBg)
				return brushCard
			case groupSummaryLabel, renameHintCtrl:
				setTextColor.Call(wparam, rgb(71, 85, 105))
				setBkColor.Call(wparam, colCardBg)
				return brushCard
			default:
				setTextColor.Call(wparam, rgb(30, 41, 59))
				setBkColor.Call(wparam, colCardBg)
				return brushCard
			}
		case wmCtlColorEdit, wmCtlColorListBox:
			gdi.NewProc("SetTextColor").Call(wparam, rgb(15, 23, 42))
			gdi.NewProc("SetBkColor").Call(wparam, colCardBg)
			return brushCard
		case wmAppDiagDone:
			busy.Store(false)
			user.NewProc("EnableWindow").Call(installBtn, 1)
			user.NewProc("EnableWindow").Call(checkBtn, 1)
			user.NewProc("EnableWindow").Call(queryCnpjBtn, 1)
			text := "✅ Verificação concluída: comunicação HTTPS e servidores RustDesk confirmados."
			if wparam != 0 {
				text = "⚠️ A verificação encontrou uma pendência de rede. Clique em 'Abrir Log' para detalhes."
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
				setText(groupSummaryLabel, "⚡ Modo Contingência Local: servidor não respondeu à consulta prévia. Sugestão local segura ativa.")
				populateComputersList(nil, true)
				populateOperationCombo(nil)
				recomputeSuggestion(true)
				setText(statusLabel, "ℹ️ Contingência ativa: você pode prosseguir com a instalação normalmente.")
				return 0
			}
			if cleanInput(readControlText(user, companyEdit)) == "" && ctxResp.Group.RazaoSocial != "" {
				setText(companyEdit, ctxResp.Group.RazaoSocial)
			}
			opDesc := "Nova instalação"
			if ctxResp.DetectedOperation == "REINSTALL_SAME_DEVICE" && ctxResp.ExistingDevice != nil {
				opDesc = "Reinstalação reconhecida (" + ctxResp.ExistingDevice.NomeNormalizado + ")"
			}
			setText(groupSummaryLabel, fmt.Sprintf(
				"✓ Grupo CNPJ %s sincronizado • %d computador(es) no grupo (%d online, %d offline) • %s",
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
			setText(statusLabel, "✅ Grupo empresarial sincronizado. Revise a função/nome abaixo e clique em 'Instalar Acesso Seguro'.")
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
				Message("O nome selecionado acabou de ser ocupado ou já está em uso neste CNPJ.\n\n" + errMsg + "\n\nAtualizamos automaticamente o campo com o próximo nome disponível.")
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
				setText(statusLabel, "ℹ️ Reserva cancelada pelo operador. Revise a função ou a conexão antes de continuar.")
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
						setText(reasonLabel, "⚠️ Atenção: "+msg)
					} else if ok {
						roleCode := currentRoleCode()
						if roleCode == "PERSONALIZADO" {
							recomputeSuggestion(false)
						} else {
							setText(reasonLabel, fmt.Sprintf("✓ Nome Windows validado: %s (%d/%d caracteres permitidos).", norm, len(norm), MaxWindowsHostnameLength))
						}
					}
				}
				return 0
			case 5: // Consultar CNPJ button
				triggerContextFetch(hwnd)
				return 0
			case 1: // Instalar Acesso Seguro button
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

				busy.Store(true)
				user.NewProc("EnableWindow").Call(installBtn, 0)
				user.NewProc("EnableWindow").Call(queryCnpjBtn, 0)
				user.NewProc("EnableWindow").Call(checkBtn, 0)
				setText(statusLabel, fmt.Sprintf("🔒 Reservando nome %s com trava de unicidade no CNPJ %s…", normName, FormatCnpj(rawCnpj)))

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
				setText(statusLabel, "🔄 Verificando conectividade segura HTTPS e servidores de relay…")
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
	wc := windowClass{
		Size:       uint32(unsafe.Sizeof(windowClass{})),
		Procedure:  procedure,
		Instance:   instance,
		Icon:       icon,
		SmallIcon:  icon,
		Background: brushCanvas,
		Name:       name,
	}
	atom, _, _ := user.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&wc)))
	if atom == 0 {
		return nil, errors.New("input window unavailable")
	}
	defer user.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(name)), instance)

	// Garante área útil interna (client area) de exatamente 880x676, cabendo também em telas PDV 1366x768 sem cortar rodapé
	style := uint32(0x10C80000) // WS_VISIBLE | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX
	desiredClient := winRect{Left: 0, Top: 0, Right: 880, Bottom: 676}
	user.NewProc("AdjustWindowRectEx").Call(uintptr(unsafe.Pointer(&desiredClient)), uintptr(style), 0, 0)
	winW := int(desiredClient.Right - desiredClient.Left)
	winH := int(desiredClient.Bottom - desiredClient.Top)

	var workArea winRect
	spiOk, _, _ := user.NewProc("SystemParametersInfoW").Call(0x0030, 0, uintptr(unsafe.Pointer(&workArea)), 0)
	var posX, posY int
	if spiOk != 0 && workArea.Right > workArea.Left && workArea.Bottom > workArea.Top {
		posX = int(workArea.Left) + (int(workArea.Right-workArea.Left)-winW)/2
		posY = int(workArea.Top) + (int(workArea.Bottom-workArea.Top)-winH)/2
	} else {
		screenX, _, _ := user.NewProc("GetSystemMetrics").Call(0)
		screenY, _, _ := user.NewProc("GetSystemMetrics").Call(1)
		posX = (int(screenX) - winW) / 2
		posY = (int(screenY) - winH) / 2
	}
	if posX < 0 {
		posX = 0
	}
	if posY < 0 {
		posY = 0
	}

	hwnd, _, _ := create.Call(
		0,
		uintptr(unsafe.Pointer(name)),
		uintptr(unsafe.Pointer(ptr("XPoint Remote — Instalação Segura & Gestão Inteligente por CNPJ (v"+Version+")"))),
		uintptr(style),
		uintptr(posX),
		uintptr(posY),
		uintptr(winW),
		uintptr(winH),
		0,
		0,
		instance,
		0,
	)
	if hwnd == 0 {
		return nil, errors.New("input window unavailable")
	}
	enableModernWindowFrame(hwnd)
	if icon != 0 {
		send.Call(hwnd, 0x80, 1, icon)
		send.Call(hwnd, 0x80, 0, icon)
	}

	headerFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-19)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	secTitleFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-14)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	machineFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-18)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Consolas"))))
	labelFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-13)), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	bodyFont, _, _ = gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-13)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	boldBtnFont, _, _ = gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-13)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	monoFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Consolas"))))
	smallBoldFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-11)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	smallFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))

	for _, f := range []uintptr{headerFont, secTitleFont, machineFont, labelFont, bodyFont, boldBtnFont, monoFont, smallBoldFont, smallFont} {
		if f != 0 {
			defer deleteObject.Call(f)
		}
	}

	controlWithFont := func(class, text string, x, y, w, h int, id uintptr, extra uint32, f uintptr) uintptr {
		value, _, _ := create.Call(
			0,
			uintptr(unsafe.Pointer(ptr(class))),
			uintptr(unsafe.Pointer(ptr(text))),
			uintptr(0x50000000|extra),
			uintptr(x),
			uintptr(y),
			uintptr(w),
			uintptr(h),
			hwnd,
			id,
			instance,
			0,
		)
		if f != 0 {
			send.Call(value, 0x30, f, 1)
		}
		return value
	}

	// =========================================================================
	// 1. BANNER SUPERIOR ENTERPRISE (y: 0..72)
	// =========================================================================
	headerTitleCtrl = controlWithFont("STATIC", "XPoint Remote — Identificação & Acesso Seguro", 24, 13, 540, 24, 0, 0, headerFont)
	headerSubCtrl = controlWithFont("STATIC", "Organização inteligente por CNPJ, nomenclatura padronizada e proteção do equipamento", 24, 41, 540, 18, 0, 0, smallFont)

	badgeTitleCtrl = controlWithFont("STATIC", "🛡️ INSTALAÇÃO VERIFICADA & CRIPTOGRAFADA", 590, 18, 258, 16, 0, 0, smallBoldFont)
	badgeSubCtrl = controlWithFont("STATIC", "Conexão TLS 1.3 • Pacote Oficial XPoint", 590, 36, 258, 16, 0, 0, smallFont)

	// =========================================================================
	// 2. CARD 1: DADOS DETECTADOS LOCALMENTE (y: 82..148)
	// =========================================================================
	ddLine1, ddLine2 := formatDataDivasLines(dataDivas, currentHost)
	ddTitleCtrl = controlWithFont("STATIC", "DADOS DETECTADOS AUTOMATICAMENTE NESTE COMPUTADOR (C:\\DataDivas\\config.ini)", 36, 88, 808, 16, 0, 0, smallBoldFont)
	ddLine1Ctrl = controlWithFont("STATIC", ddLine1, 36, 106, 808, 18, 0, 0, bodyFont)
	ddLine2Ctrl = controlWithFont("STATIC", ddLine2, 36, 125, 808, 16, 0, 0, smallFont)

	// =========================================================================
	// 3. CARD 2: GRUPO EMPRESARIAL POR CNPJ & COMPUTADORES (y: 156..356)
	// =========================================================================
	sec1TitleCtrl = controlWithFont("STATIC", "1. Identificação Empresarial & Grupo do CNPJ", 36, 164, 808, 20, 0, 0, secTitleFont)

	controlWithFont("STATIC", "CNPJ da Empresa (14 dígitos):", 36, 188, 210, 16, 0, 0, labelFont)
	cnpjDisplay := initialCnpj
	if len(initialCnpj) == 14 {
		cnpjDisplay = FormatCnpj(initialCnpj)
	}
	cnpjEdit = controlWithFont("EDIT", cnpjDisplay, 36, 206, 200, 25, 12, 0x00810080, bodyFont)
	queryCnpjBtn = controlWithFont("BUTTON", "Consultar CNPJ", 244, 205, 136, 27, 5, 0x00010000|bsOwnerDraw, boldBtnFont)

	controlWithFont("STATIC", "Razão Social / Nome da Empresa:", 396, 188, 448, 16, 0, 0, labelFont)
	companyEdit = controlWithFont("EDIT", initialCompany, 396, 206, 448, 25, 13, 0x00810080, bodyFont)

	initialGroupMsg := "ℹ️ Informe um CNPJ de 14 dígitos e clique em Consultar CNPJ para listar os computadores da empresa."
	if len(initialCnpj) == 11 {
		initialGroupMsg = "ℹ️ Documento de 11 dígitos (CPF/Demo) lido do config.ini. Para agrupar por CNPJ, informe 14 dígitos ou prossiga com sugestão local."
	} else if len(initialCnpj) == 14 {
		initialGroupMsg = "🔄 Sincronizando computadores registrados neste CNPJ…"
	}
	groupSummaryLabel = controlWithFont("STATIC", initialGroupMsg, 36, 236, 808, 18, 0, 0, smallFont)

	controlWithFont("STATIC", "Computadores já registrados neste CNPJ (Nome Padronizado  │  Função  │  Status  │  Host Windows):", 36, 256, 808, 16, 0, 0, labelFont)
	computersList = controlWithFont("LISTBOX", "", 36, 274, 808, 74, 16, 0x00B00001, monoFont)

	// =========================================================================
	// 4. CARD 3: CLASSIFICAÇÃO INTELIGENTE & RENOMEAÇÃO SEGURA (y: 364..568)
	// =========================================================================
	sec2TitleCtrl = controlWithFont("STATIC", "2. Classificação da Máquina, Nomenclatura Padronizada & Windows", 36, 372, 808, 20, 0, 0, secTitleFont)

	controlWithFont("STATIC", "Operação nesta instalação:", 36, 396, 420, 16, 0, 0, labelFont)
	operationCombo = controlWithFont("COMBOBOX", "", 36, 414, 420, 240, 14, 0x00210003, bodyFont)

	controlWithFont("STATIC", "Função padronizada do computador:", 472, 396, 372, 16, 0, 0, labelFont)
	roleCombo = controlWithFont("COMBOBOX", "", 472, 414, 372, 260, 15, 0x00210003, bodyFont)
	for _, item := range DefaultRoleCatalog {
		label := fmt.Sprintf("%s  —  ex.: %s", item.Label, item.ExampleDefault)
		send.Call(roleCombo, cbAddString, 0, uintptr(unsafe.Pointer(ptr(label))))
	}
	send.Call(roleCombo, cbSetDroppedWidth, 420, 0)

	controlWithFont("STATIC", "Nome padronizado (máx. 15 caracteres):", 36, 448, 262, 16, 0, 0, labelFont)
	initialRole := InferRoleFromName(initialLocalMaq)
	if initialLocalMaq == "" {
		initialRole = InferRoleFromName(currentHost)
	}
	if initialRole == "PERSONALIZADO" {
		initialRole = "CAIXA"
	}
	selectRoleCode(initialRole)
	initialSug := LocalSuggestNameForRole(initialRole, nil, "", "")
	machineEdit = controlWithFont("EDIT", initialSug.SuggestedName, 36, 468, 262, 32, 11, 0x00810080, machineFont)
	send.Call(machineEdit, emLimitText, MaxWindowsHostnameLength, 0)

	// Callout de Recomendação Inteligente (x: 310..844, y: 448..504)
	reasonTitleCtrl = controlWithFont("STATIC", "✨ SUGESTÃO INTELIGENTE DO SISTEMA", 322, 453, 510, 16, 0, 0, smallBoldFont)
	reasonLabel = controlWithFont("STATIC", initialSug.Reason, 322, 470, 510, 30, 0, 0, smallFont)

	renameLabel := fmt.Sprintf("Alterar também o nome real deste computador no Windows para o nome padronizado (atual: %s)", currentHost)
	renameCheckbox = controlWithFont("BUTTON", renameLabel, 36, 512, 808, 20, 17, 0x00010003, labelFont)
	send.Call(renameCheckbox, bmSetCheck, bstChecked, 0)

	renameHintCtrl = controlWithFont(
		"STATIC",
		"🔒 Garantia de continuidade: O computador NÃO será reiniciado automaticamente. Ao final da instalação, você poderá escolher se deseja reiniciar agora ou depois.",
		36,
		534,
		808,
		26,
		0,
		0,
		smallFont,
	)

	// =========================================================================
	// 5. CARD 4: STATUS & BOTÕES DE AÇÃO (y: 576..672)
	// =========================================================================
	statusLabel = controlWithFont("STATIC", "✅ Status: Pronto para instalar com segurança.", 32, 582, 816, 18, 0, 0, bodyFont)

	checkBtn = controlWithFont("BUTTON", "Verificar Conexão", 20, 614, 160, 38, 3, 0x00010000|bsOwnerDraw, bodyFont)
	logBtn = controlWithFont("BUTTON", "Abrir Log", 190, 614, 120, 38, 4, 0x00010000|bsOwnerDraw, bodyFont)
	_ = logBtn
	cancelBtn = controlWithFont("BUTTON", "Cancelar", 528, 614, 124, 38, 2, 0x00010000|bsOwnerDraw, bodyFont)
	_ = cancelBtn
	installBtn = controlWithFont("BUTTON", "✓ Instalar Acesso Seguro", 664, 614, 196, 38, 1, 0x00010001|bsOwnerDraw, boldBtnFont)

	footerCtrl = controlWithFont(
		"STATIC",
		"RustDesk 1.4.9  •  Criptografia Ponta a Ponta  •  XPoint Remote v"+Version+"  •  XPoint Soluções Tecnológicas",
		20,
		656,
		840,
		16,
		0,
		0,
		smallFont,
	)

	populateOperationCombo(nil)
	populateComputersList(nil, false)
	user.NewProc("SetFocus").Call(machineEdit)
	user.NewProc("UpdateWindow").Call(hwnd)

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
