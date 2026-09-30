//go:build !windows

package rustdesk

import "errors"

func platformSupported() bool { return false }

func knownInstallRoots() (string, string, string, string, error) {
	return "", "", "", "", errors.ErrUnsupported
}

func validatePlatformLocalPath(string) error { return errors.ErrUnsupported }
