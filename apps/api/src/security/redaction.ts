const sensitiveParts = new Set([
  'authorization', 'cookie', 'password', 'passphrase', 'secret', 'token', 'jwt',
  'session', 'key', 'credential', 'credentials', 'ciphertext', 'nonce', 'tag',
]);
const sensitiveJoined = [
  'authorization', 'setcookie', 'password', 'passphrase', 'secret', 'token',
  'jwt', 'session', 'apikey', 'keymaterial', 'credential', 'ciphertext', 'nonce',
];

function isSensitive(name: string): boolean {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const joined = parts.join('');
  return parts.some((part) => sensitiveParts.has(part)) ||
    sensitiveJoined.some((part) => joined.includes(part));
}

export function redactLogData<T>(value: T): T {
  const active = new WeakSet<object>();

  function redact(item: unknown): unknown {
    if (item === null || typeof item !== 'object') return item;
    if (active.has(item)) return '[Circular]';
    if (Buffer.isBuffer(item)) return '[REDACTED]';
    if (item instanceof Date) return new Date(item.getTime());

    active.add(item);
    try {
      if (Array.isArray(item)) return item.map(redact);
      const result: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (!descriptor.enumerable) continue;
        Object.defineProperty(result, key, {
          value: isSensitive(key) || !('value' in descriptor) ?
            '[REDACTED]' : redact(descriptor.value),
          enumerable: true, writable: true, configurable: true,
        });
      }
      return result;
    } catch {
      return '[REDACTED]';
    } finally {
      active.delete(item);
    }
  }

  return redact(value) as T;
}
