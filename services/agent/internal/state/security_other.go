//go:build !windows

package state

import (
	"errors"
	"os"
	"path/filepath"
)

// The non-Windows fallback relies on lstat plus Unix directory/file handles.
// Windows receives the stronger no-share-delete and file-ID verification path.
type identityDirectory struct {
	file *os.File
	path string
}

func openIdentityDirectory(path string) (*identityDirectory, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.IsDir() {
		file.Close()
		if err != nil {
			return nil, err
		}
		return nil, errors.New("identity directory is not a directory")
	}
	return &identityDirectory{file: file, path: path}, nil
}

func (directory *identityDirectory) Sync() error  { return directory.file.Sync() }
func (directory *identityDirectory) Close() error { return directory.file.Close() }

func prepareIdentityDirectory(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("identity directory is not a directory")
	}
	if err := file.Chmod(0o700); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	info, err = file.Stat()
	if err != nil {
		return err
	}
	if info.Mode().Perm() != 0o700 {
		return errors.New("identity directory permissions are not restricted")
	}
	return nil
}

func restrictIdentityDirectory(path string) error { return prepareIdentityDirectory(path) }

func validateIdentityPath(path string) error {
	parent := filepath.Dir(path)
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
	info, err := os.Lstat(path)
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

func openValidatedIdentity(path string) (*os.File, error) {
	if err := validateRestrictedACL(path); err != nil {
		return nil, err
	}
	return os.Open(path)
}

func validateRestrictedIdentityHandle(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return errors.New("identity file permissions are not restricted")
	}
	return nil
}

func createRestrictedIdentityTemp(dir string) (*os.File, string, error) {
	file, err := os.CreateTemp(dir, ".identity-*.tmp")
	if err != nil {
		return nil, "", err
	}
	path := file.Name()
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		os.Remove(path)
		return nil, "", err
	}
	return file, path, nil
}

func verifySameIdentityFile(temporary, published *os.File) error {
	temporaryInfo, err := temporary.Stat()
	if err != nil {
		return err
	}
	publishedInfo, err := published.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(temporaryInfo, publishedInfo) {
		return errors.New("published identity does not match temporary file")
	}
	return nil
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
