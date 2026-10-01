import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSessionJwts, createSessionJwtGetter } from './session-jwt';

afterEach(() => { clearSessionJwts(); vi.useRealTimers(); });

describe('session JWT reuse', () => {
  it('shares one issuance across concurrent consumers and sustained polling', async () => {
    const mint = vi.fn().mockResolvedValue({ jwt: 'session-token' });
    const session = createSessionJwtGetter('endpoint/project', mint);
    const devices = createSessionJwtGetter('endpoint/project', mint);
    await expect(Promise.all([session(), devices(), session()])).resolves.toEqual(Array(3).fill('session-token'));
    for (let index = 0; index < 150; index++) await devices();
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('renews before the default fifteen-minute JWT expiry', async () => {
    vi.useFakeTimers();
    const mint = vi.fn().mockResolvedValueOnce({ jwt: 'first' }).mockResolvedValue({ jwt: 'second' });
    const getJwt = createSessionJwtGetter('endpoint/project', mint);
    expect(await getJwt()).toBe('first');
    vi.advanceTimersByTime(11 * 60_000);
    expect(await getJwt()).toBe('first');
    vi.advanceTimersByTime(60_000);
    expect(await getJwt()).toBe('second');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('never shares credentials across endpoints or projects', async () => {
    const first = vi.fn().mockResolvedValue({ jwt: 'one' });
    const second = vi.fn().mockResolvedValue({ jwt: 'two' });
    expect(await createSessionJwtGetter('endpoint/one', first)()).toBe('one');
    expect(await createSessionJwtGetter('endpoint/two', second)()).toBe('two');
  });

  it('rejects late issuance from an ended session and cannot overwrite a new session', async () => {
    let resolveOld!: (value: { jwt: string }) => void;
    const mint = vi.fn().mockImplementationOnce(() => new Promise<{ jwt: string }>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ jwt: 'new-session' });
    const getJwt = createSessionJwtGetter('endpoint/project', mint);
    const old = getJwt();
    const rejected = expect(old).rejects.toThrow('Session changed');
    clearSessionJwts();
    expect(await getJwt()).toBe('new-session');
    resolveOld({ jwt: 'old-session' });
    await rejected;
    expect(await getJwt()).toBe('new-session');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures or reuse an expired credential after a failed renewal', async () => {
    vi.useFakeTimers();
    const mint = vi.fn().mockResolvedValueOnce({ jwt: 'first' }).mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValueOnce({ jwt: 'renewed' });
    const getJwt = createSessionJwtGetter('endpoint/project', mint);
    await getJwt();
    vi.advanceTimersByTime(12 * 60_000);
    await expect(getJwt()).rejects.toThrow('rate limit');
    expect(await getJwt()).toBe('renewed');
  });
});
