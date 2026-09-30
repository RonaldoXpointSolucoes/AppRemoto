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

const (
	maxIdentityBytes = 1024
	staleIdentityAge = 24 * time.Hour
)

// LoadOrCreateIdentity loads an existing identity or atomically creates one.
func LoadOrCreateIdentity(path string) (Identity, error) {
	if err := validateIdentityPath(path); err != nil {
		return Identity{}, err
	}
	if err := cleanStaleIdentityFiles(filepath.Dir(path), time.Now()); err != nil {
		return Identity{}, err
	}

	identity, err := loadIdentity(path)
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
	if err := publishIdentity(path, identity); err != nil {
		if errors.Is(err, os.ErrExist) {
			return loadIdentity(path)
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

func publishIdentity(path string, identity Identity) error {
	data, err := json.Marshal(identity)
	if err != nil {
		return fmt.Errorf("encode identity: %w", err)
	}
	data = append(data, '\n')

	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".identity-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary identity: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if err := restrictIdentityFile(tempPath); err != nil {
		temp.Close()
		return fmt.Errorf("restrict temporary identity: %w", err)
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return fmt.Errorf("write temporary identity: %w", err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return fmt.Errorf("sync temporary identity: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close temporary identity: %w", err)
	}
	if err := validateRestrictedACL(tempPath); err != nil {
		return fmt.Errorf("validate temporary identity: %w", err)
	}
	if err := validateIdentityPath(path); err != nil {
		return err
	}

	if err := os.Link(tempPath, path); err != nil {
		return fmt.Errorf("publish identity: %w", err)
	}
	if err := syncIdentityDirectory(filepath.Dir(path)); err != nil {
		return fmt.Errorf("sync identity directory: %w", err)
	}
	return nil
}

func cleanStaleIdentityFiles(dir string, now time.Time) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("inspect identity directory: %w", err)
	}
	removed := false
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, ".identity-") || !strings.HasSuffix(name, ".tmp") {
			continue
		}
		path := filepath.Join(dir, name)
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
		if err := syncIdentityDirectory(dir); err != nil {
			return fmt.Errorf("sync identity directory: %w", err)
		}
	}
	return nil
}
