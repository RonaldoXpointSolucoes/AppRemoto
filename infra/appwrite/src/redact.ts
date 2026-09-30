const sensitive = new Set(['key', 'token', 'password', 'secret', 'hash', 'ciphertext', 'nonce', 'tag']);

function isSensitive(name: string): boolean {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_-]/);
  return parts.some((part) => sensitive.has(part));
}

export function redactReport<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactReport(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, isSensitive(key) ? '[REDACTED]' : redactReport(item),
    ])) as unknown as T;
  }
  return value;
}
