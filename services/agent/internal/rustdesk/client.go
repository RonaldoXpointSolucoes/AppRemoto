package rustdesk

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

const (
	defaultCommandTimeout = 5 * time.Second
	metadataOutputLimit   = 4 * 1024
	minPasswordLength     = 8
	maxPasswordLength     = 128
)

var (
	errRustDeskMissing = errors.New("RustDesk executable not found; install RustDesk in a supported location or configure an explicit executable path")
	versionPattern     = regexp.MustCompile(`[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][0-9A-Za-z.-]+)?`)
)

type Info struct {
	ExecutablePath string
	ID             string
	Version        string
}

type Options struct {
	ExecutablePath  string
	ProgramFiles    string
	ProgramFilesX86 string
	LocalAppData    string
	CommandTimeout  time.Duration
}

type Client struct {
	runner          CommandRunner
	executablePath  string
	programFiles    string
	programFilesX86 string
	localAppData    string
	commandTimeout  time.Duration
}

func NewClient(runner CommandRunner, options Options) (*Client, error) {
	if options.CommandTimeout < 0 {
		return nil, errors.New("RustDesk command timeout must not be negative")
	}
	if options.ExecutablePath != "" {
		if err := validateExplicitPath(options.ExecutablePath); err != nil {
			return nil, err
		}
	}
	if runner == nil {
		runner = NewExecRunner(defaultOutputLimit)
	}
	commandTimeout := options.CommandTimeout
	if commandTimeout == 0 {
		commandTimeout = defaultCommandTimeout
	}

	programFiles := options.ProgramFiles
	programFilesX86 := options.ProgramFilesX86
	localAppData := options.LocalAppData
	if programFiles == "" && programFilesX86 == "" && localAppData == "" {
		programFiles = os.Getenv("ProgramFiles")
		programFilesX86 = os.Getenv("ProgramFiles(x86)")
		localAppData = os.Getenv("LOCALAPPDATA")
	}

	return &Client{
		runner:          runner,
		executablePath:  options.ExecutablePath,
		programFiles:    programFiles,
		programFilesX86: programFilesX86,
		localAppData:    localAppData,
		commandTimeout:  commandTimeout,
	}, nil
}

func (c *Client) Discover(ctx context.Context) (Info, error) {
	executable, err := c.findExecutable()
	if err != nil {
		return Info{}, err
	}

	idResult, err := c.run(ctx, "read RustDesk ID", executable, "--get-id")
	if err != nil {
		return Info{}, err
	}
	id, err := parseID(idResult.Stdout)
	if err != nil {
		return Info{}, err
	}

	versionResult, err := c.run(ctx, "read RustDesk version", executable, "--version")
	if err != nil {
		return Info{}, err
	}
	version, err := parseVersion(versionResult.Stdout)
	if err != nil {
		return Info{}, err
	}

	return Info{ExecutablePath: executable, ID: id, Version: version}, nil
}

func (c *Client) SetUnattendedPassword(ctx context.Context, password string) error {
	if err := validatePassword(password); err != nil {
		return err
	}
	executable, err := c.findExecutable()
	if err != nil {
		return err
	}

	args := []string{"--password", password}
	defer func() {
		for i := range args {
			args[i] = ""
		}
	}()
	result, err := c.run(ctx, "configure RustDesk unattended password", executable, args...)
	confirmed := bytes.Equal(bytes.TrimSpace(result.Stdout), []byte("Done!")) && len(bytes.TrimSpace(result.Stderr)) == 0
	clear(result.Stdout)
	clear(result.Stderr)
	if err != nil {
		return err
	}
	if !confirmed {
		return errors.New("configure RustDesk unattended password command failed")
	}
	return nil
}

func (c *Client) run(ctx context.Context, operation, executable string, args ...string) (CommandResult, error) {
	commandCtx, cancel := context.WithTimeout(ctx, c.commandTimeout)
	defer cancel()

	result, err := c.runner.Run(commandCtx, executable, args...)
	if contextErr := commandCtx.Err(); contextErr != nil {
		clear(result.Stdout)
		clear(result.Stderr)
		return CommandResult{}, fmt.Errorf("%s: %w", operation, contextErr)
	}
	if err != nil || result.ExitCode != 0 {
		clear(result.Stdout)
		clear(result.Stderr)
		return CommandResult{}, fmt.Errorf("%s command failed", operation)
	}
	return result, nil
}

func (c *Client) findExecutable() (string, error) {
	if c.executablePath != "" {
		if isRegularFile(c.executablePath) {
			return c.executablePath, nil
		}
		return "", errRustDeskMissing
	}

	candidates := make([]string, 0, 4)
	if c.programFiles != "" {
		candidates = append(candidates, filepath.Join(c.programFiles, "RustDesk", "RustDesk.exe"))
	}
	if c.programFilesX86 != "" {
		candidates = append(candidates, filepath.Join(c.programFilesX86, "RustDesk", "RustDesk.exe"))
	}
	if c.localAppData != "" {
		candidates = append(candidates,
			filepath.Join(c.localAppData, "Programs", "RustDesk", "RustDesk.exe"),
			filepath.Join(c.localAppData, "RustDesk", "RustDesk.exe"),
		)
	}
	for _, candidate := range candidates {
		if isRegularFile(candidate) {
			return candidate, nil
		}
	}
	return "", errRustDeskMissing
}

func isRegularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular()
}

func validateExplicitPath(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !strings.EqualFold(filepath.Base(path), "RustDesk.exe") {
		return errors.New("explicit RustDesk executable path must be an absolute clean path ending in RustDesk.exe")
	}
	for _, character := range path {
		if unicode.IsControl(character) {
			return errors.New("explicit RustDesk executable path contains control characters")
		}
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < minPasswordLength || len(password) > maxPasswordLength {
		return errors.New("RustDesk unattended password must be 8 to 128 bytes")
	}
	for _, character := range password {
		if unicode.IsControl(character) {
			return errors.New("RustDesk unattended password contains control characters")
		}
	}
	return nil
}

func parseID(output []byte) (string, error) {
	line, err := singleBoundedLine(output, "RustDesk ID")
	if err != nil {
		return "", err
	}
	lower := strings.ToLower(line)
	for _, prefix := range []string{"rustdesk id:", "id:"} {
		if strings.HasPrefix(lower, prefix) {
			line = strings.TrimSpace(line[len(prefix):])
			break
		}
	}
	normalized := strings.NewReplacer(" ", "", "-", "").Replace(line)
	if len(normalized) < 6 || len(normalized) > 64 {
		return "", errors.New("invalid RustDesk ID output")
	}
	for _, character := range normalized {
		if character < '0' || character > '9' {
			return "", errors.New("invalid RustDesk ID output")
		}
	}
	return normalized, nil
}

func parseVersion(output []byte) (string, error) {
	line, err := singleBoundedLine(output, "RustDesk version")
	if err != nil {
		return "", err
	}
	matches := versionPattern.FindAllString(line, 2)
	if len(matches) != 1 || len(matches[0]) > 64 {
		return "", errors.New("invalid RustDesk version output")
	}
	return matches[0], nil
}

func singleBoundedLine(output []byte, field string) (string, error) {
	if len(output) > metadataOutputLimit {
		return "", fmt.Errorf("%s output exceeds limit", field)
	}
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" || strings.ContainsAny(trimmed, "\r\n") {
		return "", fmt.Errorf("invalid %s output", field)
	}
	return trimmed, nil
}
