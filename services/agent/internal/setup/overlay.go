package setup

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const Marker = "XPOINT_SETUP_V1"
const MaxOverlay = 16384
const Version = "1.2.2"
const APIURL = "https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io"
const IDServer = "179.199.142.157:21116"
const RelayServer = "179.199.142.157:21117"
const PublicKey = "6qc86QUPst9+H4QjXyQvSLPbGU6ef25iO+ESoi3figk="

type Provisioning struct {
	SchemaVersion     int    `json:"schemaVersion"`
	EnrollmentID      string `json:"enrollmentId"`
	EnrollmentToken   string `json:"enrollmentToken"`
	ExpiresAt         string `json:"expiresAt"`
	OrganizationID    string `json:"organizationId"`
	DeviceDisplayName string `json:"deviceDisplayName"`
}

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$`)
var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32,512}$`)
var ErrOverlay = errors.New("invalid or expired provisioning package")

func Decode(data []byte, now time.Time) (Provisioning, error) {
	var p Provisioning
	if len(data) == 0 || len(data) > MaxOverlay || !utf8.Valid(data) {
		return p, ErrOverlay
	}
	d := json.NewDecoder(bytes.NewReader(data))
	t, e := d.Token()
	if e != nil || t != json.Delim('{') {
		return p, ErrOverlay
	}
	seen := map[string]bool{}
	for d.More() {
		k, e := d.Token()
		if e != nil {
			return p, ErrOverlay
		}
		key, ok := k.(string)
		if !ok || seen[key] {
			return p, ErrOverlay
		}
		seen[key] = true
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return p, ErrOverlay
		}
	}
	if len(seen) != 6 {
		return p, ErrOverlay
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil {
		return p, ErrOverlay
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return p, ErrOverlay
	}
	expiry, e := time.Parse(time.RFC3339, p.ExpiresAt)
	if e != nil || !expiry.After(now) || p.SchemaVersion != 1 || !idPattern.MatchString(p.EnrollmentID) || !idPattern.MatchString(p.OrganizationID) || !tokenPattern.MatchString(p.EnrollmentToken) || strings.TrimSpace(p.DeviceDisplayName) != p.DeviceDisplayName || utf8.RuneCountInString(p.DeviceDisplayName) < 1 || utf8.RuneCountInString(p.DeviceDisplayName) > 128 {
		return Provisioning{}, ErrOverlay
	}
	for _, r := range p.DeviceDisplayName {
		if unicode.IsControl(r) {
			return Provisioning{}, ErrOverlay
		}
	}
	return p, nil
}

func ReadOverlay(r io.ReaderAt, size int64, now time.Time) (Provisioning, int64, error) {
	tail := make([]byte, len(Marker)+4)
	if size < int64(len(tail))+2 {
		return Provisioning{}, 0, ErrOverlay
	}
	if _, e := r.ReadAt(tail, size-int64(len(tail))); e != nil || string(tail[4:]) != Marker {
		return Provisioning{}, 0, ErrOverlay
	}
	n := int64(binary.LittleEndian.Uint32(tail[:4]))
	base := size - int64(len(tail)) - n
	if n < 1 || n > MaxOverlay || base < 2 {
		return Provisioning{}, 0, ErrOverlay
	}
	var mz [2]byte
	if _, e := r.ReadAt(mz[:], 0); e != nil || string(mz[:]) != "MZ" {
		return Provisioning{}, 0, ErrOverlay
	}
	b := make([]byte, n)
	defer clear(b)
	if _, e := r.ReadAt(b, base); e != nil {
		return Provisioning{}, 0, ErrOverlay
	}
	p, e := Decode(b, now)
	return p, base, e
}
