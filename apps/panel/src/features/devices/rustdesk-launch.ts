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
  _currentHref?: string
): string {
  const parsed = validatedUri(uri);
  const ua =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');

  if (/Android/i.test(ua)) {
    // Do NOT include S.browser_fallback_url on connection launches:
    // Samsung Internet and Android Chromium may trigger a background top-level navigation
    // to the fallback URL while handing focus to the RustDesk app, which fails with
    // "This page couldn't load" when Android suspends background browser sockets.
    return `intent://${parsed.hostname}${parsed.pathname}${parsed.search}#Intent;scheme=rustdesk;package=com.carriez.flutter_hbb;end`;
  }

  return parsed.toString();
}

function installBackgroundNavigationGuard(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let cleaned = false;
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timerId !== undefined) clearTimeout(timerId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
  };

  const cancelPendingNavigation = () => {
    try {
      window.stop();
    } catch {
      // Ignore if unsupported by environment
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      cancelPendingNavigation();
      cleanup();
    }
  };

  const onPageHide = () => {
    cancelPendingNavigation();
    cleanup();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  timerId = setTimeout(cleanup, 5000);
}

function triggerEphemeralAnchor(targetUri: string): void {
  if (typeof document === 'undefined' || !document.body) {
    window.location.assign(targetUri);
    return;
  }
  installBackgroundNavigationGuard();
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
    triggerEphemeralAnchor(
      'intent://#Intent;scheme=rustdesk;package=com.carriez.flutter_hbb;end'
    );
    return;
  }
  triggerEphemeralAnchor('rustdesk://');
}

