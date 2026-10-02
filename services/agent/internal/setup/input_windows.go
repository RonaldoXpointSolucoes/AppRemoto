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
	"runtime"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var ErrInputCancelled = errors.New("installation cancelled before changes")

func promptInstallation(report *Report) (*InstallationInput, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	user := windows.NewLazySystemDLL("user32.dll")
	kernel := windows.NewLazySystemDLL("kernel32.dll")
	gdi := windows.NewLazySystemDLL("gdi32.dll")
	create := user.NewProc("CreateWindowExW")
	def := user.NewProc("DefWindowProcW")
	send := user.NewProc("SendMessageW")
	var machine, status, installButton, checkButton uintptr
	var selected *InstallationInput
	var checking atomic.Bool
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	procedure := syscall.NewCallback(func(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
		switch msg {
		case 0x10: // WM_CLOSE, before service creation: ordinary cancellation.
			user.NewProc("DestroyWindow").Call(hwnd)
			return 0
		case 0x2:
			cancel()
			user.NewProc("PostQuitMessage").Call(0)
			return 0
		case 0x8001:
			checking.Store(false)
			user.NewProc("EnableWindow").Call(installButton, 1)
			user.NewProc("EnableWindow").Call(checkButton, 1)
			text := "Verificação concluída. Conexão com os servidores confirmada."
			if wparam != 0 {
				text = "A verificação encontrou uma pendência de rede. Abra o log para ver a etapa."
			}
			user.NewProc("SetWindowTextW").Call(status, uintptr(unsafe.Pointer(ptr(text))))
			return 0
		case 0x111:
			switch uint16(wparam) {
			case 1:
				if checking.Load() {
					return 0
				}
				nameText := cleanInput(readControlText(user, machine))
				if nameText == "" {
					nameText, _ = os.Hostname()
				}
				if nameText == "" {
					nameText = "PC-REMOTO"
				}
				input := InstallationInput{CompanyName: "Remote Platform E2E", DeviceDisplayName: nameText}
				if !input.Valid() {
					Message("Informe o nome do computador, com até 128 caracteres.")
					return 0
				}
				selected = &input
				user.NewProc("DestroyWindow").Call(hwnd)
				return 0
			case 2:
				user.NewProc("DestroyWindow").Call(hwnd)
				return 0
			case 3:
				if checking.Swap(true) {
					return 0
				}
				user.NewProc("EnableWindow").Call(installButton, 0)
				user.NewProc("EnableWindow").Call(checkButton, 0)
				user.NewProc("SetWindowTextW").Call(status, uintptr(unsafe.Pointer(ptr("Verificando conexão com o servidor e componentes locais…"))))
				go func() {
					failed := runDiagnostics(ctx, report)
					if ctx.Err() == nil {
						var result uintptr
						if failed {
							result = 1
						}
						user.NewProc("PostMessageW").Call(hwnd, 0x8001, result, 0)
					}
				}()
				return 0
			case 4:
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
	screenX, _, _ := user.NewProc("GetSystemMetrics").Call(0)
	screenY, _, _ := user.NewProc("GetSystemMetrics").Call(1)
	hwnd, _, _ := create.Call(0, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(ptr("XPoint Remote — Instalação "+Version))), 0x10C80000, (screenX-720)/2, (screenY-540)/2, 720, 540, 0, 0, instance, 0)
	if hwnd == 0 {
		return nil, errors.New("input window unavailable")
	}
	if icon != 0 {
		send.Call(hwnd, 0x80, 1, icon) // WM_SETICON, ICON_BIG
		send.Call(hwnd, 0x80, 0, icon) // WM_SETICON, ICON_SMALL
	}
	titleFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-20)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	labelFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-15)), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	bodyFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-14)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	smallFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
	for _, f := range []uintptr{titleFont, labelFont, bodyFont, smallFont} {
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
	controlWithFont("STATIC", "XPoint Remote — Suporte & Acesso Remoto", 28, 22, 654, 28, 0, 0, titleFont)
	controlWithFont("STATIC", "Configure este computador para permitir atendimento remoto profissional e seguro com 1 clique.", 28, 54, 654, 24, 0, 0, bodyFont)
	controlWithFont("STATIC", "Nome deste computador / dispositivo:", 28, 98, 654, 22, 0, 0, labelFont)
	host, _ := os.Hostname()
	machine = controlWithFont("EDIT", host, 28, 124, 646, 32, 11, 0x00810080, bodyFont)
	controlWithFont("STATIC", "Identificação que será exibida na lista de Dispositivos do painel para conexão remota.", 28, 162, 646, 20, 0, 0, smallFont)
	controlWithFont("STATIC", "Acesso autorizado com senha exclusiva, inicialização automática como serviço do Windows, transferência de arquivos e controle remoto profissional. Reinstalações atualizam o cadastro existente com segurança.", 28, 196, 646, 48, 0, 0, smallFont)
	status = controlWithFont("STATIC", "Status: Pronto para instalar. Você pode testar a conexão com os servidores antes.", 28, 258, 646, 44, 0, 0, bodyFont)
	checkButton = controlWithFont("BUTTON", "Verificar conexão", 28, 390, 168, 38, 3, 0x00010000, bodyFont)
	controlWithFont("BUTTON", "Abrir log", 206, 390, 118, 38, 4, 0x00010000, bodyFont)
	controlWithFont("BUTTON", "Cancelar", 418, 390, 108, 38, 2, 0x00010000, bodyFont)
	installButton = controlWithFont("BUTTON", "Instalar Acesso", 536, 390, 138, 38, 1, 0x00010001, labelFont)
	controlWithFont("STATIC", "RustDesk 1.4.9 • GNU AGPLv3 • XPoint Remote v"+Version+" • XPoint Soluções", 28, 452, 646, 22, 0, 0, smallFont)
	send.Call(machine, 0xC5, 256, 0) // EM_SETLIMITTEXT
	user.NewProc("SetFocus").Call(machine)
	user.NewProc("UpdateWindow").Call(hwnd)
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
	// TCP reachability is a setup diagnostic, never proof of UDP or a remote session.
	return failed
}
