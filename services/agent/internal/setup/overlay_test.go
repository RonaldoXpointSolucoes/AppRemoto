package setup

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func payload(t *testing.T) []byte {
	t.Helper()
	b, e := json.Marshal(Provisioning{1, "enroll-id", strings.Repeat("a", 43), "2030-01-01T00:00:00Z", "org-id", "Workstation"})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestOverlay(t *testing.T) {
	p := payload(t)
	b := append([]byte("MZbinary"), p...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(p)))
	b = append(b, Marker...)
	got, n, e := ReadOverlay(bytes.NewReader(b), int64(len(b)), time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if e != nil || n != 8 || got.OrganizationID != "org-id" {
		t.Fatal("valid overlay rejected")
	}
	for _, bad := range [][]byte{b[:len(b)-1], []byte("MZ"), append(append([]byte{}, b...), 0)} {
		if _, _, e := ReadOverlay(bytes.NewReader(bad), int64(len(bad)), time.Now()); e == nil {
			t.Fatal("malformed accepted")
		}
	}
	if _, _, e := ReadOverlay(bytes.NewReader(b), int64(len(b)), time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC)); e == nil {
		t.Fatal("expired accepted")
	}
}
func TestStrictProvisioning(t *testing.T) {
	p := payload(t)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, b := range [][]byte{append(p, []byte("{}")...), []byte(strings.Replace(string(p), "{", `{"apiUrl":"https://evil.invalid",`, 1)), []byte(strings.Replace(string(p), "{", `{"schemaVersion":1,`, 1)), bytes.Repeat([]byte(" "), MaxOverlay+1), []byte(strings.Replace(string(p), "Workstation", `bad\nname`, 1)), []byte(strings.Replace(string(p), "org-id", "../org", 1))} {
		if _, e := Decode(b, now); e == nil {
			t.Fatal("untrusted provisioning accepted")
		}
	}
}
