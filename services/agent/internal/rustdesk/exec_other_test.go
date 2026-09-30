//go:build !windows

package rustdesk

import (
	"context"
	"errors"
	"testing"
)

func TestExecRunnerIsUnsupportedBeforeProcessAccess(t *testing.T) {
	_, err := NewExecRunner(64).Run(context.Background(), "/path/that/must/not/be-opened")
	if !errors.Is(err, errors.ErrUnsupported) {
		t.Fatalf("Run() error = %v, want unsupported", err)
	}
}
