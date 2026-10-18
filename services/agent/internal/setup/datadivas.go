package setup

import (
	"bytes"
	"fmt"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
)

var defaultDataDivasConfigPaths = []string{
	`C:\DataDivas\config.ini`,
	`C:\DataDivas\CONFIG.ini`,
	`C:\DataDivas\CONFIG.INI`,
	`D:\DataDivas\config.ini`,
	`D:\DataDivas\CONFIG.INI`,
}

var defaultDataDivasDataPaths = []string{
	`C:\DataDivas\DATA.INI`,
	`C:\DataDivas\data.ini`,
	`D:\DataDivas\DATA.INI`,
	`D:\DataDivas\data.ini`,
}

var cp1252Table = [32]rune{
	0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
	0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD,
	0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
	0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178,
}

func decodeTextBytes(raw []byte) string {
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	if utf8.Valid(raw) {
		return string(raw)
	}
	var sb strings.Builder
	sb.Grow(len(raw) + 32)
	for _, b := range raw {
		switch {
		case b < 0x80:
			sb.WriteByte(b)
		case b >= 0xA0:
			sb.WriteRune(rune(b))
		default:
			r := cp1252Table[b-0x80]
			if r != 0xFFFD {
				sb.WriteRune(r)
			}
		}
	}
	return sb.String()
}

func sanitizeField(val string, maxRunes int) string {
	var sb strings.Builder
	for _, r := range strings.TrimSpace(val) {
		if unicode.IsControl(r) {
			continue
		}
		sb.WriteRune(r)
	}
	cleaned := strings.Join(strings.Fields(sb.String()), " ")
	if utf8.RuneCountInString(cleaned) > maxRunes {
		runes := []rune(cleaned)
		return strings.TrimSpace(string(runes[:maxRunes]))
	}
	return cleaned
}

func normalizeINIKey(key string) string {
	var sb strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(key)) {
		switch r {
		case ' ', '_', '-', '.', '/':
			continue
		case 'á', 'à', 'ã', 'â':
			sb.WriteRune('a')
		case 'é', 'ê':
			sb.WriteRune('e')
		case 'í':
			sb.WriteRune('i')
		case 'ó', 'õ', 'ô':
			sb.WriteRune('o')
		case 'ú':
			sb.WriteRune('u')
		case 'ç':
			sb.WriteRune('c')
		default:
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

func parseINIMap(raw []byte) map[string]string {
	out := make(map[string]string)
	if len(raw) == 0 {
		return out
	}
	text := decodeTextBytes(raw)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		idx := strings.IndexByte(line, '=')
		if idx <= 0 {
			continue
		}
		k := normalizeINIKey(line[:idx])
		v := strings.TrimSpace(line[idx+1:])
		if k != "" && v != "" {
			if _, exists := out[k]; !exists {
				out[k] = v
			}
		}
	}
	return out
}

func pickFirst(m map[string]string, maxRunes int, keys ...string) string {
	for _, k := range keys {
		if val, ok := m[k]; ok && strings.TrimSpace(val) != "" {
			if s := sanitizeField(val, maxRunes); s != "" {
				return s
			}
		}
	}
	return ""
}

func extractHostFromDatabasePath(dbPath string) string {
	trimmed := strings.TrimSpace(dbPath)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, `\\`) {
		rest := strings.TrimPrefix(trimmed, `\\`)
		if slash := strings.IndexAny(rest, `\/`); slash > 0 {
			return sanitizeField(rest[:slash], 128)
		}
	}
	colon := strings.IndexByte(trimmed, ':')
	if colon > 1 {
		hostPart := trimmed[:colon]
		if slash := strings.IndexByte(hostPart, '/'); slash > 0 {
			hostPart = hostPart[:slash]
		}
		return sanitizeField(hostPart, 128)
	}
	return ""
}

