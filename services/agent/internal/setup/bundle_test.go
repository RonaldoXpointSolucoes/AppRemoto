package setup

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func syntheticBundle() []byte {
	b := make([]byte, 16+RustDeskSize+16+int64(len(BundleMarker)))
	copy(b, "MZfake-runtime")
	copy(b[16:], "MZ")
	footer := b[len(b)-16-len(BundleMarker):]
	binary.LittleEndian.PutUint64(footer, 16)
	binary.LittleEndian.PutUint64(footer[8:], uint64(RustDeskSize))
	copy(footer[16:], BundleMarker)
	return b
}

func genericPackage(base []byte, value string) []byte {
	b := append(append([]byte(nil), base...), []byte(value)...)
	length := make([]byte, 4)
	binary.LittleEndian.PutUint32(length, uint32(len(value)))
	b = append(b, length...)
	return append(b, []byte(GenericMarker)...)
}

func TestBundleSeparatesRuntimeAndRejectsAlteration(t *testing.T) {
	b := syntheticBundle()
	bundle, err := ReadBundle(bytes.NewReader(b), int64(len(b)))
	if err != nil || bundle.RuntimeSize != 16 || bundle.Offset != 16 || bundle.Size != RustDeskSize {
		t.Fatal("invalid offsets accepted or runtime includes payload")
	}
	if VerifyBundle(bytes.NewReader(b), bundle) == nil {
		t.Fatal("altered installer accepted")
	}
	for _, change := range []func([]byte){func(v []byte) { v[len(v)-len(BundleMarker)-16] = 255 }, func(v []byte) { v[16] = 'x' }, func(v []byte) { v[len(v)-1] = 'x' }} {
		copyOf := append([]byte(nil), b...)
		change(copyOf)
		if _, err := ReadBundle(bytes.NewReader(copyOf), int64(len(copyOf))); err == nil {
			t.Fatal("malformed footer or executable accepted")
		}
	}
}

func TestGenericOverlayIsStrictAndRequiresCompleteBundle(t *testing.T) {
	value := `{"schemaVersion":2,"installerId":"installer-1","installerToken":"` + strings.Repeat("a", 43) + `"}`
	b := genericPackage(syntheticBundle(), value)
	p, err := ReadPackage(bytes.NewReader(b), int64(len(b)), time.Now())
	if err != nil || p.Generic.InstallerID != "installer-1" || p.Bundle.RuntimeSize != 16 {
		t.Fatal("generic bundle rejected")
	}
	for _, bad := range []string{strings.Replace(value, `"schemaVersion":2`, `"schemaVersion":1`, 1), strings.Replace(value, `"schemaVersion":2`, `"schemaVersion":2,"schemaVersion":2`, 1), strings.Replace(value, `"installerId":"installer-1"`, `"installerId":"../bad"`, 1), strings.TrimSuffix(value, "}") + `,"password":"bad"}`} {
		x := genericPackage([]byte("MZ"), bad)
		if _, _, e := ReadGenericOverlay(bytes.NewReader(x), int64(len(x))); e == nil {
			t.Fatal("invalid fields accepted")
		}
	}
	bare := genericPackage([]byte("MZruntime"), value)
	if _, e := ReadPackage(bytes.NewReader(bare), int64(len(bare)), time.Now()); e == nil {
		t.Fatal("generic artifact without embedded RustDesk accepted")
	}
}

func TestGenericRequestSecretAndNames(t *testing.T) {
	input := InstallationInput{CompanyName: "Empresa Ágil", DeviceDisplayName: "Recepção"}
	req, err := newPreparationRequest(GenericProvisioning{InstallerID: "installer"}, input)
	if err != nil || len(req.RequestID) != 36 || len(req.RequestSecret) != 43 || req.RequestID == req.RequestSecret {
		t.Fatal("request proof missing")
	}
	for _, name := range []string{"", " space", strings.Repeat("á", 129), "line\nname"} {
		if (InstallationInput{CompanyName: name, DeviceDisplayName: "pc"}).Valid() {
			t.Fatal("invalid name accepted")
		}
	}
	data, _ := json.Marshal(GenericProvisioning{2, "installer", strings.Repeat("A", 43)})
	if strings.Contains(string(data), "password") {
		t.Fatal("password in distribution overlay")
	}
}
