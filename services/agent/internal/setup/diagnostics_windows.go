//go:build windows

package setup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/enroll"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/state"
	"golang.org/x/sys/windows"
)

type Event struct {
	At        time.Time `json:"at"`
	Step      int       `json:"step"`
	Operation string    `json:"operation"`
	Result    string    `json:"result"`
	Detail    string    `json:"detail,omitempty"`
}
type Report struct {
	mu     sync.Mutex
	file   *os.File
	pins   []windows.Handle
	path   string
	events []Event
	err    error
	sink   func([]Event) error
}

// OpenReport never truncates an existing log or follows a redirected log path.
func OpenReport(executable string) (*Report, error) {
	path := strings.TrimSuffix(executable, filepath.Ext(executable)) + ".log"
	r := &Report{path: path}
	var parents []string
	for d := filepath.Dir(path); ; d = filepath.Dir(d) {
		parents = append(parents, d)
		if filepath.Dir(d) == d {
			break
		}
	}
	for i := len(parents) - 1; i >= 0; i-- {
		h, e := windows.CreateFile(ptr(parents[i]), windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
		if e != nil {
			r.Close()
			return nil, e
		}
		r.pins = append(r.pins, h)
		var info windows.ByHandleFileInformation
		if e = windows.GetFileInformationByHandle(h, &info); e != nil || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			r.Close()
			return nil, errStage
		}
	}
	h, e := windows.CreateFile(ptr(path), windows.FILE_APPEND_DATA|windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_ALWAYS, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if e != nil {
		r.Close()
		return nil, e
	}
	r.file = os.NewFile(uintptr(h), path)
	var info windows.ByHandleFileInformation
	if e = windows.GetFileInformationByHandle(h, &info); e != nil || info.NumberOfLinks != 1 || info.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 || info.FileSizeHigh != 0 || info.FileSizeLow > 64<<20 {
		r.Close()
		return nil, errStage
	}
	r.Record(0, "SESSION_START", "START", nil)
	if r.Err() != nil {
		e = r.Err()
		r.Close()
		return nil, e
	}
	return r, nil
}
func (r *Report) Close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file != nil {
		if e := r.file.Close(); e != nil {
			r.err = e
		}
		r.file = nil
	}
	for _, h := range r.pins {
		windows.CloseHandle(h)
	}
	r.pins = nil
}
func (r *Report) Path() string {
	if r == nil {
		return ""
	}
	return r.path
}
func (r *Report) Err() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.err
}
func (r *Report) Events() []Event {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Event(nil), r.events...)
}
func (r *Report) Record(step int, operation, result string, err error) {
	if r == nil {
		return
	}
	r.Accept(Event{time.Now().UTC(), step, operation, result, diagnostic(err)})
}
func (r *Report) Accept(event Event) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	// Only fixed operation/result identifiers and a bounded safe diagnostic reach disk.
	if event.Step < 0 || event.Step > 6 || !safeIdentifier(event.Operation) || (event.Result != "START" && event.Result != "OK" && event.Result != "ERROR" && event.Result != "WAIT") || !safeDiagnostic(event.Detail) {
		return
	}
	r.events = append(r.events, event)
	if len(r.events) > 128 {
		r.events = r.events[len(r.events)-128:]
	}
	if r.file != nil {
		_, e := fmt.Fprintf(r.file, "%s version=%s pid=%d etapa=%d operacao=%s resultado=%s detalhe=%s\r\n", event.At.Format(time.RFC3339Nano), Version, os.Getpid(), event.Step, event.Operation, event.Result, event.Detail)
		if e == nil {
			e = r.file.Sync()
		}
		if e != nil {
			r.err = e
		}
	}
	if r.sink != nil {
		if e := r.sink(append([]Event(nil), r.events...)); e != nil {
			r.err = e
		}
	}
}
func safeIdentifier(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for _, c := range s {
		if (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '_' {
			return false
		}
	}
	return true
}
func safeDiagnostic(s string) bool {
	if s == "" || safeIdentifier(s) {
		return true
	}
	if strings.HasPrefix(s, "win32=") {
		for _, c := range strings.TrimPrefix(s, "win32=") {
			if c < '0' || c > '9' {
				return false
			}
		}
		return len(s) <= 24
	}
	return false
}
func diagnostic(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "TIMEOUT"
	}
	if errors.Is(err, context.Canceled) {
		return "CANCELLED"
	}
	var n syscall.Errno
	if errors.As(err, &n) {
		return fmt.Sprintf("win32=%d", uint32(n))
	}
	var nt windows.NTStatus
	if errors.As(err, &nt) {
		return fmt.Sprintf("win32=%d", uint32(nt.Errno()))
	}
	if errors.Is(err, state.ErrIdentityOwner) {
		return "IDENTITY_OWNER_MISMATCH"
	}
	var ae *api.Error
	if errors.As(err, &ae) && safeIdentifier(string(ae.Code)) {
		return string(ae.Code)
	}
	if errors.Is(err, enroll.ErrManualReconciliation) {
		return "RECONCILIATION"
	}
	if errors.Is(err, enroll.ErrRustDeskConfiguration) {
		return "PASSWORD_CONFIGURATION"
	}
	if errors.Is(err, ErrOverlay) {
		return "INVALID_OR_EXPIRED_PACKAGE"
	}
	if errors.Is(err, errUnattended) {
		return "UNATTENDED_POLICY"
	}
	var stage *enroll.StageError
	if errors.As(err, &stage) && safeIdentifier(stage.Operation+"_FAILED") {
		return stage.Operation + "_FAILED"
	}
	return "FAILED"
}

