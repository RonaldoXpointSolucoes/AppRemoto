const RUSTDESK_SERVER_HOST = '179.199.142.157:21116';
const RUSTDESK_PUBLIC_KEY = '6qc86QUPst9+H4QjXyQvSLPbGU6ef25iO+ESoi3figk=';

export function sanitizePeerAlias(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function validatedUri(uri: string): URL {
  const parsed = new URL(uri);
  if (
    parsed.protocol !== 'rustdesk:' ||
    parsed.hostname !== 'connect' ||
    !/^\/[0-9]{6,16}@179\.199\.142\.157:21116$/.test(parsed.pathname) ||
    parsed.hash ||
    !parsed.searchParams.get('key') ||
    [...parsed.searchParams.keys()].some(
      (key) => key !== 'key' && key !== 'password' && key !== 'alias'
    )
  ) {
    throw new Error('Invalid connection protocol');
  }
  return parsed;
}

export function withRustDeskPeerAlias(uri: string, alias?: string): string {
  const parsed = validatedUri(uri);
  const cleanAlias = sanitizePeerAlias(alias);
  if (cleanAlias) {
    parsed.searchParams.set('alias', cleanAlias);
  }
  return parsed.toString();
}

export function manualRustDeskUri(baseUri: string, password: string, alias?: string): string {
  const parsed = validatedUri(baseUri);
  if (
    parsed.searchParams.has('password') ||
    !password ||
    password.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(password)
  ) {
    throw new Error('Invalid manual handoff');
  }
  parsed.searchParams.set('password', password);
  const cleanAlias = sanitizePeerAlias(alias);
  if (cleanAlias) {
    parsed.searchParams.set('alias', cleanAlias);
  }
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
  const isCustomProtocol = targetUri.startsWith('rustdesk:');
  let launchFrame: HTMLIFrameElement | null = null;
  if (isCustomProtocol) {
    launchFrame = document.querySelector<HTMLIFrameElement>('iframe[name="rustdesk-launch-frame"]');
    if (!launchFrame) {
      launchFrame = document.createElement('iframe');
      launchFrame.name = 'rustdesk-launch-frame';
      launchFrame.style.display = 'none';
      launchFrame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(launchFrame);
    }
  }
  const anchor = document.createElement('a');
  try {
    anchor.href = targetUri;
    if (launchFrame) {
      anchor.target = 'rustdesk-launch-frame';
    } else {
      anchor.rel = 'noopener noreferrer';
    }
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.removeAttribute('href');
    anchor.remove();
  }
}

export function launchRustDesk(uri: string, peerAlias?: string): void {
  const uriWithAlias = peerAlias ? withRustDeskPeerAlias(uri, peerAlias) : uri;
  const targetUri = buildPlatformLaunchUri(uriWithAlias);
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

export function buildRustDeskPeerAliasPowerShellCommand(rustdeskId: string, alias: string): string {
  const cleanId = rustdeskId.replace(/\s+/g, '').trim();
  const cleanAlias = (sanitizePeerAlias(alias) || 'SERVIDOR').replace(/'/g, "''");
  return buildRustDeskBulkAliasSyncPowerShellCommand([{ rustdeskId: cleanId, alias: cleanAlias }]);
}

export function buildRustDeskBulkAliasSyncPowerShellCommand(
  peers: Array<{ rustdeskId: string; alias: string }>
): string {
  const entries = peers
    .map((p) => ({
      id: p.rustdeskId.replace(/\s+/g, '').trim(),
      alias: (sanitizePeerAlias(p.alias) || 'SERVIDOR').replace(/'/g, "''"),
    }))
    .filter((p) => /^[0-9]{6,16}$/.test(p.id))
    .map((p) => `@{id='${p.id}';name='${p.alias}'}`)
    .join(',');

  const srv = RUSTDESK_SERVER_HOST;
  const key = RUSTDESK_PUBLIC_KEY;

  return [
    `$srv='${srv}'; $key='${key}'; $utf8=[Text.UTF8Encoding]::new($false);`,
    `$dir="$env:APPDATA\\RustDesk\\config\\peers"; New-Item -Force -ItemType Directory -Path $dir | Out-Null;`,
    `$peers=@(${entries});`,
    `foreach($item in $peers){`,
    `  $id=$item.id; $name=$item.name;`,
    `  foreach($pk in @("$id@$srv?key=$key","$id@$srv","$id")){`,
    `    $b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pk));`,
    `    $files=@("$dir\\base64_$b.toml"); if($pk -eq $id){$files+="$dir\\$id.toml"};`,
    `    foreach($f in $files){`,
    `      New-Item -Force -ItemType Directory -Path ([IO.Path]::GetDirectoryName($f)) | Out-Null;`,
    `      if(Test-Path $f){`,
    `        $c=[IO.File]::ReadAllText($f, $utf8).TrimStart([char]0xFEFF);`,
    `        if($c -match '(?m)^alias\\s*='){ $c=[regex]::Replace($c,'(?m)^alias\\s*=.*$',"alias = '$name'") }`,
    `        elseif($c -match '\\[options\\]'){ $c=$c -replace '\\[options\\]',"[options]\`r\`nalias = '$name'" }`,
    `        else { $c+="\r\n[options]\r\nalias = '$name'\r\n" };`,
    `        if($pk -like '*?key=*'){ $c=[regex]::Replace($c,'(?m)^hostname\\s*=.*$',"hostname = ''") };`,
    `        [IO.File]::WriteAllText($f, $c, $utf8)`,
    `      } else {`,
    `        [IO.File]::WriteAllText($f, "[options]\`r\`nother-server-key = '$key'\`r\`nalias = '$name'\`r\`n\`r\`n[info]\`r\`nhostname = ''\`r\`n", $utf8)`,
    `      }`,
    `    }`,
    `  }`,
    `}`,
  ].join(' ');
}
