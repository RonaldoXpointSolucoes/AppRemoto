function validatedUri(uri: string): URL {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'rustdesk:' || parsed.hostname !== 'connect'
    || !/^\/[0-9]{6,16}@179\.199\.142\.157:21116$/.test(parsed.pathname)
    || parsed.hash || !parsed.searchParams.get('key')
    || [...parsed.searchParams.keys()].some((key) => key !== 'key' && key !== 'password')) {
    throw new Error('Invalid connection protocol');
  }
  return parsed;
}

export function manualRustDeskUri(baseUri: string, password: string): string {
  const parsed = validatedUri(baseUri);
  if (parsed.searchParams.has('password') || !password || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new Error('Invalid manual handoff');
  }
  parsed.searchParams.set('password', password);
  return parsed.toString();
}

export function buildPlatformLaunchUri(
  uri: string,
  userAgent?: string,
  currentHref?: string
): string {
  const parsed = validatedUri(uri);
  const ua =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');

  if (/Android/i.test(ua)) {
    const rawHref =
      currentHref ??
      (typeof window !== 'undefined' && window.location?.href
        ? window.location.href
        : 'https://remoto.xpointsolucoes.com.br/devices');
    const safeFallback = /^https?:\/\//i.test(rawHref)
      ? rawHref
      : 'https://remoto.xpointsolucoes.com.br/devices';

    return `intent://${parsed.hostname}${parsed.pathname}${parsed.search}#Intent;scheme=rustdesk;package=com.carriez.flutter_hbb;S.browser_fallback_url=${encodeURIComponent(safeFallback)};end`;
  }

  return parsed.toString();
}

function triggerEphemeralAnchor(targetUri: string): void {
  if (typeof document === 'undefined' || !document.body) {
    window.location.assign(targetUri);
    return;
  }
  const anchor = document.createElement('a');
  try {
    anchor.href = targetUri;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.removeAttribute('href');
    anchor.remove();
  }
}

export function launchRustDesk(uri: string): void {
  const targetUri = buildPlatformLaunchUri(uri);
  // Handoff only: credentials never remain in rendered DOM, cache entry or stored value.
  triggerEphemeralAnchor(targetUri);
}

export function probeRustDeskApp(): void {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Android/i.test(ua)) {
    const rawHref =
      typeof window !== 'undefined' && window.location?.href
        ? window.location.href
        : 'https://remoto.xpointsolucoes.com.br/devices';
    const safeFallback = /^https?:\/\//i.test(rawHref)
      ? rawHref
      : 'https://remoto.xpointsolucoes.com.br/devices';
    triggerEphemeralAnchor(
      `intent://#Intent;scheme=rustdesk;package=com.carriez.flutter_hbb;S.browser_fallback_url=${encodeURIComponent(safeFallback)};end`
    );
    return;
  }
  triggerEphemeralAnchor('rustdesk://');
}

