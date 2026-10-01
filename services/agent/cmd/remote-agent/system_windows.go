//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/windows"
)

func collectSystemMetadata() (string, string, string, error) {
	hostname, err := os.Hostname()
	hostname = strings.TrimSpace(hostname)
	if err != nil || hostname == "" || len(hostname) > 255 {
		return "", "", "", errors.New("invalid hostname")
	}
	version := windows.RtlGetVersion()
	if version == nil {
		return "", "", "", errors.New("Windows version unavailable")
	}
	return hostname, "Windows", fmt.Sprintf("%d.%d.%d", version.MajorVersion, version.MinorVersion, version.BuildNumber), nil
}