var stepLabels = []string{"Validar pacote e permissao", "Verificar RustDesk instalado", "Preparar servico XPoint", "Configurar servidores e acesso", "Cadastrar computador e senha", "Confirmar comunicacao com o painel"}

func (r *Report) ProgressText() string {
	events := r.Events()
	states := [7]string{}
	var last Event
	for _, e := range events {
		if e.Step > 0 {
			states[e.Step] = e.Result
			last = e
		}
	}
	var b strings.Builder
	for i, label := range stepLabels {
		mark := "[ ]"
		switch states[i+1] {
		case "OK":
			mark = "[OK]"
		case "ERROR":
			mark = "[ERRO]"
		case "START", "WAIT":
			mark = "[... ]"
		}
		fmt.Fprintf(&b, "%s %d. %s\r\n", mark, i+1, label)
	}
	if last.Operation != "" {
		fmt.Fprintf(&b, "\r\nOperacao: %s (%ds)\r\n", last.Operation, int(time.Since(last.At).Seconds()))
	}
	b.WriteString("\r\nLog: " + r.Path() + "\r\nFechar esta janela apenas oculta o progresso.")
	return b.String()
}

type serviceProgress struct {
	EnrollmentID string    `json:"enrollmentId"`
	Started      time.Time `json:"started"`
	Events       []Event   `json:"events"`
}

func serviceReport(directory, enrollmentID string) *Report {
	started := time.Now().UTC()
	return &Report{sink: func(events []Event) error {
		b, e := json.Marshal(serviceProgress{enrollmentID, started, events})
		if e != nil {
			return e
		}
		return publishStatus(directory, "setup-status.json", b)
	}}
}

func mergeServiceProgress(r *Report, b []byte, enrollmentID string, started, last time.Time) (time.Time, string) {
	var p serviceProgress
	if json.Unmarshal(b, &p) != nil || p.EnrollmentID != enrollmentID || p.Started.Before(started) {
		return last, ""
	}
	failure := ""
	for _, e := range p.Events {
		if e.At.After(last) {
			r.Accept(e)
			last = e.At
			if e.Result == "ERROR" {
				if e.Detail == "RECONCILIATION" {
					failure = "RECONCILIATION"
				} else if failure == "" {
					failure = e.Operation
				}
			}
		}
	}
	return last, failure
}

func FailureMessage(code string) string {
	switch code {
	case "BUSY":
		return "Outra configuracao XPoint ainda esta em execucao. Aguarde a janela anterior terminar; nao abra outro instalador."
	case "LOCK_ACCESS", "LOCK":
		return "O Windows recusou o controle da instalacao. Consulte o codigo Win32 no log."
	case "RUSTDESK_MISSING":
		return "Instale o RustDesk no computador (incluindo o servico) e execute novamente este arquivo. Este configurador nao baixa nem instala o RustDesk."
	case "PACKAGE":
		return "Pacote invalido ou vencido. Baixe um novo instalador no painel para o cliente desejado. O nome pode ser diferente do anterior."
	case "EXISTING_INSTALLATION":
		return "Este computador pertence a outro cliente. Baixe o instalador para o cliente correto; o nome do computador pode ser alterado livremente."
	case "RECONCILIATION":
		return "Uma tentativa anterior pode ter enviado o cadastro, mas nao salvou a resposta. Preserve os dados e encaminhe o log ao tecnico para reconciliar o cadastro."
	case "IDENTITY_DIRECTORY_PREPARE", "IDENTITY_LOAD_CREATE":
		return "O Windows impediu a preparacao da identidade protegida deste computador. O cadastro ainda nao foi enviado ao painel. Consulte a operacao e o codigo do Windows no log."
	default:
		return "A configuracao nao foi concluida. O log identifica a ultima operacao e o erro. Os dados de recuperacao foram preservados."
	}
}
