//go:build windows

package secret

import (
	"errors"
	"fmt"
	"math"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var ErrUnsupported = errors.ErrUnsupported

func Protect(plaintext []byte) ([]byte, error) {
	input, err := inputBlob(plaintext)
	if err != nil {
		return nil, fmt.Errorf("protect secret: %w", err)
	}

	var output windows.DataBlob
	err = windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	runtime.KeepAlive(plaintext)
	if err != nil {
		releaseDataBlob(&output)
		return nil, fmt.Errorf("protect secret with DPAPI: %w", err)
	}
	return consumeDataBlob(&output)
}

func Unprotect(protected []byte) ([]byte, error) {
	input, err := inputBlob(protected)
	if err != nil {
		return nil, fmt.Errorf("unprotect secret: %w", err)
	}

	var output windows.DataBlob
	err = windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	runtime.KeepAlive(protected)
	if err != nil {
		releaseDataBlob(&output)
		return nil, fmt.Errorf("unprotect secret with DPAPI: %w", err)
	}
	return consumeDataBlob(&output)
}

func inputBlob(data []byte) (windows.DataBlob, error) {
	if len(data) == 0 {
		return windows.DataBlob{}, errors.New("empty input")
	}
	if uint64(len(data)) > uint64(math.MaxUint32) {
		return windows.DataBlob{}, errors.New("input exceeds DPAPI size limit")
	}
	return windows.DataBlob{Size: uint32(len(data)), Data: unsafe.SliceData(data)}, nil
}

func consumeDataBlob(blob *windows.DataBlob) (result []byte, err error) {
	defer func() {
		if releaseErr := releaseDataBlob(blob); releaseErr != nil {
			clear(result)
			result = nil
			if err == nil {
				err = fmt.Errorf("release DPAPI output: %w", releaseErr)
			}
		}
	}()

	if blob.Data == nil || blob.Size == 0 {
		return nil, errors.New("DPAPI returned empty output")
	}
	if uint64(blob.Size) > uint64(maxInt()) {
		return nil, errors.New("DPAPI output exceeds addressable memory")
	}

	source := unsafe.Slice(blob.Data, int(blob.Size))
	result = make([]byte, len(source))
	copy(result, source)
	return result, nil
}

func releaseDataBlob(blob *windows.DataBlob) error {
	if blob.Data == nil {
		blob.Size = 0
		return nil
	}
	if blob.Size > 0 && uint64(blob.Size) <= uint64(maxInt()) {
		clear(unsafe.Slice(blob.Data, int(blob.Size)))
	}
	handle := windows.Handle(uintptr(unsafe.Pointer(blob.Data)))
	blob.Data = nil
	blob.Size = 0
	_, err := windows.LocalFree(handle)
	return err
}

func maxInt() int {
	return int(^uint(0) >> 1)
}
