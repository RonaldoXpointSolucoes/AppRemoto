//go:build windows

package main

import (
	"context"
	"errors"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/setup"
	"os"
	"time"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--service" {
		if setup.RunService() != nil {
			os.Exit(1)
		}
		return
	}
	uninstall := len(os.Args) == 2 && os.Args[1] == "--uninstall"
	if len(os.Args) > 2 || (len(os.Args) == 2 && !uninstall && os.Args[1] != "--elevated") {
		setup.Message("Argumentos invalidos.")
		os.Exit(2)
	}
	if uninstall && !setup.Elevated() {
		if setup.Elevate(true) != nil {
			setup.Message("A remocao requer aprovacao de administrador. Codigo: UAC")
			os.Exit(1)
		}
		return
	}
	exe, err := os.Executable()
	if err != nil {
		setup.Message("Nao foi possivel localizar o executavel. Codigo: LOG_PATH")
		os.Exit(1)
	}
	report, err := setup.OpenReport(exe)
	if err != nil {
		setup.Message("Nao foi possivel criar o arquivo .log ao lado deste executavel. Copie o instalador para uma pasta local gravavel, como Downloads, e execute novamente. Codigo: LOG_OPEN")
		os.Exit(1)
	}
	defer report.Close()
	if !setup.Elevated() {
		report.Record(1, "UAC", "START", nil)
		if err := setup.Elevate(uninstall); err != nil {
			report.Record(1, "UAC", "ERROR", err)
			report.Close()
			setup.Message("A configuracao requer aprovacao de administrador. Codigo: UAC. Log: " + report.Path())
			os.Exit(1)
		}
		return
	}
	if uninstall {
		if setup.Uninstall() != nil {
			setup.Message("Nao foi possivel remover o servico. Codigo: UNINSTALL")
			os.Exit(1)
		}
		setup.Message("Servico XPoint removido. RustDesk e dados de recuperacao foram preservados.")
		return
	}
	report.Record(1, "ADMINISTRATOR", "OK", nil)
	input, err := setup.ReadInstallationInput(report)
	if errors.Is(err, setup.ErrInputCancelled) {
		report.Record(0, "CANCELLED_BEFORE_INSTALL", "OK", nil)
		return
	}
	if err != nil {
		report.Record(1, "PACKAGE", "ERROR", err)
		report.Close()
		setup.Message(setup.FailureMessage("PACKAGE") + "\n\nLog: " + report.Path())
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	stopProgress, err := setup.ShowProgress(report)
	if err != nil {
		report.Record(1, "PROGRESS_WINDOW", "ERROR", err)
		report.Close()
		setup.Message("Nao foi possivel abrir o instalador. Codigo: UI. Log: " + report.Path())
		os.Exit(1)
	}
	code := setup.InstallWithInput(ctx, report, input)
	stopProgress()
	if code != "" {
		report.Record(0, code, "ERROR", nil)
		report.Close()
		setup.Message(setup.FailureMessage(code) + "\n\nCodigo: " + code + "\nLog: " + report.Path())
		os.Exit(1)
	}
	report.Record(0, "SETUP_COMPLETE", "OK", nil)
	if report.Err() != nil {
		report.Close()
		setup.Message("A comunicacao foi confirmada, mas houve falha ao gravar o log. Codigo: LOG_WRITE. Log: " + report.Path())
		os.Exit(1)
	}
	report.Close()
	setup.Message("Configuracao concluida. O computador esta disponivel na lista Dispositivos do painel XPoint.\n\nLog: " + report.Path())
}
