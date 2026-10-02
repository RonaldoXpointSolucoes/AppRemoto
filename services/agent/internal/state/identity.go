package state

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Identity is the durable, non-secret identity of an agent installation.
type Identity struct {
	DeviceUUID string `json:"device_uuid"`
}

var validUUIDV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

var ErrIdentityOwner = errors.New("identity owner is not current user or SYSTEM")

const (
	maxIdentityBytes = 1024
	staleIdentityAge = 24 * time.Hour
)

// PrepareIdentityDirectory creates or hardens one dedicated identity directory.
// It changes only path; callers remain responsible for choosing a dedicated
// directory and must call this before LoadOrCreateIdentity.
// Non-Windows runtimes return errors.ErrUnsupported without touching the filesystem.
func PrepareIdentityDirectory(path string) error {
	canonicalPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve identity directory: %w", err)
	}
	canonicalPath = filepath.Clean(canonicalPath)
	if filepath.Dir(canonicalPath) == canonicalPath {
		return errors.New("identity directory must not be a filesystem root")
	}
	if err := prepareIdentityDirectory(canonicalPath); err != nil {
		return fmt.Errorf("harden identity directory: %w", err)
	}
	return nil
}

func isKnownIdentityArtifact(name string) bool {
	if name == "identity.json" || name == "enrollment-pending.json" ||
		name == "enrollment-credentials.json" || name == "rustdesk-configured.json" || name == "generic-password.json" {
		return true
	}
	if !strings.HasPrefix(name, ".identity-") || !strings.HasSuffix(name, ".tmp") {
		return false
	}
	randomPart := strings.TrimSuffix(strings.TrimPrefix(name, ".identity-"), ".tmp")
	if len(randomPart) == 0 || len(randomPart) > 64 {
		return false
	}
	for _, character := range randomPart {
		if character < '0' || character > '9' {
			if character < 'a' || character > 'z' {
				return false
			}
		}
	}
	return true
}

// ReplaceGenericPassword atomically advances the dedicated password-rotation
// journal. The enrollment identity and original append-only credentials are
// never replaced. Readers verify the same current-user/SYSTEM ownership rules.
func ReplaceGenericPassword(directory string, data []byte) error {
	canonical, err := filepath.Abs(directory)
	if err != nil {
		return errors.New("resolve rotation directory")
	}
	canonical = filepath.Clean(canonical)
	dir, err := openIdentityDirectory(canonical)
	if err != nil {
		return err
	}
	defer dir.Close()
	target := filepath.Join(canonical, "generic-password.json")
	if err = validateIdentityPath(target); err != nil {
		return err
	}
	if old, e := openValidatedIdentity(target); e == nil {
		old.Close()
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	tmp, path, err := createRestrictedIdentityTemp(canonical)
	if err != nil {
		return err
	}
	defer os.Remove(path)
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Sync()
	}
	if err == nil {
		err = validateRestrictedIdentityHandle(tmp)
	}
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(path, target); err != nil {
		return err
	}
	verify, err := openValidatedIdentity(target)
	if err != nil {
		return err
	}
	defer verify.Close()
	actual, err := io.ReadAll(io.LimitReader(verify, int64(len(data))+1))
	defer clear(actual)
	if err != nil || !bytes.Equal(actual, data) {
		return errors.New("verify rotation journal")
	}
	return dir.Sync()
}

