import type { DeviceView } from '@appremoto/contracts';
import type { ReactNode } from 'react';
import { parseSystemInfo, resolveDeviceNetworkIps } from './system-info';

export function formatLastSeen(value: string | null): string {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export type DeviceStatusState = 'current' | 'refreshing' | 'unavailable';

export function DeviceStatus({ device, state }: { device: DeviceView; state: DeviceStatusState }) {
  const label = state === 'refreshing' ? 'Atualizando' : state === 'unavailable' ? 'Indisponivel' : device.status;
  const className = state === 'current' ? `status-${device.status.toLowerCase()}` : `status-${state}`;
  return <span className={`device-status ${className}`}>{label}</span>;
}

export function DeviceRecord({ device, statusState, action }: { device: DeviceView; statusState: DeviceStatusState; action?: ReactNode }) {
  const sys = parseSystemInfo(device.operatingSystem, device.osVersion);
  const { localIp, publicIp } = resolveDeviceNetworkIps(device);
  const dd = device.datadivas;
  const fields: [string, string][] = [
    ['Organizacao', device.organizationName],
    ['Hostname', device.hostname],
    ['Sistema operacional', sys.summary],
    ['RustDesk ID', device.rustdeskId],
    ['IP Local', localIp || 'N/D'],
    ['IP Público', publicIp || 'N/D'],
  ];
  if (dd?.nomeFantasia) fields.push(['Nome Fantasia', dd.nomeFantasia]);
  if (dd?.razaoSocial) fields.push(['Razão Social', dd.razaoSocial]);
  if (dd?.cnpj) fields.push(['CNPJ / CPF', dd.cnpj]);
  if (dd?.serial) fields.push(['Serial DataDivas', dd.serial]);
  if (dd?.ie) fields.push(['Inscrição Estadual', dd.ie]);
  if (dd?.endereco || dd?.cidade || dd?.uf) {
    const loc = [dd.endereco, [dd.cidade, dd.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
    fields.push(['Endereço', loc]);
  }
  if (dd?.ipDataDivas) fields.push(['IP DataDivas', dd.ipDataDivas]);
  return (
    <article className="device-record" aria-label={device.displayName}>
      <h2 className="device-value">{device.displayName}</h2>
      <dl>
        {fields.map(([label, fieldValue]) => <div key={label}><dt>{label}</dt><dd className="device-value">{fieldValue}</dd></div>)}
        <div><dt>Status</dt><dd><DeviceStatus device={device} state={statusState} /></dd></div>
        <div><dt>Ultima atividade</dt><dd className="device-value">{formatLastSeen(device.lastSeenAt)}</dd></div>
      </dl>
      {action && <div className="device-record-action">{action}</div>}
    </article>
  );
}

