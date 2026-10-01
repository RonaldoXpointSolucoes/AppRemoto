import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppwriteException } from 'appwrite';

import { createApiClient } from './api';
import { clearSessionJwts, createSessionJwtGetter } from './session-jwt';
import { checkSession } from '../features/auth/session';

afterEach(clearSessionJwts);
const profile = { id: 'technician', displayName: 'Technician', globalRole: null, authorization: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

describe('cached JWT recovery', () => {
  it('recovers a replaced shared cookie across isolated tab caches without deleting the new session', async () => {
    let sharedCookie = 'A';
    const mint = vi.fn(async () => ({ jwt: sharedCookie }));
    const firstTab = createSessionJwtGetter('tab-one', mint);
    const secondTab = createSessionJwtGetter('tab-two', mint);
    await Promise.all([firstTab(), secondTab()]);
    sharedCookie = 'B'; // First tab logged out and signed in again; second tab still holds A.
    await firstTab.refresh('A');
    const transport = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const authorized = new Headers(init?.headers).get('authorization') === 'Bearer B';
      return authorized ? json(profile) : json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401);
    });
    const api = createApiClient({ baseUrl: 'https://api.example.test', getJwt: secondTab, fetch: transport });
    const removeSession = vi.fn();
    const service = { createSession: vi.fn(), removeSession, verifyProfile: async () => { await api.getMe(); } };
    const before = mint.mock.calls.length;
    expect(await Promise.all([checkSession(service), checkSession(service), checkSession(service)]))
      .toEqual(Array(3).fill({ status: 'authenticated' }));
    expect(mint.mock.calls.length - before).toBe(1);
    expect(removeSession).not.toHaveBeenCalled();
    await secondTab.refresh('A');
    expect(mint.mock.calls.length - before).toBe(1);
  });

  it('retries only once after an API 401', async () => {
    const mint = vi.fn().mockResolvedValue({ jwt: 'token' });
    const transport = vi.fn(async () => json({}, 401));
    const api = createApiClient({ baseUrl: 'https://api.example.test', getJwt: createSessionJwtGetter('retry', mint), fetch: transport });
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does not retry forbidden requests or transport failures', async () => {
    const mint = vi.fn().mockResolvedValue({ jwt: 'token' });
    const transport = vi.fn().mockResolvedValueOnce(json({}, 403)).mockRejectedValueOnce(new Error('network'));
    const api = createApiClient({ baseUrl: 'https://api.example.test', getJwt: createSessionJwtGetter('no-retry', mint), fetch: transport });
    await expect(api.getMe()).rejects.toMatchObject({ status: 403 });
    await expect(api.getMe()).rejects.toMatchObject({ status: 0 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('keeps an actually expired current cookie terminal without repeating the API request', async () => {
    const mint = vi.fn().mockResolvedValueOnce({ jwt: 'A' })
      .mockRejectedValueOnce(new AppwriteException('expired', 401, 'user_unauthorized'));
    const transport = vi.fn(async () => json({}, 401));
    const api = createApiClient({ baseUrl: 'https://api.example.test', getJwt: createSessionJwtGetter('expired', mint), fetch: transport });
    await expect(api.getMe()).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a refresh completed after session cleanup', async () => {
    let finish!: (value: { jwt: string }) => void;
    const mint = vi.fn().mockResolvedValueOnce({ jwt: 'A' })
      .mockImplementationOnce(() => new Promise<{ jwt: string }>((resolve) => { finish = resolve; }));
    const getJwt = createSessionJwtGetter('late-refresh', mint);
    await getJwt();
    const refresh = getJwt.refresh('A');
    const rejected = expect(refresh).rejects.toThrow('Session changed');
    clearSessionJwts();
    finish({ jwt: 'old-refresh' });
    await rejected;
  });
});
