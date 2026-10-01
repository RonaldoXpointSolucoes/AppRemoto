export function launchRustDesk(uri: string): void {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'rustdesk:') throw new Error('Invalid connection protocol');
  // Handoff only: credentials never become a rendered href, cache entry or stored value.
  window.location.assign(uri);
}
