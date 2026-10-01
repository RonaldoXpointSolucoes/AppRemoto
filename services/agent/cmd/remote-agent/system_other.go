//go:build !windows

package main

import "errors"

func collectSystemMetadata() (string, string, string, error) {
	return "", "", "", errors.ErrUnsupported
}
