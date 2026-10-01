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
export function launchRustDesk(uri: string): void {
  validatedUri(uri);
  // Handoff only: credentials never become a rendered href, cache entry or stored value.
  window.location.assign(uri);
}
