'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import type { OrganizationView } from '../../lib/api';
import type { DeviceFiltersValue } from './use-devices';

interface DeviceFiltersProps {
  organizations: OrganizationView[];
  value: DeviceFiltersValue;
  refreshing: boolean;
  onChange(value: DeviceFiltersValue): void;
  onRefresh(): void;
}

export function DeviceFilters({ organizations, value, refreshing, onChange, onRefresh }: DeviceFiltersProps) {
  const [search, setSearch] = useState(value.search);
  useEffect(() => setSearch(value.search), [value.search]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onChange({ ...value, search: search.trim() });
  }

  return (
    <form className="device-filters" onSubmit={submit}>
      <label className="filter-control">
        <span>Organizacao</span>
        <select value={value.organizationId} onChange={(event) => onChange({ ...value, organizationId: event.target.value })}>
          <option value="">Todas</option>
          {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
        </select>
      </label>
      <label className="filter-control">
        <span>Status</span>
        <select value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as DeviceFiltersValue['status'] })}>
          <option value="">Todos</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
        </select>
      </label>
      <label className="filter-control search-control">
        <span>Buscar dispositivos</span>
        <input value={search} maxLength={128} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, hostname ou RustDesk ID" />
      </label>
      <button className="command-button" type="submit" title="Buscar dispositivos"><Search aria-hidden="true" size={17} />Buscar</button>
      <button className="icon-button" type="button" title="Atualizar dispositivos" aria-label={refreshing ? 'Atualizando dispositivos' : 'Atualizar dispositivos'} disabled={refreshing} onClick={onRefresh}>
        <RefreshCw aria-hidden="true" size={18} className={refreshing ? 'spin' : undefined} />
      </button>
    </form>
  );
}