// PublishArtifact atomically publishes one append-only agent-state artifact in
// a prepared identity directory. Existing artifacts are never replaced.
func PublishArtifact(directory, name string, data []byte) error {
	if !isKnownIdentityArtifact(name) || name == "identity.json" || strings.HasPrefix(name, ".") {
		return errors.New("invalid agent state artifact name")
	}
	canonicalDirectory, err := filepath.Abs(directory)
	if err != nil {
		return errors.New("resolve agent state directory")
	}
	canonicalDirectory = filepath.Clean(canonicalDirectory)
	directoryHandle, err := openIdentityDirectory(canonicalDirectory)
	if err != nil {
		return fmt.Errorf("open agent state directory: %w", err)
	}
	defer directoryHandle.Close()

	temporary, temporaryPath, err := createRestrictedIdentityTemp(canonicalDirectory)
	if err != nil {
		return fmt.Errorf("create temporary agent state: %w", err)
	}
	defer os.Remove(temporaryPath)
	defer temporary.Close()
	if _, err := temporary.Write(data); err != nil {
		return errors.New("write temporary agent state")
	}
	if err := temporary.Sync(); err != nil {
		return errors.New("sync temporary agent state")
	}
	if err := validateRestrictedIdentityHandle(temporary); err != nil {
		return errors.New("validate temporary agent state")
	}
	target := filepath.Join(canonicalDirectory, name)
	if err := validateIdentityPath(target); err != nil {
		return errors.New("validate agent state path")
	}
	if err := os.Link(temporaryPath, target); err != nil {
		return fmt.Errorf("publish agent state: %w", err)
	}
	published, err := openValidatedIdentity(target)
	if err != nil {
		return errors.New("verify published agent state")
	}
	defer published.Close()
	if err := verifySameIdentityFile(temporary, published); err != nil {
		return errors.New("verify published agent state")
	}
	if err := directoryHandle.Sync(); err != nil {
		return errors.New("sync agent state directory")
	}
	return nil
}

// LoadArtifact reads one restricted agent-state artifact through the same ACL
// and reparse-point checks used for identity persistence.
func LoadArtifact(directory, name string, maximum int64) ([]byte, error) {
	if !isKnownIdentityArtifact(name) || name == "identity.json" || strings.HasPrefix(name, ".") || maximum <= 0 {
		return nil, errors.New("invalid agent state artifact request")
	}
	canonicalDirectory, err := filepath.Abs(directory)
	if err != nil {
		return nil, errors.New("resolve agent state directory")
	}
	canonicalDirectory = filepath.Clean(canonicalDirectory)
	directoryHandle, err := openIdentityDirectory(canonicalDirectory)
	if err != nil {
		return nil, errors.New("open agent state directory")
	}
	defer directoryHandle.Close()
	path := filepath.Join(canonicalDirectory, name)
	file, err := openValidatedIdentity(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil {
		return nil, errors.New("read agent state artifact")
	}
	if int64(len(data)) > maximum {
		clear(data)
		return nil, errors.New("agent state artifact exceeds size limit")
	}
	return data, nil
}

// LoadOrCreateIdentity loads an existing identity or atomically creates one.
// On Windows, the parent must be owned by the current user, SYSTEM, or
// Administrators and must not grant write or delete access to other principals.
// Non-Windows runtimes return errors.ErrUnsupported without touching the filesystem.
func LoadOrCreateIdentity(path string) (Identity, error) {
	canonicalPath, err := filepath.Abs(path)
	if err != nil {
		return Identity{}, fmt.Errorf("resolve identity path: %w", err)
	}
	canonicalPath = filepath.Clean(canonicalPath)
	if err := validateIdentityPath(canonicalPath); err != nil {
		return Identity{}, err
	}
	directory, err := openIdentityDirectory(filepath.Dir(canonicalPath))
	if err != nil {
		return Identity{}, fmt.Errorf("open identity directory: %w", err)
	}
	defer directory.Close()

	if err := cleanStaleIdentityFiles(directory, time.Now()); err != nil {
		return Identity{}, err
	}

	identity, err := loadIdentity(canonicalPath)
	if err == nil {
		return identity, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return Identity{}, err
	}

	identity, err = newIdentity()
	if err != nil {
		return Identity{}, err
	}
	if err := publishIdentity(canonicalPath, identity, directory); err != nil {
		if errors.Is(err, os.ErrExist) {
			return loadIdentity(canonicalPath)
		}
		return Identity{}, err
	}
	return identity, nil
}

func loadIdentity(path string) (Identity, error) {
	file, err := openValidatedIdentity(path)
	if err != nil {
		return Identity{}, fmt.Errorf("read identity: %w", err)
	}
	defer file.Close()

	reader := bufio.NewReader(io.LimitReader(file, maxIdentityBytes+1))
	data, err := io.ReadAll(reader)
	if err != nil {
		return Identity{}, fmt.Errorf("read identity: %w", err)
	}
	if len(data) > maxIdentityBytes {
		return Identity{}, errors.New("decode identity: state exceeds size limit")
	}

	identity, err := decodeIdentity(data)
	if err != nil {
		return Identity{}, fmt.Errorf("decode identity: %w", err)
	}
	return identity, nil
}

func decodeIdentity(data []byte) (Identity, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))

	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return Identity{}, errors.New("identity must be a JSON object")
	}
	keyStart := decoder.InputOffset()
	key, err := decoder.Token()
	keyEnd := decoder.InputOffset()
	keyLiteral := strings.TrimSpace(string(data[keyStart:keyEnd]))
	if err != nil || key != "device_uuid" || keyLiteral != `"device_uuid"` {
		return Identity{}, errors.New("identity must contain only device_uuid")
	}
	value, err := decoder.Token()
	deviceUUID, ok := value.(string)
	if err != nil || !ok {
		return Identity{}, errors.New("device_uuid must be a string")
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') {
		return Identity{}, errors.New("identity must contain exactly one field")
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Identity{}, err
	}

	identity := Identity{DeviceUUID: deviceUUID}
	if !validUUIDV4.MatchString(identity.DeviceUUID) {
		return Identity{}, errors.New("invalid device UUID")
	}
	return identity, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected data after identity")
		}
		return err
	}
	return nil
}

