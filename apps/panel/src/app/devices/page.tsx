import { SessionBoundary } from '../../features/auth/session-boundary';

export default function DevicesPage() {
  return (
    <SessionBoundary>
      <main className="session-state"><h1>Dispositivos</h1></main>
    </SessionBoundary>
  );
}
