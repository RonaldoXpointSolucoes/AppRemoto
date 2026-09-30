//go:build windows

package secret

import (
	"bytes"
	"strings"
	"testing"
)

func TestProtectRoundTripCurrentUser(t *testing.T) {
	plaintext := []byte("device-token-for-current-user-round-trip")

	protected, err := Protect(plaintext)
	if err != nil {
		t.Fatalf("Protect() error = %v", err)
	}
	got, err := Unprotect(protected)
	if err != nil {
		t.Fatalf("Unprotect() error = %v", err)
	}
	defer clear(got)

	if !bytes.Equal(got, plaintext) {
		t.Fatal("Unprotect(Protect(plaintext)) did not return the original input")
	}
}

func TestProtectBlobDoesNotContainPlaintext(t *testing.T) {
	plaintext := []byte("plain-device-token-that-must-not-appear-in-the-dpapi-blob")

	protected, err := Protect(plaintext)
	if err != nil {
		t.Fatalf("Protect() error = %v", err)
	}
	if bytes.Contains(protected, plaintext) {
		t.Fatal("Protect() output contains the plaintext")
	}
}

func TestUnprotectRejectsTamperedBlob(t *testing.T) {
	protected, err := Protect([]byte("device-token-with-integrity"))
	if err != nil {
		t.Fatalf("Protect() error = %v", err)
	}
	tampered := append([]byte(nil), protected...)
	tampered[len(tampered)/2] ^= 0xff

	plaintext, err := Unprotect(tampered)
	if err == nil {
		clear(plaintext)
		t.Fatal("Unprotect() error = nil for a tampered blob")
	}
	if plaintext != nil {
		clear(plaintext)
		t.Fatal("Unprotect() returned plaintext for a tampered blob")
	}
}

func TestSecretStoreRejectsEmptyInput(t *testing.T) {
	for _, test := range []struct {
		name string
		call func([]byte) ([]byte, error)
	}{
		{name: "protect", call: Protect},
		{name: "unprotect", call: Unprotect},
	} {
		t.Run(test.name, func(t *testing.T) {
			output, err := test.call(nil)
			if err == nil {
				clear(output)
				t.Fatal("call(nil) error = nil")
			}
			if output != nil {
				clear(output)
				t.Fatal("call(nil) returned output")
			}
		})
	}
}

func TestUnprotectRejectsMalformedBlobWithoutEchoingInput(t *testing.T) {
	malformed := []byte("malformed-sensitive-value")

	plaintext, err := Unprotect(malformed)
	if err == nil {
		clear(plaintext)
		t.Fatal("Unprotect() error = nil for malformed input")
	}
	if plaintext != nil {
		clear(plaintext)
		t.Fatal("Unprotect() returned plaintext for malformed input")
	}
	if strings.Contains(err.Error(), string(malformed)) {
		t.Fatal("Unprotect() error contains its input")
	}
}
