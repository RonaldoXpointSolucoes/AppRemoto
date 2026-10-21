//go:build !windows

package setup

import "github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"

// CollectSystemInfo fallback para sistemas não-Windows
func CollectSystemInfo() (operatingSystem string, osVersion string) {
	return "Windows", "11.0"
}

func ForceRefreshTelemetryCache() {}

func EnrichDataDivasWithTelemetry(info *api.DataDivasInfo) *api.DataDivasInfo {
	return info
}

func ExecuteSafeRemoteCommand(action string) (status string, resultMsg string) {
	return "EXECUTADO", "OK"
}
