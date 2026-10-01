//go:build windows

package main

import (
	"context"
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
	if !setup.Elevated() {
		if setup.Elevate(uninstall) != nil {
			setup.Message("A instalacao requer aprovacao de administrador. Codigo: UAC")
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
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	stopProgress, err := setup.ShowProgress()
	if err != nil {
		setup.Message("Nao foi possivel abrir o instalador. Codigo: UI")
		os.Exit(1)
	}
	code := setup.Install(ctx)
	stopProgress()
	if code != "" {
		setup.Message("Instalacao nao confirmada. Codigo: " + code + ". O estado de recuperacao foi preservado. Informe este codigo ao tecnico.")
		os.Exit(1)
	}
	setup.Message("Instalacao concluida. O computador enviou presenca a API e esta disponivel no painel XPoint.")
}
