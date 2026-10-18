package setup

import (
	"testing"
)

func TestParseDataDivasINIWithCP1252AndDataINI(t *testing.T) {
	// Simula arquivo C:\DataDivas\config.ini em Windows-1252 (CP1252) com Ç (0xC7) e Ã (0xC3)
	rawConfig := []byte("[winfox]\r\n" +
		"razao=SISTEMA DEMO\r\n" +
		"cnpj=254.867.528-90\r\n" +
		"nomemaq=RONALDO-ASUS\r\n" +
		"ipmaq=192.168.0.3\r\n" +
		"serial=XPOI-AAAA-DDDD-0028\r\n" +
		"fantasia=SISTEMA DEMONSTRA\xc7\xc3O\r\n" +
		"endereco=PRA\xc7A MIGUEL ORTEGA, 340\r\n" +
		"cidade=TABOAO DA SERRA\r\n" +
		"UF=sp\r\n" +
		"IE=110.042.490.114\r\n")

	rawData := []byte("[winfox]\r\n" +
		"banco=192.168.0.100:C:\\DataDivas\\DATADIVAS.FDB\r\n" +
		"servidor=penttium\r\n")

	info := ParseDataDivasINI(rawConfig, rawData)
	if info == nil {
		t.Fatal("expected non-nil DataDivasInfo")
	}
	if info.RazaoSocial != "SISTEMA DEMO" {
		t.Errorf("RazaoSocial = %q, want SISTEMA DEMO", info.RazaoSocial)
	}
	if info.NomeFantasia != "SISTEMA DEMONSTRAÇÃO" {
		t.Errorf("NomeFantasia = %q, want SISTEMA DEMONSTRAÇÃO", info.NomeFantasia)
	}
	if info.CNPJ != "254.867.528-90" {
		t.Errorf("CNPJ = %q, want 254.867.528-90", info.CNPJ)
	}
	if info.Serial != "XPOI-AAAA-DDDD-0028" {
		t.Errorf("Serial = %q, want XPOI-AAAA-DDDD-0028", info.Serial)
	}
	if info.IE != "110.042.490.114" {
		t.Errorf("IE = %q, want 110.042.490.114", info.IE)
	}
	if info.Endereco != "PRAÇA MIGUEL ORTEGA, 340" {
		t.Errorf("Endereco = %q, want PRAÇA MIGUEL ORTEGA, 340", info.Endereco)
	}
	if info.Cidade != "TABOAO DA SERRA" {
		t.Errorf("Cidade = %q, want TABOAO DA SERRA", info.Cidade)
	}
	if info.UF != "SP" {
		t.Errorf("UF = %q, want SP", info.UF)
	}
	if info.NomeMaq != "RONALDO-ASUS" {
		t.Errorf("NomeMaq = %q, want RONALDO-ASUS", info.NomeMaq)
	}
	if info.IPMaq != "192.168.0.3" {
		t.Errorf("IPMaq = %q, want 192.168.0.3", info.IPMaq)
	}
	if info.IPDataDivas != "192.168.0.100" {
		t.Errorf("IPDataDivas = %q, want 192.168.0.100", info.IPDataDivas)
	}
	if info.Banco != `192.168.0.100:C:\DataDivas\DATADIVAS.FDB` {
		t.Errorf("Banco = %q, want 192.168.0.100:C:\\DataDivas\\DATADIVAS.FDB", info.Banco)
	}

	suggested := SuggestedDisplayName(info, "FALLBACK-PC")
	if suggested != "SISTEMA DEMONSTRAÇÃO - RONALDO-ASUS" {
		t.Errorf("SuggestedDisplayName = %q, want SISTEMA DEMONSTRAÇÃO - RONALDO-ASUS", suggested)
	}
}

func TestParseDataDivasINILocalDatabaseFallback(t *testing.T) {
	rawConfig := []byte("[winfox]\nrazao=PADARIA CENTRAL\nipmaq=192.168.1.50\n")
	rawData := []byte("[winfox]\nbanco=C:\\DataDivas\\DATADIVAS.FDB\nservidor=server-pdv\n")
	info := ParseDataDivasINI(rawConfig, rawData)
	if info == nil {
		t.Fatal("expected non-nil DataDivasInfo")
	}
	if info.IPDataDivas != "192.168.1.50 (server-pdv)" {
		t.Errorf("IPDataDivas = %q, want 192.168.1.50 (server-pdv)", info.IPDataDivas)
	}
}
