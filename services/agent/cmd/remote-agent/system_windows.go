//go:build windows

package main

import (
	"errors"
	"os"
	"strings"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/setup"
)

func collectSystemMetadata() (string, string, string, error) {
	hostname, err := os.Hostname()
	hostname = strings.TrimSpace(hostname)
	if err != nil || hostname == "" || len(hostname) > 255 {
		return "", "", "", errors.New("invalid hostname")
	}
	osName, osVersion := setup.CollectSystemInfo()
	return hostname, osName, osVersion, nil
}

