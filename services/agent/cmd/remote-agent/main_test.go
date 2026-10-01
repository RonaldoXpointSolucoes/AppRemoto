package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeAgent struct {
	enrollCalls int
	runCalls    int
	token       string
	existing    bool
	err         error
	started     chan struct{}
}

func (agent *fakeAgent) Enroll(_ context.Context, token []byte) (bool, error) {
	agent.enrollCalls++
	agent.token = string(token)
	return agent.existing, agent.err
}
func (agent *fakeAgent) Run(ctx context.Context) error {
	agent.runCalls++
	if agent.started != nil {
		close(agent.started)
		<-ctx.Done()
		return ctx.Err()
	}
	return agent.err
}

func TestCLIRequiresCommandSpecificFlagsBeforeFactory(t *testing.T) {
	tests := [][]string{
		nil, {"unknown"}, {"enroll"}, {"enroll", "--api-url", "https://api.example.test", "--state-dir", `C:\state`},
		{"run"}, {"run", "--api-url", "https://api.example.test"},
	}
	for _, args := range tests {
		var calls atomic.Int32
		var output bytes.Buffer
		code := execute(context.Background(), args, strings.NewReader("token\n"), &output, func(commandConfig) (commandAgent, error) {
			calls.Add(1)
			return &fakeAgent{}, nil
		})
		if code != 2 || calls.Load() != 0 {
			t.Fatalf("args=%v code=%d factory calls=%d output=%q", args, code, calls.Load(), output.String())
		}
	}
}

func TestCLIEnrollmentReadsTokenFromStdinAndRedactsFailures(t *testing.T) {
	const secret = "synthetic-enrollment-token-00000000"
	agent := &fakeAgent{err: errors.New("failure exposed " + secret)}
	var output bytes.Buffer
	code := execute(context.Background(), []string{"enroll", "--api-url", "https://api.example.test", "--state-dir", `C:\state`, "--display-name", "Test PC"},
		strings.NewReader(secret+"\n"), &output, func(commandConfig) (commandAgent, error) { return agent, nil })
	if code != 1 || agent.enrollCalls != 1 || agent.token != secret {
		t.Fatalf("code=%d calls=%d token=%q", code, agent.enrollCalls, agent.token)
	}
	if strings.Contains(output.String(), secret) || strings.Contains(output.String(), "exposed") {
		t.Fatalf("secret leaked: %q", output.String())
	}
}

func TestCLIReportsExistingEnrollmentWithoutRequiringTokenReuse(t *testing.T) {
	agent := &fakeAgent{existing: true}
	var output bytes.Buffer
	code := execute(context.Background(), []string{"enroll", "--api-url", "https://api.example.test", "--state-dir", `C:\state`, "--display-name", "Test PC"},
		strings.NewReader("synthetic-enrollment-token-00000000\n"), &output, func(config commandConfig) (commandAgent, error) {
			if config.apiURL != "https://api.example.test" || config.stateDirectory != `C:\state` || config.displayName != "Test PC" {
				t.Fatalf("config=%#v", config)
			}
			return agent, nil
		})
	if code != 0 || !strings.Contains(output.String(), "already enrolled") {
		t.Fatalf("code=%d output=%q", code, output.String())
	}
}

func TestCLIRunTreatsCancellationAsGracefulShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	agent := &fakeAgent{started: make(chan struct{})}
	var output bytes.Buffer
	done := make(chan int, 1)
	go func() {
		done <- execute(ctx, []string{"run", "--api-url", "https://api.example.test", "--state-dir", `C:\state`}, strings.NewReader(""), &output,
			func(commandConfig) (commandAgent, error) { return agent, nil })
	}()
	select {
	case <-agent.started:
		cancel()
	case <-time.After(time.Second):
		t.Fatal("run did not start")
	}
	select {
	case code := <-done:
		if code != 0 || agent.runCalls != 1 || !strings.Contains(output.String(), "stopped") {
			t.Fatalf("code=%d calls=%d output=%q", code, agent.runCalls, output.String())
		}
	case <-time.After(time.Second):
		t.Fatal("CLI did not stop after cancellation")
	}
}
