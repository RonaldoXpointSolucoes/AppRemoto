package setup

import (
	"testing"
)

func TestCnpjNormalizationAndValidation(t *testing.T) {
	if got := NormalizeCnpjDigits("12.345.678/0001-95"); got != "12345678000195" {
		t.Fatalf("NormalizeCnpjDigits = %q, want 12345678000195", got)
	}
	if !IsValidCnpj14("12.345.678/0001-95") {
		t.Fatal("expected valid 14-digit CNPJ")
	}
	if IsValidCnpj14("00.000.000/0000-00") || IsValidCnpj14("12345") {
		t.Fatal("expected invalid CNPJ to be rejected")
	}
}

func TestWindowsHostnameNormalizationAndValidation(t *testing.T) {
	if got := NormalizeWindowsHostname("Estação Garçom 01"); got != "ESTACAO-GARCOM" {
		t.Fatalf("NormalizeWindowsHostname = %q, want ESTACAO-GARCOM (15 chars max)", got)
	}
	norm, msg, ok := ValidateWindowsHostname("CAIXA-03")
	if !ok || norm != "CAIXA-03" || msg != "" {
		t.Fatalf("expected valid CAIXA-03, got norm=%q msg=%q ok=%v", norm, msg, ok)
	}
	if _, _, ok := ValidateWindowsHostname("123456"); ok {
		t.Fatal("digits-only hostname must be rejected")
	}
	if _, _, ok := ValidateWindowsHostname("LOCALHOST"); ok {
		t.Fatal("reserved Windows name LOCALHOST must be rejected")
	}
}

func TestLocalSuggestNameForRoleFillsSequenceGapsAndRetainsOffline(t *testing.T) {
	computers := []ExistingCnpjComputer{
		{DeviceID: "d1", Nome: "SERVIDOR", NomeNormalizado: "SERVIDOR", Funcao: "SERVIDOR", Situacao: "online"},
		{DeviceID: "d2", Nome: "CAIXA-01", NomeNormalizado: "CAIXA-01", Funcao: "CAIXA", Situacao: "online"},
		{DeviceID: "d3", Nome: "CAIXA-02", NomeNormalizado: "CAIXA-02", Funcao: "CAIXA", Situacao: "offline"},
		{DeviceID: "d4", Nome: "CAIXA-04", NomeNormalizado: "CAIXA-04", Funcao: "CAIXA", Situacao: "online"},
	}

	caixaSug := LocalSuggestNameForRole("CAIXA", computers, "", "")
	if caixaSug.SuggestedName != "CAIXA-03" || !caixaSug.Available {
		t.Fatalf("expected gap-fill CAIXA-03 available, got %+v", caixaSug)
	}

	srvSug := LocalSuggestNameForRole("SERVIDOR", computers, "", "")
	if srvSug.Available {
		t.Fatalf("expected SERVIDOR to be unavailable when already occupied, got %+v", srvSug)
	}

	// Reinstalling or replacing SERVIDOR allows keeping SERVIDOR
	srvReinstall := LocalSuggestNameForRole("SERVIDOR", computers, "", "SERVIDOR")
	if !srvReinstall.Available || srvReinstall.SuggestedName != "SERVIDOR" {
		t.Fatalf("expected SERVIDOR to be available when allowSameName=SERVIDOR, got %+v", srvReinstall)
	}
}
