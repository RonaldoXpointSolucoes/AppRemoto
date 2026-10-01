import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { beginSession, expireSession, logoutSession, sessionEpoch } from './session-cache';
import { clearSessionJwts, createSessionJwtGetter } from '../../lib/session-jwt';

describe('logoutSession', () => {
  it.each(['begin', 'expire', 'logout'] as const)('clears the in-memory JWT on %s', async (transition) => {
    clearSessionJwts();
    const client = new QueryClient();
    const mint = vi.fn().mockResolvedValueOnce({ jwt: 'old' }).mockResolvedValue({ jwt: 'new' });
    const getJwt = createSessionJwtGetter('session-transition', mint);
    expect(await getJwt()).toBe('old');
    if (transition === 'begin') await beginSession(client);
    else if (transition === 'expire') await expireSession(client, sessionEpoch(client), async () => undefined);
    else await logoutSession(client, sessionEpoch(client), async () => undefined);
    expect(await getJwt()).toBe('new');
    clearSessionJwts();
  });

  it('shares one remote deletion with a concurrent 401 and clears only after success', async () => {
    const client = new QueryClient();
    client.setQueryData(['session', 0, 'devices'], { privateSessionData: true });
    const epoch = sessionEpoch(client);
    let finishDelete!: () => void;
    const remove = vi.fn(() => new Promise<void>((resolve) => { finishDelete = resolve; }));

    const logout = logoutSession(client, epoch, remove);
    const expired = expireSession(client, epoch, remove);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(sessionEpoch(client)).toBe(epoch);
    expect(client.getQueryData(['session', 0, 'devices'])).toEqual({ privateSessionData: true });

    finishDelete();
    await expect(Promise.all([logout, expired])).resolves.toEqual([true, true]);
    expect(sessionEpoch(client)).toBe(epoch + 1);
    expect(client.getQueryData(['session', 0, 'devices'])).toBeUndefined();
  });

  it('keeps the epoch and cache intact when remote deletion fails', async () => {
    const client = new QueryClient();
    client.setQueryData(['session', 0, 'devices'], { privateSessionData: true });
    const epoch = sessionEpoch(client);

    await expect(logoutSession(client, epoch, vi.fn().mockRejectedValue(new Error('private detail'))))
      .resolves.toBe(false);
    expect(sessionEpoch(client)).toBe(epoch);
    expect(client.getQueryData(['session', 0, 'devices'])).toEqual({ privateSessionData: true });
  });
});
