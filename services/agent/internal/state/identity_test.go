package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestLoadOrCreateIdentityCreatesUUID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")

	identity, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatalf("LoadOrCreateIdentity() error = %v", err)
	}
	if !uuidV4Pattern.MatchString(identity.DeviceUUID) {
		t.Fatalf("DeviceUUID = %q, want a standards-compliant UUID v4", identity.DeviceUUID)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var persisted Identity
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("persisted identity is not JSON: %v", err)
	}
	if persisted != identity {
		t.Fatalf("persisted identity = %#v, want %#v", persisted, identity)
	}
}

func TestLoadOrCreateIdentityReloadsExistingIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
	first, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatalf("first LoadOrCreateIdentity() error = %v", err)
	}

	second, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatalf("second LoadOrCreateIdentity() error = %v", err)
	}
	if second != first {
		t.Fatalf("second identity = %#v, want %#v", second, first)
	}
}

func TestLoadOrCreateIdentityPublishesOneCompleteIdentityAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
	const callers = 24
	identities := make(chan Identity, callers)
	errors := make(chan error, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup

	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			identity, err := LoadOrCreateIdentity(path)
			identities <- identity
			errors <- err
		}()
	}
	close(start)
	wg.Wait()
	close(identities)
	close(errors)

	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent LoadOrCreateIdentity() error = %v", err)
		}
	}
	var winner Identity
	for identity := range identities {
		if winner.DeviceUUID == "" {
			winner = identity
		}
		if identity != winner {
			t.Fatalf("concurrent identity = %#v, want published winner %#v", identity, winner)
		}
	}

	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(path) {
		t.Fatalf("identity directory entries = %v, want only %q", entryNames(entries), filepath.Base(path))
	}
}

func TestLoadOrCreateIdentityRejectsAndPreservesMalformedState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
	original := []byte(`{"device_uuid":"not-a-uuid"}`)
	writeIdentityFixture(t, path, original)

	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want malformed state error")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(after) != string(original) {
		t.Fatalf("malformed state was replaced: got %q, want %q", after, original)
	}
}

func TestLoadOrCreateIdentityRejectsNonCanonicalState(t *testing.T) {
	const uuid = "388f7765-7ec2-423f-8fa7-d3135d4d0467"
	tests := map[string]string{
		"duplicate key": `{"device_uuid":"` + uuid + `","device_uuid":"` + uuid + `"}`,
		"case alias":    `{"Device_UUID":"` + uuid + `"}`,
		"escaped key":   `{"\u0064evice_uuid":"` + uuid + `"}`,
		"extra key":     `{"device_uuid":"` + uuid + `","extra":true}`,
		"trailing JSON": `{"device_uuid":"` + uuid + `"}{}`,
		"non-string":    `{"device_uuid":1}`,
	}

	for name, content := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeIdentity([]byte(content)); err == nil {
				t.Fatal("decodeIdentity() error = nil, want canonical state error")
			}
		})
	}
}

func TestLoadOrCreateIdentityRejectsOversizedState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
	original := []byte(`{"device_uuid":"` + strings.Repeat("a", maxIdentityBytes) + `"}`)
	writeIdentityFixture(t, path, original)

	if _, err := LoadOrCreateIdentity(path); err == nil {
		t.Fatal("LoadOrCreateIdentity() error = nil, want oversized state error")
	}
}

func TestLoadOrCreateIdentityCleansStaleTemporaryFileAfterRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "identity.json")
	stalePath := filepath.Join(dir, ".identity-abandoned.tmp")
	if err := os.WriteFile(stalePath, []byte("partial"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	old := time.Now().Add(-staleIdentityAge - time.Minute)
	if err := os.Chtimes(stalePath, old, old); err != nil {
		t.Fatalf("Chtimes() error = %v", err)
	}

	if _, err := LoadOrCreateIdentity(path); err != nil {
		t.Fatalf("LoadOrCreateIdentity() error = %v", err)
	}
	if _, err := os.Lstat(stalePath); !os.IsNotExist(err) {
		t.Fatalf("stale temporary file still exists, Lstat() error = %v", err)
	}
}

func TestLoadOrCreateIdentityPreservesRecentTemporaryFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "identity.json")
	recentPath := filepath.Join(dir, ".identity-active.tmp")
	if err := os.WriteFile(recentPath, []byte("in progress"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if _, err := LoadOrCreateIdentity(path); err != nil {
		t.Fatalf("LoadOrCreateIdentity() error = %v", err)
	}
	if _, err := os.Lstat(recentPath); err != nil {
		t.Fatalf("recent temporary file was removed: %v", err)
	}
}

func TestLoadOrCreateIdentityUsesRestrictivePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
	if _, err := LoadOrCreateIdentity(path); err != nil {
		t.Fatalf("LoadOrCreateIdentity() error = %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("identity permissions = %04o, want no group or other access", info.Mode().Perm())
	}
	if info.Mode().Perm()&0o200 == 0 {
		t.Fatalf("identity permissions = %04o, want owner write access", info.Mode().Perm())
	}
}

func entryNames(entries []os.DirEntry) []string {
	names := make([]string, len(entries))
	for i, entry := range entries {
		names[i] = entry.Name()
	}
	return names
}

func writeIdentityFixture(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if err := restrictIdentityFile(path); err != nil {
		t.Fatalf("restrictIdentityFile() error = %v", err)
	}
}
