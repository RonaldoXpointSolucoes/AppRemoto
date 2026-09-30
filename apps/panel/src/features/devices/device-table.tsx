'use client';

import type { DeviceView } from '@appremoto/contracts';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DeviceFilters } from './device-filters';
import { DeviceRecord, DeviceStatus, formatLastSeen } from './device-record';
import { isUnauthorized, useDevices, type DeviceDirectoryService, type DeviceFiltersValue } from './use-devices';

export type { DeviceDirectoryService } from './use-devices';

function DeviceRows({ devices, refreshing }: { devices: DeviceView[]; refreshing: boolean }) {
  return <>
    <div className="device-table-wrap">
      <table className="device-table" aria-label="Dispositivos remotos">
        <thead><tr>{['Dispositivo', 'Organizacao', 'Hostname', 'Sistema operacional', 'RustDesk ID', 'Status', 'Ultima atividade'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{devices.map((device) => <tr key={device.id}>
          <td className="device-value">{device.displayName}</td><td className="device-value">{device.organizationName}</td>
          <td className="device-value">{device.hostname}</td><td className="device-value">{device.operatingSystem} {device.osVersion}</td>
          <td className="device-value">{device.rustdeskId}</td><td><DeviceStatus device={device} refreshing={refreshing} /></td>
          <td className="device-value">{formatLastSeen(device.lastSeenAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="device-records">{devices.map((device) => <DeviceRecord key={device.id} device={device} refreshing={refreshing} />)}</div>
  </>;
}

export function DeviceDirectory({ service, onSessionExpired }: { service: DeviceDirectoryService; onSessionExpired(): void }) {
  const [filters, setFilters] = useState<DeviceFiltersValue>({ organizationId: '', status: '', search: '' });
  const query = useDevices(service, filters);
  const handledExpiry = useRef(false);
  const unauthorized = isUnauthorized(query.error);

  useEffect(() => {
    if (!unauthorized || handledExpiry.current) return;
    handledExpiry.current = true;
    void service.expireSession().catch(() => undefined).finally(onSessionExpired);
  }, [onSessionExpired, service, unauthorized]);

  const organizations = query.organizations.data ?? [];
  const hasFilter = Boolean(filters.organizationId || filters.status || filters.search);
  let emptyMessage = 'Nenhum dispositivo cadastrado nas organizacoes autorizadas.';
  if (hasFilter) emptyMessage = filters.organizationId && !filters.status && !filters.search
    ? 'Esta organizacao ainda nao possui dispositivos.'
    : 'Nenhum dispositivo corresponde aos filtros.';

  return <main className="devices-shell">
    <header className="devices-header"><div><p className="product-name">AppRemoto</p><h1>Dispositivos</h1></div></header>
    {query.isLoading && <section className="device-state" role="status">Carregando dispositivos...</section>}
    {!query.isLoading && unauthorized && <section className="device-state error-state" role="alert">Sessao expirada. Entre novamente.</section>}
    {!query.isLoading && query.error && !unauthorized && <section className="device-state error-state" role="alert">
      <p>Nao foi possivel carregar os dispositivos.</p><button className="primary-button" type="button" onClick={() => void query.retry()}>Tentar novamente</button>
    </section>}
    {!query.isLoading && !query.error && organizations.length === 0 && <section className="device-state">Nenhuma organizacao autorizada.</section>}
    {!query.isLoading && !query.error && organizations.length > 0 && <>
      <DeviceFilters organizations={organizations} value={filters} refreshing={query.isRefreshing} onChange={setFilters} onRefresh={() => void query.refresh()} />
      {query.rows.length === 0 ? <section className="device-state">{emptyMessage}</section> : <DeviceRows devices={query.rows} refreshing={query.isRefreshing} />}
      {query.devices.hasNextPage && <div className="pagination"><button className="command-button" type="button" disabled={query.devices.isFetchingNextPage} onClick={() => void query.devices.fetchNextPage()}>
        <ChevronDown aria-hidden="true" size={18} />{query.devices.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
      </button></div>}
    </>}
  </main>;
}