func newIdentity() (Identity, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return Identity{}, fmt.Errorf("generate identity: %w", err)
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80

	var encoded [36]byte
	hex.Encode(encoded[0:8], value[0:4])
	encoded[8] = '-'
	hex.Encode(encoded[9:13], value[4:6])
	encoded[13] = '-'
	hex.Encode(encoded[14:18], value[6:8])
	encoded[18] = '-'
	hex.Encode(encoded[19:23], value[8:10])
	encoded[23] = '-'
	hex.Encode(encoded[24:36], value[10:16])
	return Identity{DeviceUUID: string(encoded[:])}, nil
}

func publishIdentity(path string, identity Identity, directory *identityDirectory) error {
	data, err := json.Marshal(identity)
	if err != nil {
		return fmt.Errorf("encode identity: %w", err)
	}
	data = append(data, '\n')

	temp, tempPath, err := createRestrictedIdentityTemp(directory.path)
	if err != nil {
		return fmt.Errorf("create temporary identity: %w", err)
	}
	defer os.Remove(tempPath)
	defer temp.Close()
	if _, err := temp.Write(data); err != nil {
		return fmt.Errorf("write temporary identity: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("sync temporary identity: %w", err)
	}
	if err := validateRestrictedIdentityHandle(temp); err != nil {
		return fmt.Errorf("validate temporary identity: %w", err)
	}
	if err := validateIdentityPath(path); err != nil {
		return err
	}

	if err := os.Link(tempPath, path); err != nil {
		return fmt.Errorf("publish identity: %w", err)
	}
	published, err := openValidatedIdentity(path)
	if err != nil {
		return fmt.Errorf("verify published identity: %w", err)
	}
	defer published.Close()
	if err := verifySameIdentityFile(temp, published); err != nil {
		return fmt.Errorf("verify published identity: %w", err)
	}
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync identity directory: %w", err)
	}
	return nil
}

func cleanStaleIdentityFiles(directory *identityDirectory, now time.Time) error {
	entries, err := os.ReadDir(directory.path)
	if err != nil {
		return fmt.Errorf("inspect identity directory: %w", err)
	}
	removed := false
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, ".identity-") || !strings.HasSuffix(name, ".tmp") {
			continue
		}
		path := filepath.Join(directory.path, name)
		info, err := lstatRegularIdentityFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect temporary identity: %w", err)
		}
		if now.Sub(info.ModTime()) < staleIdentityAge {
			continue
		}
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("remove stale temporary identity: %w", err)
		}
		removed = true
	}
	if removed {
		if err := directory.Sync(); err != nil {
			return fmt.Errorf("sync identity directory: %w", err)
		}
	}
	return nil
}
