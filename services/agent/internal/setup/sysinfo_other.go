//go:build !windows

package setup

// CollectSystemInfo fallback para sistemas não-Windows
func CollectSystemInfo() (operatingSystem string, osVersion string) {
	return "Windows", "11.0"
}
