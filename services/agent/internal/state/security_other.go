//go:build !windows

package state

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func validateIdentityPath(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	parent := filepath.Dir(abs)
	for current := parent; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("identity path contains a symlink")
		}
		if !info.IsDir() {
			return errors.New("identity parent path is not a directory")
		}
		next := filepath.Dir(current)
		if next == current {
			break
		}
	}
	info, err := os.Lstat(abs)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return errors.New("identity file is not a regular file")
	}
	return nil
}

func restrictIdentityFile(path string) error {
	return os.Chmod(path, 0o600)
}

func validateRestrictedACL(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return errors.New("identity permissions allow group or other access")
	}
	return nil
}

func openValidatedIdentity(path string) (io.ReadCloser, error) {
	if err := validateRestrictedACL(path); err != nil {
		return nil, err
	}
	return os.Open(path)
}

func lstatRegularIdentityFile(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("temporary identity is not a regular file")
	}
	return info, nil
}

func syncIdentityDirectory(dir string) error {
	directory, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("flush directory: %w", err)
	}
	return nil
}
