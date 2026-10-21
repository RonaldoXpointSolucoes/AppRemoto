package setup

import (
	"strings"
	"testing"
)

func TestCollectSystemInfo(t *testing.T) {
	osName, osVersion := CollectSystemInfo()
	if osName == "" {
		t.Fatal("expected non-empty operatingSystem")
	}
	if osVersion == "" {
		t.Fatal("expected non-empty osVersion")
	}
	if len(osName) > 64 {
		t.Fatalf("operatingSystem exceeds 64 chars: %s", osName)
	}
	if len(osVersion) > 128 {
		t.Fatalf("osVersion exceeds 128 chars: %s", osVersion)
	}
	t.Logf("Collected: OS=%q, Version=%q", osName, osVersion)
	if !strings.Contains(osName, "Windows") {
		t.Errorf("expected operatingSystem to contain Windows, got %q", osName)
	}

	telemetry := EnrichDataDivasWithTelemetry(nil)
	if telemetry == nil {
		t.Fatal("expected non-nil telemetry")
	}
	t.Logf("Telemetry: CPU=%q (%s), RAM=%s/%s (%s), Disk=%s/%s (%s), Subnet=%s, GW=%s, Type=%s",
		telemetry.CPUModelo, telemetry.CPUUsoPct,
		telemetry.RAMUsadaGb, telemetry.RAMTotalGb, telemetry.RAMUsoPct,
		telemetry.DiscoUsadoGb, telemetry.DiscoTotalGb, telemetry.DiscoUsoPct,
		telemetry.RedeSubrede, telemetry.RedeGateway, telemetry.RedeTipo,
	)
}
