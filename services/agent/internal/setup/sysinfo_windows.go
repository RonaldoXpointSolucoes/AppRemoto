//go:build windows

package setup

import (
	"fmt"
	"net"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// CollectSystemInfo captura o nome amigável do sistema operacional (Windows 10/11 com edição),
// a versão/build detalhada (ex: 23H2 Build 22631.4317) e o endereço IP local da máquina.
func CollectSystemInfo() (operatingSystem string, osVersion string) {
	v := windows.RtlGetVersion()
	major := uint32(10)
	minor := uint32(0)
	build := uint32(0)
	if v != nil {
		major = v.MajorVersion
		minor = v.MinorVersion
		build = v.BuildNumber
	}

	productName := ""
	displayVersion := ""
	var ubr uint32

	// Lê chaves do registro oficial do Windows
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err == nil {
		defer k.Close()

		if val, _, err := k.GetStringValue("ProductName"); err == nil {
			productName = strings.TrimSpace(val)
		}
		if val, _, err := k.GetStringValue("DisplayVersion"); err == nil {
			displayVersion = strings.TrimSpace(val)
		} else if val, _, err := k.GetStringValue("ReleaseId"); err == nil {
			displayVersion = strings.TrimSpace(val)
		}
		if val, _, err := k.GetIntegerValue("UBR"); err == nil {
			ubr = uint32(val)
		}
	}

	// Trata a nomenclatura do Windows 10 vs Windows 11
	// No Windows 11 (Build >= 22000), a Microsoft manteve o kernel como 10.0 e muitas vezes ProductName como "Windows 10..."
	if build >= 22000 {
		if strings.HasPrefix(productName, "Windows 10") {
			productName = strings.Replace(productName, "Windows 10", "Windows 11", 1)
		} else if productName == "" {
			productName = "Windows 11"
		}
	} else if productName == "" {
		if major == 10 {
			productName = "Windows 10"
		} else {
			productName = fmt.Sprintf("Windows %d.%d", major, minor)
		}
	}

	// Garante tamanho máximo de 64 caracteres para operatingSystem conforme schema da API
	if len(productName) > 64 {
		productName = productName[:64]
	}
	operatingSystem = productName

	// Coleta o IP local da máquina (IPv4 não-loopback)
	localIP := getPrimaryLocalIPv4()

	// Monta versão detalhada: "23H2 (Build 22631.4317) · IP 192.168.0.129"
	var versionParts []string
	if displayVersion != "" {
		versionParts = append(versionParts, displayVersion)
	}

	if ubr > 0 && build > 0 {
		versionParts = append(versionParts, fmt.Sprintf("(Build %d.%d)", build, ubr))
	} else if build > 0 {
		versionParts = append(versionParts, fmt.Sprintf("(Build %d)", build))
	} else {
		versionParts = append(versionParts, fmt.Sprintf("%d.%d", major, minor))
	}

	assembledVersion := strings.Join(versionParts, " ")
	if localIP != "" {
		assembledVersion = fmt.Sprintf("%s · IP %s", assembledVersion, localIP)
	}

	// Garante tamanho máximo de 128 caracteres conforme schema da API
	if len(assembledVersion) > 128 {
		assembledVersion = assembledVersion[:128]
	}
	osVersion = assembledVersion

	return operatingSystem, osVersion
}

func getPrimaryLocalIPv4() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipv4 := ipnet.IP.To4(); ipv4 != nil {
				ipStr := ipv4.String()
				// Ignora endereços de link-local (169.254.*)
				if !strings.HasPrefix(ipStr, "169.254.") {
					return ipStr
				}
			}
		}
	}
	return ""
}
