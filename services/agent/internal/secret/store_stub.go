//go:build !windows

package secret

import "errors"

var ErrUnsupported = errors.ErrUnsupported

func Protect([]byte) ([]byte, error) {
	return nil, ErrUnsupported
}

func Unprotect([]byte) ([]byte, error) {
	return nil, ErrUnsupported
}
