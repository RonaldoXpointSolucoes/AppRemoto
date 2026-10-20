// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import {
  buildPlatformLaunchUri,
  buildRustDeskPeerAliasPowerShellCommand,
  launchRustDesk,
  manualRustDeskUri,
  withRustDeskPeerAlias,
} from './rustdesk-launch';

it('adds exactly one encoded password to the authorized passwordless RustDesk target', () => {
  const value = new URL(manualRustDeskUri('rustdesk://connect/123456789@179.199.142.157:21116?key=public%2Bkey', 'one&two+#@'));
  expect(value.searchParams.get('key')).toBe('public+key');
  expect(value.searchParams.get('password')).toBe('one&two+#@');
  expect([...value.searchParams.keys()]).toEqual(['key', 'password']);
});

it('attaches the concatenated nickname (alias) to the RustDesk launch URI', () => {
  const rawUri = 'rustdesk://connect/246221500@179.199.142.157:21116?key=public%2Bkey&password=ephemeral-secret';
  const withAlias = new URL(withRustDeskPeerAlias(rawUri, 'PANAMBY - SERVIDOR'));
  expect(withAlias.searchParams.get('alias')).toBe('PANAMBY - SERVIDOR');
  expect(withAlias.searchParams.get('key')).toBe('public+key');
  expect(withAlias.searchParams.get('password')).toBe('ephemeral-secret');
});

it('builds a PowerShell command that writes the alias to all 3 RustDesk peer TOML files including the ?key= tab peer file', () => {
  const cmd = buildRustDeskPeerAliasPowerShellCommand('246221500', 'PANAMBY - SERVIDOR');
  expect(cmd).toContain("id='246221500'");
  expect(cmd).toContain("name='PANAMBY - SERVIDOR'");
  expect(cmd).toContain('"$id@$srv?key=$key"');
  expect(cmd).toContain('"$id@$srv"');
  expect(cmd).toContain("alias = '$name'");
});

it.each(['https://example.test', 'rustdesk://connect/123456789@other:21116?key=public',
  'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=old',
  'rustdesk://connect/123456789@179.199.142.157:21116?key=public&other=value'])('rejects nonapproved manual target %s', (uri) => {
  expect(() => manualRustDeskUri(uri, 'synthetic')).toThrow();
});

it('builds an Android intent:// URI without browser_fallback_url so Samsung Internet does not trigger a failing background reload when switching to RustDesk', () => {
  const rawUri = 'rustdesk://connect/1546924957@179.199.142.157:21116?key=public%2Bkey&password=synthetic-pass';
  const androidUa = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
  const fallback = 'https://remoto.xpointsolucoes.com.br/devices';

  const result = buildPlatformLaunchUri(rawUri, androidUa, fallback);
  expect(result).toBe(
    'intent://connect/1546924957@179.199.142.157:21116?key=public%2Bkey&password=synthetic-pass#Intent;scheme=rustdesk;package=com.carriez.flutter_hbb;end'
  );
  expect(result).not.toContain('browser_fallback_url');
});

it('preserves standard rustdesk:// scheme on desktop platforms', () => {
  const rawUri = 'rustdesk://connect/1546924957@179.199.142.157:21116?key=public%2Bkey';
  const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';
  expect(buildPlatformLaunchUri(rawUri, desktopUa, 'https://remoto.xpointsolucoes.com.br/devices')).toBe(rawUri);
});

it('launches via an ephemeral anchor click without leaving credentials in the DOM and cancels pending navigation when tab becomes hidden', () => {
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const stopSpy = vi.spyOn(window, 'stop').mockImplementation(() => {});
  const rawUri = 'rustdesk://connect/1546924957@179.199.142.157:21116?key=public&password=ephemeral-secret';
  launchRustDesk(rawUri, 'PANAMBY - SERVIDOR');
  expect(clickSpy).toHaveBeenCalledTimes(1);
  expect(document.body.innerHTML).not.toContain('ephemeral-secret');
  expect(document.querySelector('a')).toBeNull();

  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(stopSpy).toHaveBeenCalledTimes(1);

  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  clickSpy.mockRestore();
  stopSpy.mockRestore();
});