// ParseDataDivasINI extrai os dados cadastrais e de rede do cliente a partir de C:\DataDivas\config.ini
// (e complementarmente de C:\DataDivas\DATA.INI quando presente).
func ParseDataDivasINI(configBytes []byte, dataIniBytes []byte) *api.DataDivasInfo {
	cfg := parseINIMap(configBytes)
	dataCfg := parseINIMap(dataIniBytes)
	if len(cfg) == 0 && len(dataCfg) == 0 {
		return nil
	}

	info := &api.DataDivasInfo{
		NomeFantasia: pickFirst(cfg, 160, "fantasia", "nomefantasia", "nmfantasia", "empresa"),
		RazaoSocial:  pickFirst(cfg, 160, "razao", "razaosocial", "nmrazao", "razaosocialempresa"),
		CNPJ:         pickFirst(cfg, 64, "cnpj", "cpfcnpj", "cnpjcpf", "cpf"),
		Serial:       pickFirst(cfg, 128, "serial", "numeroserie", "numserie", "chave", "licenca"),
		IE:           pickFirst(cfg, 64, "ie", "inscricaoestadual", "inscestadual", "ierg"),
		Endereco:     pickFirst(cfg, 255, "endereco", "logradouro", "end", "rua"),
		Cidade:       pickFirst(cfg, 128, "cidade", "municipio"),
		UF:           strings.ToUpper(pickFirst(cfg, 16, "uf", "estado")),
		NomeMaq:      pickFirst(cfg, 128, "nomemaq", "maquina", "nmmaq", "computador", "estacao"),
		IPMaq:        pickFirst(cfg, 128, "ipmaq", "ipmaa", "ipmaquina", "ipestacao", "iplocal"),
		IPDataDivas:  pickFirst(cfg, 160, "ipdatadivas", "ipservidor", "ipserver", "ipbanco", "ipbd", "host"),
		Banco:        pickFirst(cfg, 255, "banco", "bd", "caminhobdservidor"),
	}

	if numero := pickFirst(cfg, 32, "numero", "nro", "num"); numero != "" && info.Endereco != "" && !strings.Contains(info.Endereco, numero) {
		info.Endereco = sanitizeField(info.Endereco+", "+numero, 255)
	}
	if bairro := pickFirst(cfg, 64, "bairro"); bairro != "" && info.Endereco != "" && !strings.Contains(strings.ToLower(info.Endereco), strings.ToLower(bairro)) {
		info.Endereco = sanitizeField(info.Endereco+" - "+bairro, 255)
	}

	if info.Banco == "" {
		info.Banco = pickFirst(dataCfg, 255, "banco", "caminhobdservidor", "novobd")
	}
	if info.NomeMaq == "" {
		info.NomeMaq = pickFirst(dataCfg, 128, "estacao", "identificadorpc")
	}

	servidor := pickFirst(cfg, 128, "servidor", "nmservidor")
	if servidor == "" {
		servidor = pickFirst(dataCfg, 128, "servidor", "nmservidor", "cedtip")
	}

	if info.IPDataDivas == "" {
		if dbHost := extractHostFromDatabasePath(info.Banco); dbHost != "" {
			info.IPDataDivas = dbHost
		} else if servidor != "" && info.IPMaq != "" && !strings.EqualFold(servidor, info.IPMaq) {
			info.IPDataDivas = sanitizeField(fmt.Sprintf("%s (%s)", info.IPMaq, servidor), 160)
		} else if servidor != "" {
			info.IPDataDivas = servidor
		} else if info.IPMaq != "" {
			info.IPDataDivas = info.IPMaq
		}
	}

	if info.NomeFantasia == "" && info.RazaoSocial == "" && info.CNPJ == "" && info.Serial == "" &&
		info.IE == "" && info.Endereco == "" && info.Cidade == "" && info.UF == "" &&
		info.NomeMaq == "" && info.IPMaq == "" && info.IPDataDivas == "" && info.Banco == "" {
		return nil
	}
	return info
}

// CollectDataDivasInfo lê C:\DataDivas\config.ini (e C:\DataDivas\DATA.INI quando existente) na máquina Windows.
func CollectDataDivasInfo() *api.DataDivasInfo {
	var configBytes []byte
	for _, p := range defaultDataDivasConfigPaths {
		if b, err := os.ReadFile(p); err == nil && len(b) > 0 && len(b) <= 256*1024 {
			configBytes = b
			break
		}
	}
	if len(configBytes) == 0 {
		return nil
	}
	var dataBytes []byte
	for _, p := range defaultDataDivasDataPaths {
		if b, err := os.ReadFile(p); err == nil && len(b) > 0 && len(b) <= 512*1024 {
			dataBytes = b
			break
		}
	}
	return ParseDataDivasINI(configBytes, dataBytes)
}

// SuggestedDisplayName sugere um nome amigável para o computador combinando Nome Fantasia (ou Razão Social)
// e o nome da máquina quando disponível em C:\DataDivas\config.ini.
func SuggestedDisplayName(info *api.DataDivasInfo, fallbackHost string) string {
	host := sanitizeField(fallbackHost, 128)
	if info == nil {
		if host != "" {
			return host
		}
		return "PC-REMOTO"
	}
	primary := info.NomeFantasia
	if primary == "" {
		primary = info.RazaoSocial
	}
	machine := info.NomeMaq
	if machine == "" {
		machine = host
	}
	var candidate string
	switch {
	case primary != "" && machine != "" && !strings.EqualFold(primary, machine):
		candidate = primary + " - " + machine
	case primary != "":
		candidate = primary
	case machine != "":
		candidate = machine
	default:
		candidate = "PC-REMOTO"
	}
	return sanitizeField(candidate, 128)
}

// FormatDataDivasSummary formata um resumo compacto dos dados lidos do config.ini para exibição no instalador.
func FormatDataDivasSummary(info *api.DataDivasInfo) string {
	if info == nil {
		return "Arquivo C:\\DataDivas\\config.ini não detectado nesta máquina (instalação padrão)."
	}
	var parts []string
	if info.NomeFantasia != "" {
		parts = append(parts, "Fantasia: "+info.NomeFantasia)
	} else if info.RazaoSocial != "" {
		parts = append(parts, "Razão: "+info.RazaoSocial)
	}
	if info.CNPJ != "" {
		parts = append(parts, "CNPJ: "+info.CNPJ)
	}
	if info.Serial != "" {
		parts = append(parts, "Serial: "+info.Serial)
	}
	if info.IPMaq != "" {
		parts = append(parts, "IP Maq: "+info.IPMaq)
	}
	if len(parts) == 0 {
		return "DataDivas detectado em C:\\DataDivas\\config.ini (dados serão vinculados ao cadastro)."
	}
	return "DataDivas (C:\\DataDivas\\config.ini): " + strings.Join(parts, " • ")
}
