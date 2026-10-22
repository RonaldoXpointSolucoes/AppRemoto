type MintJwt = () => Promise<{ jwt: string }>;

interface SessionJwt {
  jwt?: string;
  refreshAt: number;
  pending?: Promise<string>;
}

const PANEL_JWT_STORAGE_KEY = 'appremoto:panel-session-jwt:v1';

// Appwrite's default JWT lifetime is 15 minutes. Keep a safety margin and share
// issuance across the session boundary, directory and setup polling in this tab.
const reuseMilliseconds = 12 * 60_000;
const sessions = new Map<string, SessionJwt>();

export interface SessionJwtGetter {
  (): Promise<string>;
  refresh(rejectedJwt: string): Promise<string>;
}

export function storePanelSessionJwt(jwt: string): void {
  if (!jwt || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PANEL_JWT_STORAGE_KEY, jwt);
  } catch {
    // Ignore storage quota errors
  }
  const refreshAt = Date.now() + reuseMilliseconds;
  for (const entry of sessions.values()) {
    entry.jwt = jwt;
    entry.refreshAt = refreshAt;
  }
}

export function readPanelSessionJwt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PANEL_JWT_STORAGE_KEY);
    if (!raw) return null;
    const parts = raw.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const normalizedB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalizedB64 + '='.repeat((4 - (normalizedB64.length % 4)) % 4);
    const payload = JSON.parse(window.atob(padded)) as { exp?: number };
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now() + 60_000) {
      window.localStorage.removeItem(PANEL_JWT_STORAGE_KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function clearPanelSessionJwt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PANEL_JWT_STORAGE_KEY);
  } catch {
    // Ignore
  }
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
    const pending = mint()
      .then(({ jwt }) => {
        if (sessions.get(scope) !== entry) throw new Error('Session changed');
        if (!jwt || Date.now() >= requestedAt + reuseMilliseconds)
          throw new Error('Session token unavailable');
        entry.jwt = jwt;
        entry.refreshAt = requestedAt + reuseMilliseconds;
        return jwt;
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined;
      });
    entry.pending = pending;
    return pending;
  };
  return Object.assign(getJwt, {
    refresh: async (rejectedJwt: string) => {
      const entry = sessions.get(scope);
      // A delayed 401 must not invalidate another request's newer credential.
      if (entry?.jwt === rejectedJwt) {
        entry.jwt = undefined;
        entry.refreshAt = 0;
      }
      if (readPanelSessionJwt() === rejectedJwt) {
        clearPanelSessionJwt();
      }
      return getJwt();
    },
  });
}

export function clearSessionJwts(): void {
  clearPanelSessionJwt();
  for (const entry of sessions.values()) entry.jwt = undefined;
  sessions.clear();
}
