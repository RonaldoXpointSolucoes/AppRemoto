type MintJwt = () => Promise<{ jwt: string }>;

interface SessionJwt {
  jwt?: string;
  refreshAt: number;
  pending?: Promise<string>;
}

// Appwrite's default JWT lifetime is 15 minutes. Keep a safety margin and share
// issuance across the session boundary, directory and setup polling in this tab.
const reuseMilliseconds = 12 * 60_000;
const sessions = new Map<string, SessionJwt>();

export interface SessionJwtGetter {
  (): Promise<string>;
  refresh(rejectedJwt: string): Promise<string>;
}

export function createSessionJwtGetter(scope: string, mint: MintJwt): SessionJwtGetter {
  const getJwt = async () => {
    let current = sessions.get(scope);
    if (!current) {
      current = { refreshAt: 0 };
      sessions.set(scope, current);
    }
    const entry = current;
    if (entry.jwt && Date.now() < entry.refreshAt) return entry.jwt;
    if (entry.pending) return entry.pending;
    entry.jwt = undefined;
    const requestedAt = Date.now();
    const pending = mint().then(({ jwt }) => {
      if (sessions.get(scope) !== entry) throw new Error('Session changed');
      if (!jwt || Date.now() >= requestedAt + reuseMilliseconds) throw new Error('Session token unavailable');
      entry.jwt = jwt;
      entry.refreshAt = requestedAt + reuseMilliseconds;
      return jwt;
    }).finally(() => {
      if (entry.pending === pending) entry.pending = undefined;
    });
    entry.pending = pending;
    return pending;
  };
  return Object.assign(getJwt, {
    refresh: async (rejectedJwt: string) => {
      const entry = sessions.get(scope);
      // A delayed 401 must not invalidate another request's newer credential.
      if (entry?.jwt === rejectedJwt) { entry.jwt = undefined; entry.refreshAt = 0; }
      return getJwt();
    },
  });
}

export function clearSessionJwts(): void {
  for (const entry of sessions.values()) entry.jwt = undefined;
  sessions.clear();
}
