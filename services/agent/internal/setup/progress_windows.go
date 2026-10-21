//go:build windows

package setup

import (
	"errors"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowClass struct {
	Size, Style                        uint32
	Procedure                          uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	Menu, Name                         *uint16
	SmallIcon                          uintptr
}
type windowMessage struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	X, Y           int32
	Private        uint32
}

// ShowProgress keeps a modeless status window responsive during installation.
// Closing only hides progress; installation and its final notification continue.
func ShowProgress(report *Report) (func(), error) {
	ready := make(chan error, 1)
	done := make(chan struct{})
	closed := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(closed)

		user := windows.NewLazySystemDLL("user32.dll")
		kernel := windows.NewLazySystemDLL("kernel32.dll")
		gdi := windows.NewLazySystemDLL("gdi32.dll")

		if dpiProc := user.NewProc("SetProcessDPIAware"); dpiProc.Find() == nil {
			dpiProc.Call()
		}

		def := user.NewProc("DefWindowProcW")
		destroy := user.NewProc("DestroyWindow")
		createSolidBrush := gdi.NewProc("CreateSolidBrush")
		deleteObject := gdi.NewProc("DeleteObject")

		colCanvas := rgb(245, 245, 247)      // #F5F5F7 Apple Window Canvas
		colHeader := rgb(255, 255, 255)      // #FFFFFF Clean Surface Header
		colHeaderBorder := rgb(229, 229, 234) // #E5E5EA Subtle Divider
		colAccent := rgb(0, 113, 227)        // #0071E3 Apple System Blue
		colBadgeBg := rgb(236, 253, 243)     // #ECFDF3 Apple Soft Verified Green
		colBadgeBrd := rgb(166, 244, 197)    // #A6F4C5 Verified Border
		colCard := rgb(255, 255, 255)        // #FFFFFF Pure White Card
		colCardBrd := rgb(210, 210, 215)     // #D2D2D7 Apple Card Border

		brushCanvas, _, _ := createSolidBrush.Call(colCanvas)
		brushHeader, _, _ := createSolidBrush.Call(colHeader)
		brushHeaderBorder, _, _ := createSolidBrush.Call(colHeaderBorder)
		brushAccent, _, _ := createSolidBrush.Call(colAccent)
		brushBadge, _, _ := createSolidBrush.Call(colBadgeBg)
		brushCard, _, _ := createSolidBrush.Call(colCard)

		for _, b := range []uintptr{brushCanvas, brushHeader, brushHeaderBorder, brushAccent, brushBadge, brushCard} {
			if b != 0 {
				defer deleteObject.Call(b)
			}
		}

		var (
			headerTitleCtrl, headerSubCtrl uintptr
			badgeTitleCtrl, badgeSubCtrl   uintptr
			cardTitleCtrl, label           uintptr
			footerCtrl                     uintptr
		)

		procedure := syscall.NewCallback(func(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
			switch msg {
			case 0x10: // WM_CLOSE
				user.NewProc("ShowWindow").Call(hwnd, 0) // SW_HIDE; never cancels enrollment.
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

					headerRect := winRect{Left: 0, Top: 0, Right: rc.Right, Bottom: 82}
					user.NewProc("FillRect").Call(hdc, uintptr(unsafe.Pointer(&headerRect)), brushHeader)
					accentRect := winRect{Left: 0, Top: 0, Right: rc.Right, Bottom: 4}
					user.NewProc("FillRect").Call(hdc, uintptr(unsafe.Pointer(&accentRect)), brushAccent)
					dividerRect := winRect{Left: 0, Top: 81, Right: rc.Right, Bottom: 82}
					user.NewProc("FillRect").Call(hdc, uintptr(unsafe.Pointer(&dividerRect)), brushHeaderBorder)

					createPen := gdi.NewProc("CreatePen")
					selectObj := gdi.NewProc("SelectObject")
					roundRect := gdi.NewProc("RoundRect")

					// Security badge (16px radius)
					penBadge, _, _ := createPen.Call(0, 1, colBadgeBrd)
					oldPen, _, _ := selectObj.Call(hdc, penBadge)
					oldBrush, _, _ := selectObj.Call(hdc, brushBadge)
					roundRect.Call(hdc, 480, 16, 738, 68, 16, 16)
					selectObj.Call(hdc, oldBrush)
					selectObj.Call(hdc, oldPen)
					deleteObject.Call(penBadge)

					// Progress card (20px radius)
					penCard, _, _ := createPen.Call(0, 1, colCardBrd)
					oldPen, _, _ = selectObj.Call(hdc, penCard)
					oldBrush, _, _ = selectObj.Call(hdc, brushCard)
					roundRect.Call(hdc, 20, 96, 740, 412, 20, 20)
					selectObj.Call(hdc, oldBrush)
					selectObj.Call(hdc, oldPen)
					deleteObject.Call(penCard)

					user.NewProc("EndPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
				}
				return 0
			case wmCtlColorStatic:
				gdi.NewProc("SetBkMode").Call(wparam, 2) // OPAQUE com cor idêntica ao card
				setBkColor := gdi.NewProc("SetBkColor")
				setTextColor := gdi.NewProc("SetTextColor")
				switch lparam {
				case headerTitleCtrl:
					setTextColor.Call(wparam, rgb(29, 29, 31))
					setBkColor.Call(wparam, colHeader)
					return brushHeader
				case headerSubCtrl:
					setTextColor.Call(wparam, rgb(110, 110, 115))
					setBkColor.Call(wparam, colHeader)
					return brushHeader
				case badgeTitleCtrl:
					setTextColor.Call(wparam, rgb(6, 118, 71))
					setBkColor.Call(wparam, colBadgeBg)
					return brushBadge
				case badgeSubCtrl:
					setTextColor.Call(wparam, rgb(22, 101, 52))
					setBkColor.Call(wparam, colBadgeBg)
					return brushBadge
				case cardTitleCtrl:
					setTextColor.Call(wparam, rgb(0, 113, 227))
					setBkColor.Call(wparam, colCard)
					return brushCard
				case footerCtrl:
					setTextColor.Call(wparam, rgb(134, 134, 139))
					setBkColor.Call(wparam, colCanvas)
					return brushCanvas
				default:
					setTextColor.Call(wparam, rgb(29, 29, 31))
					setBkColor.Call(wparam, colCard)
					return brushCard
				}
			}
			r, _, _ := def.Call(hwnd, uintptr(msg), wparam, lparam)
			return r
		})

		instance, _, _ := kernel.NewProc("GetModuleHandleW").Call(0)
		icon, _, _ := user.NewProc("LoadIconW").Call(instance, 1)
		if icon == 0 {
			icon, _, _ = user.NewProc("LoadIconW").Call(0, 32512)
		}
		name := ptr("XPointRemoteSetupProgress")
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
			ready <- errors.New("progress window unavailable")
			return
		}
		defer user.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(name)), instance)

		style := uint32(0x10C80000)
		desiredClient := winRect{Left: 0, Top: 0, Right: 760, Bottom: 452}
		user.NewProc("AdjustWindowRectEx").Call(uintptr(unsafe.Pointer(&desiredClient)), uintptr(style), 0, 0)
		winW := int(desiredClient.Right - desiredClient.Left)
		winH := int(desiredClient.Bottom - desiredClient.Top)

		screenX, _, _ := user.NewProc("GetSystemMetrics").Call(0)
		screenY, _, _ := user.NewProc("GetSystemMetrics").Call(1)
		create := user.NewProc("CreateWindowExW")
		hwnd, _, _ := create.Call(
			0,
			uintptr(unsafe.Pointer(name)),
			uintptr(unsafe.Pointer(ptr("XPoint Remote — Configurando Acesso Seguro (v"+Version+")"))),
			uintptr(style),
			(screenX-uintptr(winW))/2,
			(screenY-uintptr(winH))/2,
			uintptr(winW),
			uintptr(winH),
			0,
			0,
			instance,
			0,
		)
		if hwnd == 0 {
			ready <- errors.New("progress window unavailable")
			return
		}
		enableModernWindowFrame(hwnd)
		if icon != 0 {
			user.NewProc("SendMessageW").Call(hwnd, 0x80, 1, icon)
			user.NewProc("SendMessageW").Call(hwnd, 0x80, 0, icon)
		}
		defer destroy.Call(hwnd)

		headerFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-19)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
		boldSmallFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
		bodyFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-15)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
		smallFont, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32ToPtr(-12)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(ptr("Segoe UI"))))
		for _, f := range []uintptr{headerFont, boldSmallFont, bodyFont, smallFont} {
			if f != 0 {
				defer deleteObject.Call(f)
			}
		}

		addStatic := func(text string, x, y, w, h int, f uintptr) uintptr {
			ctrl, _, _ := create.Call(0, uintptr(unsafe.Pointer(ptr("STATIC"))), uintptr(unsafe.Pointer(ptr(text))), 0x50000080, uintptr(x), uintptr(y), uintptr(w), uintptr(h), hwnd, 0, instance, 0)
			if f != 0 && ctrl != 0 {
				user.NewProc("SendMessageW").Call(ctrl, 0x30, f, 0)
			}
			return ctrl
		}

		headerTitleCtrl = addStatic("XPoint Remote — Configurando Acesso Seguro", 24, 16, 440, 26, headerFont)
		headerSubCtrl = addStatic("Aguarde enquanto aplicamos a proteção, o serviço e o vínculo por CNPJ", 24, 46, 440, 20, smallFont)
		badgeTitleCtrl = addStatic("✓ INSTALAÇÃO PROTEGIDA ATIVA", 492, 23, 234, 18, boldSmallFont)
		badgeSubCtrl = addStatic("Não desligue o computador agora", 492, 43, 234, 16, smallFont)

		cardTitleCtrl = addStatic("ANDAMENTO DAS ETAPAS DE CONFIGURAÇÃO & SEGURANÇA", 38, 108, 684, 18, boldSmallFont)
		label = addStatic(report.ProgressText(), 38, 134, 684, 264, bodyFont)
		if label == 0 {
			ready <- errors.New("progress text unavailable")
			return
		}
		footerCtrl = addStatic("🔒 Todas as credenciais permanecem criptografadas localmente com Windows DPAPI • XPoint Soluções", 24, 422, 712, 18, smallFont)

		invalidate := user.NewProc("InvalidateRect")
		invalidate.Call(hwnd, 0, 1)
		user.NewProc("UpdateWindow").Call(hwnd)
		ready <- nil
		peek := user.NewProc("PeekMessageW")
		translate := user.NewProc("TranslateMessage")
		dispatch := user.NewProc("DispatchMessageW")
		lastText := ""
		for {
			select {
			case <-done:
				return
			default:
			}
			if text := report.ProgressText(); text != lastText {
				user.NewProc("SetWindowTextW").Call(label, uintptr(unsafe.Pointer(ptr(text))))
				invalidate.Call(label, 0, 1)
				lastText = text
			}
			var m windowMessage
			for {
				ok, _, _ := peek.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, 1)
				if ok == 0 {
					break
				}
				translate.Call(uintptr(unsafe.Pointer(&m)))
				dispatch.Call(uintptr(unsafe.Pointer(&m)))
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()
	if e := <-ready; e != nil {
		<-closed
		return nil, e
	}
	var once sync.Once
	return func() { once.Do(func() { close(done); <-closed }) }, nil
}
