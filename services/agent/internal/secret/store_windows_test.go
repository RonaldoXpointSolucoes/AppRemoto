//go:build windows

package secret

import (
	"bytes"
	"strings"
	"testing"
)

const secretSentinel = "SECRET-SENTINEL-94D3B61F-C7A829E4-5F1C08D2-END"

var secretSentinelFragments = []string{
	"SECRET-SENTINEL-94D3B61F",
	"94D3B61F-C7A829E4-5F1C",
	"C7A829E4-5F1C08D2-END",
}

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
	plaintext := []byte(secretSentinel + "-plain-device-token-payload")

	protected, err := Protect(plaintext)
	if err != nil {
		t.Fatalf("Protect() error = %v", err)
	}
	assertNoSecretSentinel(t, protected)
}

func TestUnprotectRejectsTamperedBlob(t *testing.T) {
	protected, err := Protect([]byte(secretSentinel + "-device-token-with-integrity"))
	if err != nil {
		t.Fatalf("Protect() error = %v", err)
	}
	tampered := append([]byte(nil), protected...)
	tampered[0] ^= 0xff
	tampered = append(tampered, secretSentinel...)

	plaintext, err := Unprotect(tampered)
	if err == nil {
		clear(plaintext)
		t.Fatal("Unprotect() error = nil for a tampered blob")
	}
	if plaintext != nil {
		clear(plaintext)
		t.Fatal("Unprotect() returned plaintext for a tampered blob")
	}
	assertNoSecretSentinel(t, []byte(err.Error()))
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
	malformed := []byte(secretSentinel + "-malformed-input")

	plaintext, err := Unprotect(malformed)
	if err == nil {
		clear(plaintext)
		t.Fatal("Unprotect() error = nil for malformed input")
	}
	if plaintext != nil {
		clear(plaintext)
		t.Fatal("Unprotect() returned plaintext for malformed input")
	}
	assertNoSecretSentinel(t, []byte(err.Error()))
}

func assertNoSecretSentinel(t *testing.T, value []byte) {
	t.Helper()
	if bytes.Contains(value, []byte(secretSentinel)) {
		t.Fatal("value contains the complete secret sentinel")
	}
	for _, fragment := range secretSentinelFragments {
		if strings.Contains(string(value), fragment) {
			t.Fatal("value contains a secret sentinel fragment")
		}
	}
}
