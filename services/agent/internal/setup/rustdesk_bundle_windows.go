//go:build windows

package setup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
)

func ensureRustDesk(ctx context.Context, r io.ReaderAt, b Bundle, ps Paths, report *Report) (resolved string, finalErr error) {
	path, reused, err := reuseOrInstallRustDesk(findInstalledRustDesk, func() (bool, error) {
		m, err := mgr.Connect()
		if err != nil {
			return false, err
		}
		defer m.Disconnect()
		s, err := m.OpenService("RustDesk")
		if err == nil {
			s.Close()
			return true, nil
		}
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return false, nil
		}
		return false, err
	}, b.Size != 0, func() (string, error) { return installBundledRustDesk(ctx, r, b, ps, report) })
	if err != nil {
		report.Record(2, "RUSTDESK_DETECT", "ERROR", err)
	} else if reused {
		report.Record(2, "RUSTDESK_EXISTING_PRESERVED", "OK", nil)
	}
	return path, err
}

func installBundledRustDesk(ctx context.Context, r io.ReaderAt, b Bundle, ps Paths, report *Report) (resolved string, finalErr error) {
	operation := "RUSTDESK_DETECT"
	defer func() {
		if finalErr != nil {
			report.Record(2, operation, "ERROR", finalErr)
		}
	}()
	operation = "RUSTDESK_BUNDLE_VERIFY"
	report.Record(2, operation, "START", nil)
	if e := VerifyBundle(r, b); e != nil {
		return "", e
	}
	h, e := secureDir(ps.Data)
	if e != nil {
		return "", e
	}
	defer windows.CloseHandle(h)
	staging := filepath.Join(ps.Data, "installer")
	sh, e := secureDir(staging)
	if e != nil {
		return "", e
	}
	defer windows.CloseHandle(sh)
	operation = "RUSTDESK_BUNDLE_EXTRACT"
	report.Record(2, operation, "START", nil)
	payload := filepath.Join(staging, "rustdesk-"+RustDeskVersion+"-x86_64.exe")
	data, e := io.ReadAll(io.NewSectionReader(r, b.Offset, b.Size))
	if e != nil {
		return "", e
	}
	defer clear(data)
	if e = replacePrivate(payload, data); e != nil {
		return "", e
	}
	defer os.Remove(payload)
	verified, e := readPrivate(payload, RustDeskSize)
	if e != nil {
		return "", e
	}
	sum := sha256.Sum256(verified)
	clear(verified)
	if hex.EncodeToString(sum[:]) != RustDeskSHA256 {
		return "", ErrBundle
	}
	report.Record(2, "RUSTDESK_BUNDLE_VERIFY", "OK", nil)
	operation = "RUSTDESK_INSTALL"
	report.Record(2, operation, "START", nil)
	installCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	result, e := rustdesk.NewInstallerRunner(16<<10).Run(installCtx, payload, "--silent-install")
	clear(result.Stdout)
	clear(result.Stderr)
	if e != nil {
		return "", e
	}
	if result.ExitCode != 0 {
		return "", &preparationError{"RUSTDESK_INSTALL_FAILED"}
	}
	operation = "RUSTDESK_INSTALL_READBACK"
	report.Record(2, operation, "START", nil)
	readback, cancelReadback := context.WithTimeout(ctx, 30*time.Second)
	defer cancelReadback()
	var path string
	for {
		path, e = findInstalledRustDesk()
		if e == nil {
			break
		}
		select {
		case <-readback.Done():
			return "", &preparationError{"RUSTDESK_INSTALL_FAILED"}
		case <-time.After(250 * time.Millisecond):
		}
	}
	report.Record(2, "RUSTDESK_INSTALL", "OK", nil)
	return path, nil
}
