package state

import (
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
)

// Identity is the durable, non-secret identity of an agent installation.
type Identity struct {
	DeviceUUID string `json:"device_uuid"`
}

var validUUIDV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// LoadOrCreateIdentity loads an existing identity or atomically creates one.
func LoadOrCreateIdentity(path string) (Identity, error) {
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
	data, err := os.ReadFile(path)
	if err != nil {
		return Identity{}, fmt.Errorf("read identity: %w", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var identity Identity
	if err := decoder.Decode(&identity); err != nil {
		return Identity{}, fmt.Errorf("decode identity: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Identity{}, fmt.Errorf("decode identity: %w", err)
	}
	if !validUUIDV4.MatchString(identity.DeviceUUID) {
		return Identity{}, errors.New("decode identity: invalid device UUID")
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

	if err := temp.Chmod(0o600); err != nil {
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

	if err := os.Link(tempPath, path); err != nil {
		return fmt.Errorf("publish identity: %w", err)
	}
	return nil
}
