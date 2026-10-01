package heartbeat

import (
	"context"
	"errors"
	"math/rand"
	"time"
)

const (
	defaultInterval       = 30 * time.Second
	defaultJitter         = 3 * time.Second
	defaultInitialBackoff = time.Second
	defaultMaxBackoff     = 2 * time.Minute
)

type SendFunc func(context.Context) error

type Waiter interface {
	Wait(context.Context, time.Duration) error
}

type Options struct {
	Interval       time.Duration
	Jitter         time.Duration
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	RandomFloat    func() float64
}

type Scheduler struct {
	send                                         SendFunc
	waiter                                       Waiter
	interval, jitter, initialBackoff, maxBackoff time.Duration
	randomFloat                                  func() float64
}

type timerWaiter struct{}

func (timerWaiter) Wait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func NewScheduler(send SendFunc, waiter Waiter, options Options) (*Scheduler, error) {
	if send == nil {
		return nil, errors.New("heartbeat sender is required")
	}
	if waiter == nil {
		waiter = timerWaiter{}
	}
	interval := options.Interval
	if interval == 0 {
		interval = defaultInterval
	}
	jitter := options.Jitter
	if jitter == 0 {
		jitter = defaultJitter
	} else if jitter < 0 {
		jitter = 0
	}
	initialBackoff := options.InitialBackoff
	if initialBackoff == 0 {
		initialBackoff = defaultInitialBackoff
	}
	maxBackoff := options.MaxBackoff
	if maxBackoff == 0 {
		maxBackoff = defaultMaxBackoff
	}
	if interval <= 0 || jitter >= interval || initialBackoff <= 0 || maxBackoff < initialBackoff {
		return nil, errors.New("invalid heartbeat schedule")
	}
	randomFloat := options.RandomFloat
	if randomFloat == nil {
		randomFloat = rand.Float64
	}
	return &Scheduler{send: send, waiter: waiter, interval: interval, jitter: jitter,
		initialBackoff: initialBackoff, maxBackoff: maxBackoff, randomFloat: randomFloat}, nil
}

func (scheduler *Scheduler) Run(ctx context.Context) error {
	backoff := scheduler.initialBackoff
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := scheduler.send(ctx)
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		var delay time.Duration
		if err == nil {
			backoff = scheduler.initialBackoff
			delay = scheduler.jitteredInterval()
		} else {
			delay = backoff
			if backoff < scheduler.maxBackoff {
				backoff *= 2
				if backoff > scheduler.maxBackoff {
					backoff = scheduler.maxBackoff
				}
			}
		}
		if err := scheduler.waiter.Wait(ctx, delay); err != nil {
			return err
		}
	}
}

func (scheduler *Scheduler) jitteredInterval() time.Duration {
	value := scheduler.randomFloat()
	if value < 0 {
		value = 0
	}
	if value > 1 {
		value = 1
	}
	offset := time.Duration((value*2 - 1) * float64(scheduler.jitter))
	return scheduler.interval + offset
}
