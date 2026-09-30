import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../lib/api';
import { checkSession, type LoginService } from './session';

function service(overrides: Partial<LoginService> = {}): LoginService {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    verifyProfile: vi.fn().mockResolvedValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('checkSession', () => {
  it('removes a disabled technician session once and returns a stable terminal state', async () => {
    const auth = service({
      verifyProfile: vi.fn().mockRejectedValue(new ApiClientError({
        code: 'TECHNICIAN_DISABLED', message: 'private profile detail', status: 403,
      })),
    });

    const state = await checkSession(auth);

    expect(state).toEqual({ status: 'expired' });
    expect(auth.removeSession).toHaveBeenCalledTimes(1);
  });
});
