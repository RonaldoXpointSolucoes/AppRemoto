//go:build windows

package setup

import (
	"fmt"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
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
	fallback := ""
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipv4 := ipnet.IP.To4(); ipv4 != nil {
				ipStr := ipv4.String()
				// Ignora endereços de link-local (169.254.*)
				if strings.HasPrefix(ipStr, "169.254.") {
					continue
				}
				// Prioriza IPs de rede privada local RFC 1918 (192.168.*, 10.*, 172.16-31.*)
				if ipv4.IsPrivate() {
					return ipStr
				}
				if fallback == "" {
					fallback = ipStr
				}
			}
		}
	}
	return fallback
}

type memoryStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

type fileTime struct {
	dwLowDateTime  uint32
	dwHighDateTime uint32
}

func (ft fileTime) uint64() uint64 {
	return (uint64(ft.dwHighDateTime) << 32) | uint64(ft.dwLowDateTime)
}

var (
	kernel32SysInfo            = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx   = kernel32SysInfo.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes         = kernel32SysInfo.NewProc("GetSystemTimes")
	cpuSampleMu                sync.Mutex
	lastCPUIdle, lastCPUKernel uint64
	lastCPUUser                uint64
	hasCPUSample               bool
)

func readCPUModelWindows() string {
	cores := runtime.NumCPU()
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\Description\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err == nil {
		defer k.Close()
		if val, _, err := k.GetStringValue("ProcessorNameString"); err == nil {
			clean := strings.Join(strings.Fields(strings.TrimSpace(val)), " ")
			if clean != "" {
				label := fmt.Sprintf("%s (%d núcleos)", clean, cores)
				if len(label) > 96 {
					label = label[:96]
				}
				return label
			}
		}
	}
	return fmt.Sprintf("Processador x64 (%d núcleos)", cores)
}

func sampleSystemTimes() (idle, kernel, user uint64, ok bool) {
	var i, k, u fileTime
	r1, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&i)),
		uintptr(unsafe.Pointer(&k)),
		uintptr(unsafe.Pointer(&u)),
	)
	if r1 == 0 {
		return 0, 0, 0, false
	}
	return i.uint64(), k.uint64(), u.uint64(), true
}

func collectCPUUsagePctWindows() string {
	cpuSampleMu.Lock()
	defer cpuSampleMu.Unlock()

	idle1, kernel1, user1, ok := sampleSystemTimes()
	if !ok {
		return ""
	}
	if !hasCPUSample {
		time.Sleep(100 * time.Millisecond)
		idle2, kernel2, user2, ok2 := sampleSystemTimes()
		if !ok2 {
			return ""
		}
		lastCPUIdle, lastCPUKernel, lastCPUUser, hasCPUSample = idle2, kernel2, user2, true
		return formatCPUPercent(idle1, kernel1, user1, idle2, kernel2, user2)
	}
	prevIdle, prevKernel, prevUser := lastCPUIdle, lastCPUKernel, lastCPUUser
	lastCPUIdle, lastCPUKernel, lastCPUUser = idle1, kernel1, user1
	return formatCPUPercent(prevIdle, prevKernel, prevUser, idle1, kernel1, user1)
}

func formatCPUPercent(idle1, kernel1, user1, idle2, kernel2, user2 uint64) string {
	idleDelta := idle2 - idle1
	kernelDelta := kernel2 - kernel1
	userDelta := user2 - user1
	total := kernelDelta + userDelta
	if total == 0 || total < idleDelta {
		return "1%"
	}
	busy := total - idleDelta
	pct := int((float64(busy)/float64(total))*100.0 + 0.5)
	if pct < 1 {
		pct = 1
	}
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf("%d%%", pct)
}

func collectMemoryTelemetryWindows() (totalGb, usedGb, pctStr string) {
	var mem memoryStatusEx
	mem.dwLength = uint32(unsafe.Sizeof(mem))
	r1, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem)))
	if r1 == 0 || mem.ullTotalPhys == 0 {
		return "", "", ""
	}
	total := float64(mem.ullTotalPhys) / (1024 * 1024 * 1024)
	used := float64(mem.ullTotalPhys-mem.ullAvailPhys) / (1024 * 1024 * 1024)
	pct := mem.dwMemoryLoad
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf("%.1f GB", total), fmt.Sprintf("%.1f GB", used), fmt.Sprintf("%d%%", pct)
}

