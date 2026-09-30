//go:build windows && 386

package rustdesk

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func requireWOW64(t *testing.T) {
	t.Helper()
	var wow64 bool
	if err := windows.IsWow64Process(windows.CurrentProcess(), &wow64); err != nil {
		t.Fatalf("IsWow64Process() error = %v", err)
	}
	if !wow64 {
		t.Skip("genuine 32-bit Windows has no 64-bit Program Files")
	}
}

func TestKnownInstallRootsIncludesRegistryProgramFilesX64UnderWOW64(t *testing.T) {
	requireWOW64(t)
	_, programFilesX64, _, _, err := knownInstallRoots()
	if err != nil {
		t.Fatalf("knownInstallRoots() error = %v", err)
	}
	registryRoot, err := readProgramFilesX64Registry()
	if err != nil {
		t.Fatalf("readProgramFilesX64Registry() error = %v", err)
	}
	if programFilesX64 == "" {
		t.Fatal("knownInstallRoots() omitted 64-bit Program Files under WOW64")
	}
	if !strings.EqualFold(filepath.Clean(programFilesX64), filepath.Clean(registryRoot)) {
		t.Fatalf("Program Files x64 = %q, registry = %q", programFilesX64, registryRoot)
	}
	if info, err := os.Stat(programFilesX64); err != nil || !info.IsDir() {
		t.Fatalf("Program Files x64 root %q is not an existing directory: %v", programFilesX64, err)
	}
}

func TestDiscoverUsesRegistryResolvedX64OnlyFixtureUnderWOW64(t *testing.T) {
	requireWOW64(t)
	root := filepath.Join(t.TempDir(), "Program Files x64")
	executable := filepath.Join(root, "RustDesk", "RustDesk.exe")
	writeFakeExecutable(t, executable)

	resolved, err := resolveProgramFilesX64(func() (string, error) { return root, nil })
	if err != nil {
		t.Fatalf("resolveProgramFilesX64() error = %v", err)
	}
	if resolved != root {
		t.Fatalf("resolveProgramFilesX64() = %q, want registry fixture %q", resolved, root)
	}
	client, err := NewClient(metadataRunner(t, executable, "123456789\n", "1.4.4\n"), Options{ProgramFilesX64: resolved})
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	info, err := client.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover() error = %v", err)
	}
	if info.ExecutablePath != executable {
		t.Fatalf("ExecutablePath = %q, want %q", info.ExecutablePath, executable)
	}
}

func TestResolveProgramFilesX64RejectsUnsafeRegistryPathsUnderWOW64(t *testing.T) {
	requireWOW64(t)
	for _, path := range []string{`relative\Program Files`, `\\server\share`, `\\?\C:\Program Files`} {
		path := path
		t.Run(path, func(t *testing.T) {
			if _, err := resolveProgramFilesX64(func() (string, error) { return path, nil }); err == nil {
				t.Fatalf("resolveProgramFilesX64(%q) succeeded", path)
			}
		})
	}
}
