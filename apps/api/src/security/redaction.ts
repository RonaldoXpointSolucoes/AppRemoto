const sensitiveParts = new Set([
  'authorization', 'cookie', 'cookies', 'password', 'passphrase', 'secret',
  'token', 'jwt', 'session', 'key', 'credential', 'credentials', 'ciphertext',
  'nonce', 'tag',
]);
const sensitiveAliases = [
  'authorization', 'cookie', 'password', 'passphrase', 'secret', 'token',
  'jwt', 'session', 'apikey', 'keymaterial', 'privatekey', 'publickey',
  'encryptionkey', 'signingkey', 'credential', 'ciphertext', 'nonce',
];
const redacted = '[REDACTED]';
const maxArrayLength = 10_000;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitive(name: string): boolean {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const canonical = normalize(name);
  return parts.some((part) => sensitiveParts.has(part)) ||
    sensitiveAliases.some((alias) => canonical.includes(alias));
}

function headerArrayIsSensitive(descriptors: PropertyDescriptorMap, length: number): boolean {
  if (length < 2 || length % 2 !== 0) return false;
  for (let index = 0; index < length; index += 2) {
    const name = descriptors[String(index)];
    if (name && 'value' in name && typeof name.value === 'string' && isSensitive(name.value)) {
      return true;
    }
  }
  return false;
}

export function redactLogData<T>(value: T): T {
  const active = new WeakSet<object>();

  function redact(item: unknown): unknown {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item !== 'object') return redacted;

    try {
      if (active.has(item)) return '[Circular]';
      if (Buffer.isBuffer(item)) return redacted;
      if (item instanceof Date) {
        const milliseconds = Date.prototype.getTime.call(item);
        return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : redacted;
      }

      active.add(item);
      try {
        const descriptors = Object.getOwnPropertyDescriptors(item);
        if (Array.isArray(item)) {
          const length = descriptors.length?.value as unknown;
          if (!Number.isSafeInteger(length) || (length as number) > maxArrayLength) return redacted;
          if (headerArrayIsSensitive(descriptors, length as number)) return redacted;
          const result = new Array(length as number);
          Object.setPrototypeOf(result, null);
          for (let index = 0; index < (length as number); index += 1) {
            const descriptor = descriptors[String(index)];
            result[index] = descriptor && 'value' in descriptor ? redact(descriptor.value) : redacted;
          }
          return result;
        }

        const result: Record<string, unknown> = Object.create(null);
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (!descriptor.enumerable || normalize(key) === 'tojson') continue;
          Object.defineProperty(result, key, {
            value: isSensitive(key) || normalize(key) === 'rawheaders' ||
              !('value' in descriptor) ? redacted : redact(descriptor.value),
            enumerable: true, writable: true, configurable: true,
          });
        }
        return result;
      } finally {
        active.delete(item);
      }
    } catch {
      return redacted;
    }
  }

  return redact(value) as T;
}
