//go:build !windows

package state

import (
	"errors"
	"fmt"
	"os"
)

// POSIX directory handles do not exclude rename. Until an equivalent supported
// persistence contract exists, reject operations before opening or mutating paths.
var errIdentityPlatform = fmt.Errorf("identity persistence requires Windows: %w", errors.ErrUnsupported)

type identityDirectory struct {
	path string
}

func openIdentityDirectory(string) (*identityDirectory, error) { return nil, errIdentityPlatform }
func (*identityDirectory) Sync() error                         { return errIdentityPlatform }
func (*identityDirectory) Close() error                        { return nil }
func prepareIdentityDirectory(string) error                    { return errIdentityPlatform }
func restrictIdentityDirectory(string) error                   { return errIdentityPlatform }
func validateIdentityPath(string) error                        { return errIdentityPlatform }
func restrictIdentityFile(string) error                        { return errIdentityPlatform }
func validateRestrictedACL(string) error                       { return errIdentityPlatform }
func openValidatedIdentity(string) (*os.File, error)           { return nil, errIdentityPlatform }
func validateRestrictedIdentityHandle(*os.File) error          { return errIdentityPlatform }
func createRestrictedIdentityTemp(string) (*os.File, string, error) {
	return nil, "", errIdentityPlatform
}
func lstatRegularIdentityFile(string) (os.FileInfo, error) { return nil, errIdentityPlatform }

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
