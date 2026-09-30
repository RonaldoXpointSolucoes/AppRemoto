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
	parentPath := filepath.Dir(path)
	if err := validateIdentityDirectoryChain(parentPath); err != nil {
		return err
	}
	root, err := os.OpenRoot(parentPath)
	if err != nil {
		return err
	}
	defer root.Close()
	parent, err := root.Open(".")
	if err != nil {
		return err
	}
	defer parent.Close()
	pathParentInfo, err := os.Lstat(parentPath)
	if err != nil {
		return err
	}
	pinnedParentInfo, err := parent.Stat()
	if err != nil {
		return err
	}
	if pathParentInfo.Mode()&os.ModeSymlink != 0 || !os.SameFile(pathParentInfo, pinnedParentInfo) {
		return errors.New("identity parent changed while being pinned")
	}

	leaf := filepath.Base(path)
	created := false
	leafInfo, err := root.Lstat(leaf)
	if errors.Is(err, os.ErrNotExist) {
		if err := root.Mkdir(leaf, 0o700); err != nil {
			return err
		}
		created = true
	} else if err != nil {
		return err
	} else if leafInfo.Mode()&os.ModeSymlink != 0 || !leafInfo.IsDir() {
		return errors.New("identity directory is not a trusted directory")
	}
	leafRoot, err := root.OpenRoot(leaf)
	if err != nil {
		return err
	}
	defer leafRoot.Close()
	directory, err := leafRoot.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	pinnedInfo, err := directory.Stat()
	if err != nil {
		return err
	}
	leafInfo, err = root.Lstat(leaf)
	if err != nil || leafInfo.Mode()&os.ModeSymlink != 0 || !os.SameFile(leafInfo, pinnedInfo) {
		return errors.New("identity directory changed while being pinned")
	}
	if !created {
		if err := validateDedicatedIdentityDirectoryOther(leafRoot, directory); err != nil {
			return err
		}
	}
	if err := directory.Chmod(0o700); err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		return err
	}
	info, err := directory.Stat()
	if err != nil {
		return err
	}
	if info.Mode().Perm() != 0o700 {
		return errors.New("identity directory permissions are not restricted")
	}
	leafInfo, err = root.Lstat(leaf)
	if err != nil || leafInfo.Mode()&os.ModeSymlink != 0 || !os.SameFile(leafInfo, info) {
		return errors.New("identity directory changed while permissions were applied")
	}
	return nil
}

func validateDedicatedIdentityDirectoryOther(root *os.Root, directory *os.File) error {
	entries, err := directory.ReadDir(-1)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !isKnownIdentityArtifact(entry.Name()) {
			return errors.New("identity directory contains unrelated entries")
		}
		info, err := root.Lstat(entry.Name())
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return errors.New("identity directory contains an unsafe state artifact")
		}
	}
	return nil
}

func restrictIdentityDirectory(path string) error { return prepareIdentityDirectory(path) }

func validateIdentityPath(path string) error {
	parent := filepath.Dir(path)
	if err := validateIdentityDirectoryChain(parent); err != nil {
		return err
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

func validateIdentityDirectoryChain(parent string) error {
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
