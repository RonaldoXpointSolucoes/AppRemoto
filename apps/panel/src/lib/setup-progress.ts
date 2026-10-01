const storageKey = 'appremoto:setup-progress:v1';

export function readSetupProgress(allowedIds: readonly string[]): string[] {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(stored) ? allowedIds.filter((id) => stored.includes(id)) : [];
  } catch {
    return [];
  }
}

export function saveSetupProgress(ids: readonly string[]): void {
  try { window.sessionStorage.setItem(storageKey, JSON.stringify(ids)); } catch { /* In-memory checks remain usable. */ }
}

export function clearSetupProgress(): void {
  try { window.sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled or unavailable on the server. */ }
}
