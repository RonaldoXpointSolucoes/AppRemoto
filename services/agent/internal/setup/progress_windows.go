//go:build windows

package setup

import (
	"errors"
	"golang.org/x/sys/windows"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
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
func ShowProgress() (func(), error) {
	ready := make(chan error, 1)
	done := make(chan struct{})
	closed := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(closed)
		user := windows.NewLazySystemDLL("user32.dll")
		kernel := windows.NewLazySystemDLL("kernel32.dll")
		def := user.NewProc("DefWindowProcW")
		destroy := user.NewProc("DestroyWindow")
		var label uintptr
		procedure := syscall.NewCallback(func(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
			if msg == 0x10 {
				user.NewProc("ShowWindow").Call(hwnd, 0) // SW_HIDE; never cancels enrollment.
				return 0
			}
			r, _, _ := def.Call(hwnd, uintptr(msg), wparam, lparam)
			return r
		})
		instance, _, _ := kernel.NewProc("GetModuleHandleW").Call(0)
		name := ptr("XPointRemoteSetupProgress")
		wc := windowClass{Size: uint32(unsafe.Sizeof(windowClass{})), Procedure: procedure, Instance: instance, Background: 6, Name: name}
		atom, _, _ := user.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&wc)))
		if atom == 0 {
			ready <- errors.New("progress window unavailable")
			return
		}
		defer user.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(name)), instance)
		screenX, _, _ := user.NewProc("GetSystemMetrics").Call(0)
		screenY, _, _ := user.NewProc("GetSystemMetrics").Call(1)
		create := user.NewProc("CreateWindowExW")
		hwnd, _, _ := create.Call(0, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(ptr("XPoint Remote - Instalando"))), 0x10C80000, (screenX-560)/2, (screenY-180)/2, 560, 180, 0, 0, instance, 0)
		if hwnd == 0 {
			ready <- errors.New("progress window unavailable")
			return
		}
		defer destroy.Call(hwnd)
		label, _, _ = create.Call(0, uintptr(unsafe.Pointer(ptr("STATIC"))), uintptr(unsafe.Pointer(ptr("Preparando o acesso remoto e confirmando a conexao com o painel.\r\n\r\nVoce pode fechar esta janela. A instalacao continuara em segundo plano e avisara ao terminar."))), 0x50000000, 22, 25, 510, 95, hwnd, 0, instance, 0)
		if label == 0 {
			ready <- errors.New("progress text unavailable")
			return
		}
		user.NewProc("UpdateWindow").Call(hwnd)
		ready <- nil
		peek := user.NewProc("PeekMessageW")
		translate := user.NewProc("TranslateMessage")
		dispatch := user.NewProc("DispatchMessageW")
		for {
			select {
			case <-done:
				return
			default:
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
