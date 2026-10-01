'use client';

import type { DeviceView } from '@appremoto/contracts';
import { ChevronLeft, ChevronRight, Download, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { expireSession, logoutSession, onSessionClear, sessionEpoch } from '../auth/session-cache';

import { DeviceFilters } from './device-filters';
import { ConnectDevice } from './connect-device';
import { DeviceTools } from './device-tools';
import type { ConnectionLogEvent } from './connection-log';
import { DeviceRecord, DeviceStatus, formatLastSeen, type DeviceStatusState } from './device-record';
import { isUnauthorized, useDevices, type DeviceDirectoryService, type DeviceFiltersValue } from './use-devices';

export type { DeviceDirectoryService } from './use-devices';

function DeviceRows({ devices, statusState, service, canConnect, onDetails, onEvent, onSessionExpired }: { devices: DeviceView[]; statusState: DeviceStatusState; service: DeviceDirectoryService; canConnect(organizationId: string): boolean; onDetails(device: DeviceView): void; onEvent(deviceId: string, event: ConnectionLogEvent): void; onSessionExpired(): void }) {
  const action = (device: DeviceView) => <div className="device-actions">
    {service.connectDevice && canConnect(device.organizationId) && <ConnectDevice deviceId={device.id} enabled={device.enabled && device.status === 'ONLINE' && statusState === 'current'}
      service={{ connectDevice: service.connectDevice, recordConnectionEvent: service.recordConnectionEvent }} onEvent={(event) => onEvent(device.id, event)} onHelp={() => onDetails(device)} onSessionExpired={onSessionExpired} />}
    {service.getDeviceDetails && service.getConnectionHistory && <button type="button" className="text-button" onClick={() => onDetails(device)}>Detalhes e opções</button>}
  </div>;
  return <>
    <div className="device-table-wrap">
      <table className="device-table" aria-label="Dispositivos remotos">
        <thead><tr>{['Dispositivo', 'Organizacao', 'Hostname', 'Sistema operacional', 'RustDesk ID', 'Status', 'Ultima atividade', 'Acesso'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{devices.map((device) => <tr key={device.id}>
          <td className="device-value">{device.displayName}</td><td className="device-value">{device.organizationName}</td>
          <td className="device-value">{device.hostname}</td><td className="device-value">{device.operatingSystem} {device.osVersion}</td>
          <td className="device-value">{device.rustdeskId}</td><td><DeviceStatus device={device} state={statusState} /></td>
          <td className="device-value">{formatLastSeen(device.lastSeenAt)}</td>
          <td>{action(device)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="device-records">{devices.map((device) => <DeviceRecord key={device.id} device={device} statusState={statusState} action={action(device)} />)}</div>
  </>;
}

export function DeviceDirectory({ service, onSessionExpired }: { service: DeviceDirectoryService; onSessionExpired(): void }) {
  const queryClient = useQueryClient();
  const [epoch] = useState(() => sessionEpoch(queryClient));
  const [filters, setFilters] = useState<DeviceFiltersValue>({ organizationId: '', status: '', search: '' });
  const [selected, setSelected] = useState<DeviceView>();
  const [connectionEvents, setConnectionEvents] = useState<Record<string, ConnectionLogEvent[]>>({});
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const query = useDevices(service, filters);
  useEffect(() => onSessionClear(queryClient, () => { setSelected(undefined); setConnectionEvents({}); }), [queryClient]);
  const addEvent = (deviceId: string, event: ConnectionLogEvent) => {
    if (sessionEpoch(queryClient) !== epoch) return;
    setConnectionEvents((old) => ({ ...old, [deviceId]: [...(old[deviceId] ?? []), event].slice(-200) }));
  };
  const handledExpiry = useRef(false);
  const logoutLock = useRef(false);
  const navigationHandled = useRef(false);
  const unauthorized = isUnauthorized(query.error ?? query.backgroundError);
  const finishSession = useCallback(() => {
    if (navigationHandled.current) return;
    navigationHandled.current = true;
    onSessionExpired();
  }, [onSessionExpired]);

  useEffect(() => {
    if (!unauthorized || handledExpiry.current) return;
    handledExpiry.current = true;
    void expireSession(queryClient, epoch, () => service.expireSession()).then((expired) => {
      if (expired) finishSession();
    });
  }, [epoch, finishSession, queryClient, service, unauthorized]);

  function handleExpiredAction() {
    if (handledExpiry.current || sessionEpoch(queryClient) !== epoch) return;
    handledExpiry.current = true;
    void expireSession(queryClient, epoch, () => service.expireSession()).then((expired) => { if (expired) finishSession(); });
  }

  async function handleLogout() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setLogoutPending(true);
    setLogoutError(false);
    const loggedOut = await logoutSession(queryClient, epoch, () => service.expireSession());
    if (loggedOut) {
      finishSession();
      return;
    }
    logoutLock.current = false;
    if (sessionEpoch(queryClient) === epoch) {
      setLogoutPending(false);
      setLogoutError(true);
    }
  }

  const organizations = query.organizations.data ?? [];
  const hasFilter = Boolean(filters.organizationId || filters.status || filters.search);
  let emptyMessage = 'Nenhum dispositivo cadastrado nas organizacoes autorizadas.';
  if (hasFilter) emptyMessage = filters.organizationId && !filters.status && !filters.search
    ? 'Esta organizacao ainda nao possui dispositivos.'
    : 'Nenhum dispositivo corresponde aos filtros.';

  return <main className="devices-shell">
    <header className="devices-header">
      <div><p className="product-name">AppRemoto</p><h1>Dispositivos</h1></div>
      <div className="devices-header-actions">
        <Link className="command-button guide-link" href="/setup"><Download aria-hidden="true" size={19} />Instalar no cliente</Link>
        <button className="icon-button" type="button" title="Sair da conta" aria-label="Sair da conta" aria-busy={logoutPending} disabled={logoutPending} onClick={() => void handleLogout()}>
          <LogOut aria-hidden="true" size={19} />
        </button>
      </div>
    </header>
    {logoutError && <p className="logout-error" role="alert">Nao foi possivel sair. Tente novamente.</p>}
    {query.isOrganizationLoading && <section className="device-state" role="status">Carregando dispositivos...</section>}
    {!query.isOrganizationLoading && unauthorized && <section className="device-state error-state" role="alert">Sessao expirada. Entre novamente.</section>}
    {!query.isOrganizationLoading && query.error && !unauthorized && <section className="device-state error-state" role="alert">
      <p>Nao foi possivel carregar os dispositivos.</p><button className="primary-button" type="button" onClick={() => void query.retry()}>Tentar novamente</button>
    </section>}
    {!query.isOrganizationLoading && !query.error && organizations.length === 0 && <section className="device-state">Nenhuma organizacao autorizada.</section>}
    {!query.isOrganizationLoading && !query.error && !unauthorized && organizations.length > 0 && <>
      <DeviceFilters organizations={organizations} value={filters} refreshing={query.isRefreshing} onChange={setFilters} onRefresh={() => void query.refresh()} />
      {query.backgroundError && <p className="refresh-error" role="alert">Nao foi possivel atualizar os dispositivos. Os status estao indisponiveis.</p>}
      {query.isPageLoading ? <section className="device-state" role="status">Carregando dispositivos...</section>
        : query.rows.length === 0 ? <section className="device-state">{emptyMessage}</section>
          : <DeviceRows devices={query.rows} statusState={query.backgroundError ? 'unavailable' : query.isRefreshing ? 'refreshing' : 'current'} service={service} canConnect={query.canConnect} onDetails={setSelected} onEvent={addEvent} onSessionExpired={handleExpiredAction} />}
      {!query.isPageLoading && (query.hasPreviousPage || query.hasNextPage) && <nav className="pagination" aria-label="Paginacao de dispositivos">
        {query.hasPreviousPage && <button className="command-button" type="button" aria-label="Pagina anterior" disabled={query.isRefreshing || Boolean(query.backgroundError)} onClick={query.previousPage}><ChevronLeft aria-hidden="true" size={18} />Anterior</button>}
        {query.hasNextPage && <button className="command-button" type="button" aria-label="Proxima pagina" disabled={query.isRefreshing || Boolean(query.backgroundError)} onClick={query.nextPage}>Proxima<ChevronRight aria-hidden="true" size={18} /></button>}
      </nav>}
    </>}
    {selected && <DeviceTools device={query.rows.find((row) => row.id === selected.id) ?? selected} service={service}
      canConnect={query.canConnect(selected.organizationId)} canManage={query.canManage(selected.organizationId)}
      events={connectionEvents[selected.id] ?? []} onEvent={(event) => addEvent(selected.id, event)} onClose={() => setSelected(undefined)} onSaved={() => query.refresh()} onSessionExpired={handleExpiredAction} />}
  </main>;
}
