package heartbeat

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeWaiter struct {
	mu        sync.Mutex
	durations []time.Duration
	block     bool
}

func (waiter *fakeWaiter) Wait(ctx context.Context, duration time.Duration) error {
	waiter.mu.Lock()
	waiter.durations = append(waiter.durations, duration)
	waiter.mu.Unlock()
	if waiter.block {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

func runSequence(t *testing.T, outcomes []error, options Options) []time.Duration {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	waiter := &fakeWaiter{}
	calls := 0
	scheduler, err := NewScheduler(func(context.Context) error {
		outcome := outcomes[calls]
		calls++
		if calls == len(outcomes) {
			cancel()
		}
		return outcome
	}, waiter, options)
	if err != nil {
		t.Fatal(err)
	}
	if err := scheduler.Run(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error = %v", err)
	}
	return waiter.durations
}

func TestSchedulerUsesThirtySecondTargetAndBoundedJitter(t *testing.T) {
	for _, test := range []struct {
		name   string
		random float64
		want   time.Duration
	}{
		{"lower", 0, 27 * time.Second}, {"center", .5, 30 * time.Second}, {"upper", 1, 33 * time.Second},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := runSequence(t, []error{nil, nil}, Options{RandomFloat: func() float64 { return test.random }})
			if len(got) != 1 || got[0] != test.want {
				t.Fatalf("durations = %v, want [%v]", got, test.want)
			}
		})
	}
}

func TestSchedulerBackoffDoublesAndCaps(t *testing.T) {
	failure := errors.New("offline")
	got := runSequence(t, []error{failure, failure, failure, failure, failure}, Options{
		InitialBackoff: time.Second, MaxBackoff: 4 * time.Second, Jitter: -1,
	})
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 4 * time.Second}
	if !durationsEqual(got, want) {
		t.Fatalf("durations = %v, want %v", got, want)
	}
}

func TestSchedulerSuccessResetsBackoffAndRetryRecovers(t *testing.T) {
	failure := errors.New("offline")
	got := runSequence(t, []error{failure, failure, nil, failure, failure}, Options{
		InitialBackoff: time.Second, MaxBackoff: 8 * time.Second, Jitter: -1,
	})
	want := []time.Duration{time.Second, 2 * time.Second, 30 * time.Second, time.Second}
	if !durationsEqual(got, want) {
		t.Fatalf("durations = %v, want %v", got, want)
	}
}

func TestSchedulerCancellationInterruptsWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	waiter := &fakeWaiter{block: true}
	scheduler, err := NewScheduler(func(context.Context) error { return nil }, waiter, Options{Jitter: -1})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- scheduler.Run(ctx) }()
	for {
		waiter.mu.Lock()
		waiting := len(waiter.durations) > 0
		waiter.mu.Unlock()
		if waiting {
			break
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Run error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scheduler did not stop after cancellation")
	}
}

func durationsEqual(left, right []time.Duration) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
