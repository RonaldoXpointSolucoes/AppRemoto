package setup

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"time"
)

const BundleMarker = "XPOINT_BUNDLE_V1"
const GenericMarker = "XPOINT_GENERIC_V1"
const RustDeskVersion = "1.4.9"
const RustDeskSize int64 = 24472432
const RustDeskSHA256 = "eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274"
const maxRuntimeSize int64 = 64 << 20

var ErrBundle = errors.New("invalid bundled RustDesk distribution")

// Bundle is an aggregate of the unchanged official RustDesk installer and our
// independently built runtime. Only RuntimeSize bytes become the XPoint service.
type Bundle struct {
	RuntimeSize int64
	Offset      int64
	Size        int64
}

type InstallerPackage struct {
	Provisioning Provisioning
	Generic      GenericProvisioning
	Bundle       Bundle
}

func ReadPackage(r io.ReaderAt, size int64, now time.Time) (InstallerPackage, error) {
	var p InstallerPackage
	if size < 2 || size > 128<<20 {
		return p, ErrOverlay
	}
	var base int64
	var err error
	if hasMarker(r, size, GenericMarker) {
		p.Generic, base, err = ReadGenericOverlay(r, size)
	} else {
		p.Provisioning, base, err = ReadOverlay(r, size, now)
	}
	if err != nil {
		return InstallerPackage{}, err
	}
	if hasMarker(r, base, BundleMarker) {
		p.Bundle, err = ReadBundle(r, base)
		if err != nil {
			return InstallerPackage{}, err
		}
	} else if p.Generic.SchemaVersion == 2 {
		return InstallerPackage{}, ErrBundle
	} else {
		p.Bundle.RuntimeSize = base
	}
	return p, nil
}

func hasMarker(r io.ReaderAt, size int64, marker string) bool {
	if size < int64(len(marker)) {
		return false
	}
	b := make([]byte, len(marker))
	_, err := r.ReadAt(b, size-int64(len(marker)))
	return err == nil && string(b) == marker
}

// Format: runtime, RustDesk, uint64LE(runtime length), uint64LE(RustDesk length), marker.
func ReadBundle(r io.ReaderAt, size int64) (Bundle, error) {
	tail := make([]byte, 16+len(BundleMarker))
	if size < int64(len(tail))+4 {
		return Bundle{}, ErrBundle
	}
	if _, err := r.ReadAt(tail, size-int64(len(tail))); err != nil || string(tail[16:]) != BundleMarker {
		return Bundle{}, ErrBundle
	}
	runtimeSize := binary.LittleEndian.Uint64(tail[:8])
	payloadSize := binary.LittleEndian.Uint64(tail[8:16])
	if runtimeSize < 2 || runtimeSize > uint64(maxRuntimeSize) || payloadSize != uint64(RustDeskSize) || runtimeSize+payloadSize+uint64(len(tail)) != uint64(size) {
		return Bundle{}, ErrBundle
	}
	for _, offset := range []int64{0, int64(runtimeSize)} {
		var mz [2]byte
		if _, err := r.ReadAt(mz[:], offset); err != nil || string(mz[:]) != "MZ" {
			return Bundle{}, ErrBundle
		}
	}
	return Bundle{RuntimeSize: int64(runtimeSize), Offset: int64(runtimeSize), Size: int64(payloadSize)}, nil
}

func VerifyBundle(r io.ReaderAt, b Bundle) error {
	if b.Size != RustDeskSize || b.Offset != b.RuntimeSize || b.RuntimeSize < 2 || b.RuntimeSize > maxRuntimeSize {
		return ErrBundle
	}
	h := sha256.New()
	n, err := io.Copy(h, io.NewSectionReader(r, b.Offset, b.Size))
	if err != nil || n != b.Size || hex.EncodeToString(h.Sum(nil)) != RustDeskSHA256 {
		return ErrBundle
	}
	return nil
}
