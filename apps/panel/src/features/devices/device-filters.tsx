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

  // Opções padrão requisitadas: Recentes, Clientes, X-Point Soluções, Servidores e infra
  const standardCategoryOptions = [
    { value: '', label: 'Todas' },
    { value: 'recent', label: 'Recentes' },
    { value: 'group_clients', label: 'Clientes' },
    { value: 'group_xpoint', label: 'X-Point Soluções' },
    { value: 'group_servers', label: 'Servidores e infra' },
  ];

  const extraOrganizations = organizations.filter((org) => {
    const norm = org.name.toLowerCase().trim();
    return (
      !['todas', 'recentes', 'clientes', 'x-point soluções', 'x-point solucoes', 'servidores e infra'].includes(norm) &&
      !['recent', 'group_clients', 'group_xpoint', 'group_servers'].includes(org.id)
    );
  });

  return (
    <form className="device-filters" onSubmit={submit}>
      <label className="filter-control">
        <span>Organizacao</span>
        <select value={value.organizationId} onChange={(event) => onChange({ ...value, organizationId: event.target.value })}>
          {standardCategoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          {extraOrganizations.map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
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
