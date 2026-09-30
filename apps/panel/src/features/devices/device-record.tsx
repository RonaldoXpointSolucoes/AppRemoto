import type { DeviceView } from '@appremoto/contracts';

export function formatLastSeen(value: string | null): string {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function DeviceStatus({ device, refreshing }: { device: DeviceView; refreshing: boolean }) {
  const label = refreshing ? 'Atualizando' : device.status;
  return <span className={`device-status ${refreshing ? 'status-refreshing' : `status-${device.status.toLowerCase()}`}`}>{label}</span>;
}

export function DeviceRecord({ device, refreshing }: { device: DeviceView; refreshing: boolean }) {
  const fields = [
    ['Organizacao', device.organizationName],
    ['Hostname', device.hostname],
    ['Sistema operacional', `${device.operatingSystem} ${device.osVersion}`],
    ['RustDesk ID', device.rustdeskId],
  ] as const;
  return (
    <article className="device-record" aria-label={device.displayName}>
      <h2 className="device-value">{device.displayName}</h2>
      <dl>
        {fields.map(([label, fieldValue]) => <div key={label}><dt>{label}</dt><dd className="device-value">{fieldValue}</dd></div>)}
        <div><dt>Status</dt><dd><DeviceStatus device={device} refreshing={refreshing} /></dd></div>
        <div><dt>Ultima atividade</dt><dd className="device-value">{formatLastSeen(device.lastSeenAt)}</dd></div>
      </dl>
    </article>
  );
}
