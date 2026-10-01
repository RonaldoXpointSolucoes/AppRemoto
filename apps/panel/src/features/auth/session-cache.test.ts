import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { expireSession, logoutSession, sessionEpoch } from './session-cache';

describe('logoutSession', () => {
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
