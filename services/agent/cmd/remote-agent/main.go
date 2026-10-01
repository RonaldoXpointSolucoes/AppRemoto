package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/api"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/enroll"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/heartbeat"
	"github.com/RonaldoXpointSolucoes/AppRemoto/services/agent/internal/rustdesk"
)

const agentVersion = "0.1.0"

type commandConfig struct {
	apiURL, stateDirectory, displayName, rustDeskPath string
}

type commandAgent interface {
	Enroll(context.Context, []byte) (bool, error)
	Run(context.Context) error
}

type agentFactory func(commandConfig) (commandAgent, error)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	os.Exit(execute(ctx, os.Args[1:], os.Stdin, os.Stdout, newProductionAgent))
}

func execute(ctx context.Context, args []string, input io.Reader, output io.Writer, factory agentFactory) int {
	if len(args) == 0 || (args[0] != "enroll" && args[0] != "run") {
		_, _ = io.WriteString(output, "usage: remote-agent enroll|run [options]\n")
		return 2
	}
	config, ok := parseConfig(args[0], args[1:])
	if !ok {
		_, _ = io.WriteString(output, "invalid command arguments\n")
		return 2
	}
	if args[0] == "enroll" {
		token, ok := readEnrollmentToken(input)
		if !ok {
			_, _ = io.WriteString(output, "invalid enrollment token input\n")
			return 2
		}
		defer clear(token)
		agent, err := factory(config)
		if err != nil {
			_, _ = io.WriteString(output, "agent configuration failed\n")
			return 1
		}
		existing, err := agent.Enroll(ctx, token)
		if err != nil {
			_, _ = io.WriteString(output, "enrollment failed\n")
			return 1
		}
		if existing {
			_, _ = io.WriteString(output, "device already enrolled\n")
		} else {
			_, _ = io.WriteString(output, "device enrolled\n")
		}
		return 0
	}
	agent, err := factory(config)
	if err != nil {
		_, _ = io.WriteString(output, "agent configuration failed\n")
		return 1
	}
	_, _ = io.WriteString(output, "agent running\n")
	if err := agent.Run(ctx); err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			_, _ = io.WriteString(output, "agent stopped\n")
			return 0
		}
		_, _ = io.WriteString(output, "agent stopped after an internal failure\n")
		return 1
	}
	_, _ = io.WriteString(output, "agent stopped\n")
	return 0
}

func parseConfig(command string, args []string) (commandConfig, bool) {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var config commandConfig
	flags.StringVar(&config.apiURL, "api-url", "", "")
	flags.StringVar(&config.stateDirectory, "state-dir", "", "")
	flags.StringVar(&config.rustDeskPath, "rustdesk-path", "", "")
	if command == "enroll" {
		flags.StringVar(&config.displayName, "display-name", "", "")
	}
	if flags.Parse(args) != nil || flags.NArg() != 0 || config.apiURL == "" || config.stateDirectory == "" ||
		(command == "enroll" && config.displayName == "") {
		return commandConfig{}, false
	}
	return config, true
}

func readEnrollmentToken(input io.Reader) ([]byte, bool) {
	data, err := io.ReadAll(io.LimitReader(input, 514))
	if err != nil || len(data) > 513 {
		clear(data)
		return nil, false
	}
	data = bytesTrimLineEnding(data)
	if len(data) < 32 || len(data) > 512 || strings.ContainsAny(string(data), "\r\n") {
		clear(data)
		return nil, false
	}
	return data, true
}

func bytesTrimLineEnding(value []byte) []byte {
	if len(value) > 0 && value[len(value)-1] == '\n' {
		value = value[:len(value)-1]
	}
	if len(value) > 0 && value[len(value)-1] == '\r' {
		value = value[:len(value)-1]
	}
	return value
}

type productionAgent struct {
	config     commandConfig
	api        *api.Client
	rustdesk   *rustdesk.Client
	enrollment *enroll.Service
}

func newProductionAgent(config commandConfig) (commandAgent, error) {
	apiClient, err := api.NewClient(config.apiURL, api.Options{})
	if err != nil {
		return nil, errors.New("invalid API configuration")
	}
	rustDeskClient, err := rustdesk.NewClient(nil, rustdesk.Options{ExecutablePath: config.rustDeskPath})
	if err != nil {
		return nil, errors.New("invalid RustDesk configuration")
	}
	enrollmentService, err := enroll.NewService(enroll.Options{StateDirectory: config.stateDirectory, API: apiClient, RustDesk: rustDeskClient})
	if err != nil {
		return nil, errors.New("invalid enrollment configuration")
	}
	return &productionAgent{config: config, api: apiClient, rustdesk: rustDeskClient, enrollment: enrollmentService}, nil
}

func (agent *productionAgent) Enroll(ctx context.Context, token []byte) (bool, error) {
	hostname, operatingSystem, osVersion, err := collectSystemMetadata()
	if err != nil {
		return false, errors.New("system metadata unavailable")
	}
	result, err := agent.enrollment.Run(ctx, token, enroll.Metadata{DisplayName: agent.config.displayName, Hostname: hostname,
		OperatingSystem: operatingSystem, OSVersion: osVersion, AgentVersion: agentVersion})
	clear(result.DeviceToken)
	if err != nil {
		return false, errors.New("enrollment unavailable")
	}
	return result.Existing, nil
}

func (agent *productionAgent) Run(ctx context.Context) error {
	result, err := agent.enrollment.Run(ctx, nil, enroll.Metadata{})
	if err != nil {
		return errors.New("protected enrollment state unavailable")
	}
	defer clear(result.DeviceToken)
	_, operatingSystem, osVersion, err := collectSystemMetadata()
	if err != nil {
		return errors.New("system metadata unavailable")
	}
	info, err := agent.rustdesk.Discover(ctx)
	if err != nil {
		return errors.New("trusted RustDesk metadata unavailable")
	}
	request := api.HeartbeatRequest{AgentVersion: agentVersion, RustDeskVersion: info.Version, RustDeskID: info.ID,
		OperatingSystem: operatingSystem, OSVersion: osVersion}
	scheduler, err := heartbeat.NewScheduler(func(sendCtx context.Context) error {
		_, sendErr := agent.api.Heartbeat(sendCtx, result.DeviceToken, request)
		return sendErr
	}, nil, heartbeat.Options{Interval: time.Duration(result.HeartbeatIntervalSeconds) * time.Second})
	if err != nil {
		return errors.New("invalid heartbeat schedule")
	}
	return scheduler.Run(ctx)
}
