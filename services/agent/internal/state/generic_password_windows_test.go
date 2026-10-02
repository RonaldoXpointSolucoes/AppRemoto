//go:build windows

package state

import (
	"bytes"
	"path/filepath"
	"testing"
)

func TestGenericPasswordJournalAtomicReplacementRetainsRestrictedState(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "identity")
	if err := PrepareIdentityDirectory(directory); err != nil {
		t.Fatal(err)
	}
	for _, value := range [][]byte{[]byte("synthetic-encrypted-pending"), []byte("synthetic-encrypted-confirmed")} {
		if err := ReplaceGenericPassword(directory, value); err != nil {
			t.Fatal(err)
		}
		read, err := LoadArtifact(directory, "generic-password.json", 4096)
		if err != nil || !bytes.Equal(read, value) {
			t.Fatalf("rotation journal mismatch: %v", err)
		}
	}
}
