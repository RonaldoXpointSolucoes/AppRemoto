import { expect, it } from 'vitest';
import { manualRustDeskUri } from './rustdesk-launch';
it('adds exactly one encoded password to the authorized passwordless RustDesk target', () => {
  const value = new URL(manualRustDeskUri('rustdesk://connect/123456789@179.199.142.157:21116?key=public%2Bkey', 'one&two+#@'));
  expect(value.searchParams.get('key')).toBe('public+key');
  expect(value.searchParams.get('password')).toBe('one&two+#@');
  expect([...value.searchParams.keys()]).toEqual(['key', 'password']);
});
it.each(['https://example.test', 'rustdesk://connect/123456789@other:21116?key=public',
  'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=old',
  'rustdesk://connect/123456789@179.199.142.157:21116?key=public&other=value'])('rejects nonapproved manual target %s', (uri) => {
  expect(() => manualRustDeskUri(uri, 'synthetic')).toThrow();
});