func collectDiskTelemetryWindows() (totalGb, usedGb, freeGb, pctStr string) {
	drive := os.Getenv("SystemDrive")
	if drive == "" {
		drive = "C:"
	}
	if !strings.HasSuffix(drive, `\`) {
		drive += `\`
	}
	drivePtr, err := windows.UTF16PtrFromString(drive)
	if err != nil {
		return "", "", "", ""
	}
	var freeAvail, totalBytes, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(drivePtr, &freeAvail, &totalBytes, &totalFree); err != nil || totalBytes == 0 {
		return "", "", "", ""
	}
	total := float64(totalBytes) / (1024 * 1024 * 1024)
	free := float64(totalFree) / (1024 * 1024 * 1024)
	used := total - free
	if used < 0 {
		used = 0
	}
	pct := int((used/total)*100.0 + 0.5)
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf("%.0f GB", total), fmt.Sprintf("%.0f GB", used), fmt.Sprintf("%.0f GB", free), fmt.Sprintf("%d%%", pct)
}

func collectNetworkTopologyWindows() (localIP, subnetCIDR, gatewayIP, netType string) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", "", "", ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok || ipnet.IP.IsLoopback() {
				continue
			}
			ipv4 := ipnet.IP.To4()
			if ipv4 == nil {
				continue
			}
			ipStr := ipv4.String()
			if strings.HasPrefix(ipStr, "169.254.") || !ipv4.IsPrivate() {
				continue
			}
			ones, bits := ipnet.Mask.Size()
			if bits == 32 && ones > 0 {
				networkIP := ipv4.Mask(ipnet.Mask)
				subnetCIDR = fmt.Sprintf("%s/%d", networkIP.String(), ones)
			}
			lowerName := strings.ToLower(iface.Name)
			if strings.Contains(lowerName, "wi-fi") || strings.Contains(lowerName, "wifi") || strings.Contains(lowerName, "wlan") || strings.Contains(lowerName, "wireless") {
				netType = "Wi-Fi"
			} else {
				netType = "Cabo (Ethernet)"
			}
			gw := findGatewayForIPv4(ipStr, ipv4)
			return ipStr, subnetCIDR, gw, netType
		}
	}
	return "", "", "", ""
}

func findGatewayForIPv4(ipStr string, ipv4 net.IP) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces`, registry.ENUMERATE_SUB_KEYS)
	if err == nil {
		defer k.Close()
		if subkeys, err := k.ReadSubKeyNames(-1); err == nil {
			for _, sub := range subkeys {
				sk, err := registry.OpenKey(k, sub, registry.QUERY_VALUE)
				if err != nil {
					continue
				}
				match := false
				if dhcpIP, _, err := sk.GetStringValue("DhcpIPAddress"); err == nil && strings.TrimSpace(dhcpIP) == ipStr {
					match = true
				}
				if !match {
					if ips, _, err := sk.GetStringsValue("IPAddress"); err == nil {
						for _, item := range ips {
							if strings.TrimSpace(item) == ipStr {
								match = true
								break
							}
						}
					}
				}
				if match {
					for _, gwKey := range []string{"DhcpDefaultGateway", "DefaultGateway"} {
						if gws, _, err := sk.GetStringsValue(gwKey); err == nil {
							for _, g := range gws {
								g = strings.TrimSpace(g)
								if g != "" && g != "0.0.0.0" {
									sk.Close()
									return g
								}
							}
						}
					}
				}
				sk.Close()
			}
		}
	}
	if len(ipv4) == 4 {
		return fmt.Sprintf("%d.%d.%d.1", ipv4[0], ipv4[1], ipv4[2])
	}
	return ""
}

// EnrichDataDivasWithTelemetry anexa métricas em tempo real de CPU, Memória RAM, Disco (HD)
// e topologia de rede local (sub-rede CIDR, gateway do roteador e tipo de conexão).
func EnrichDataDivasWithTelemetry(info *api.DataDivasInfo) *api.DataDivasInfo {
	if info == nil {
		info = &api.DataDivasInfo{}
	}
	if model := readCPUModelWindows(); model != "" {
		info.CPUModelo = model
	}
	if cpuPct := collectCPUUsagePctWindows(); cpuPct != "" {
		info.CPUUsoPct = cpuPct
	}
	if ramTot, ramUsed, ramPct := collectMemoryTelemetryWindows(); ramTot != "" {
		info.RAMTotalGb = ramTot
		info.RAMUsadaGb = ramUsed
		info.RAMUsoPct = ramPct
	}
	if dTot, dUsed, dFree, dPct := collectDiskTelemetryWindows(); dTot != "" {
		info.DiscoTotalGb = dTot
		info.DiscoUsadoGb = dUsed
		info.DiscoLivreGb = dFree
		info.DiscoUsoPct = dPct
	}
	if lanIP, cidr, gw, netType := collectNetworkTopologyWindows(); lanIP != "" {
		if info.IPMaq == "" {
			info.IPMaq = lanIP
		}
		if cidr != "" {
			info.RedeSubrede = cidr
		}
		if gw != "" {
			info.RedeGateway = gw
		}
		if netType != "" {
			info.RedeTipo = netType
		}
	}
	return info
}
