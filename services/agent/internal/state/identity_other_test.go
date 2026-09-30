//go:build !windows

package state

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUnsupportedIdentityPersistenceDoesNotMutateFilesystem(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "existing"}[existing], func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "state")
			path := filepath.Join(dir, "identity.json")
			stale := filepath.Join(dir, ".identity-old.tmp")
			content := []byte(`{"device_uuid":"388f7765-7ec2-423f-8fa7-d3135d4d0467"}`)
			var before os.FileInfo
			if existing {
				if err := os.Mkdir(dir, 0o750); err != nil {
					t.Fatal(err)
				}
				for _, name := range []string{path, stale} {
					if err := os.WriteFile(name, content, 0o600); err != nil {
						t.Fatal(err)
					}
				}
				old := time.Now().Add(-48 * time.Hour)
				if err := os.Chtimes(stale, old, old); err != nil {
					t.Fatal(err)
				}
				var err error
				before, err = os.Stat(dir)
				if err != nil {
					t.Fatal(err)
				}
			}
			if err := PrepareIdentityDirectory(dir); !errors.Is(err, errors.ErrUnsupported) {
				t.Errorf("PrepareIdentityDirectory() = %v, want ErrUnsupported", err)
			}
			if identity, err := LoadOrCreateIdentity(path); !errors.Is(err, errors.ErrUnsupported) || identity != (Identity{}) {
				t.Errorf("LoadOrCreateIdentity() = %v, %v, want zero identity and ErrUnsupported", identity, err)
			}
			if !existing {
				if _, err := os.Lstat(dir); !errors.Is(err, os.ErrNotExist) {
					t.Errorf("unsupported runtime created a directory: %v", err)
				}
				return
			}
			after, err := os.Stat(dir)
			if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() {
				t.Errorf("unsupported runtime replaced directory or changed permissions: %v", err)
			}
			for _, name := range []string{path, stale} {
				got, err := os.ReadFile(name)
				if err != nil || string(got) != string(content) {
					t.Errorf("unsupported runtime changed %s: %q, %v", name, got, err)
				}
			}
		})
	}
}
