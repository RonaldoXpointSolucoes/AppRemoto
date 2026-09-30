'use client';

import type { DeviceListQuery } from '@appremoto/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiClientError, type DevicePage, type OrganizationView } from '../../lib/api';

export interface DeviceDirectoryService {
  getOrganizations(): Promise<OrganizationView[]>;
  getDevices(query: DeviceListQuery): Promise<DevicePage>;
  expireSession(): Promise<void>;
}

export interface DeviceFiltersValue {
  organizationId: string;
  status: '' | 'ONLINE' | 'OFFLINE';
  search: string;
}

interface PaginationState {
  filterKey: string;
  cursors: Array<string | undefined>;
  index: number;
}

function firstPage(filterKey: string): PaginationState {
  return { filterKey, cursors: [undefined], index: 0 };
}

function deviceQuery(filters: DeviceFiltersValue, cursor?: string): DeviceListQuery {
  return {
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 25,
  };
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export function useDevices(service: DeviceDirectoryService, filters: DeviceFiltersValue) {
  const filterKey = `${filters.organizationId}\u0000${filters.status}\u0000${filters.search}`;
  const [pagination, setPagination] = useState<PaginationState>(() => firstPage(filterKey));
  const activePagination = pagination.filterKey === filterKey ? pagination : firstPage(filterKey);
  const cursor = activePagination.cursors[activePagination.index];

  useEffect(() => {
    if (pagination.filterKey !== filterKey) setPagination(firstPage(filterKey));
  }, [filterKey, pagination.filterKey]);

  const organizations = useQuery({
    queryKey: ['organizations'],
    queryFn: () => service.getOrganizations(),
    retry: false,
    staleTime: 0,
  });
  const canLoadDevices = organizations.isSuccess && organizations.data.length > 0;
  const devices = useQuery({
    queryKey: ['devices', filters.organizationId, filters.status, filters.search, cursor ?? null],
    queryFn: () => service.getDevices(deviceQuery(filters, cursor)),
    enabled: canLoadDevices,
    retry: false,
    staleTime: 0,
  });

  const organizationInitialError = organizations.isError && !organizations.data;
  const deviceInitialError = devices.isError && !devices.data;
  const backgroundError = organizations.isError && organizations.data
    ? organizations.error
    : devices.isError && devices.data ? devices.error : null;

  return {
    organizations,
    devices,
    rows: devices.data?.devices ?? [],
    error: organizationInitialError ? organizations.error : deviceInitialError ? devices.error : null,
    backgroundError,
    isOrganizationLoading: organizations.isPending,
    isPageLoading: canLoadDevices && devices.isPending,
    isRefreshing: (organizations.isFetching && !organizations.isPending)
      || (devices.isFetching && !devices.isPending),
    hasPreviousPage: activePagination.index > 0,
    hasNextPage: Boolean(devices.data?.nextCursor),
    previousPage: () => setPagination((current) => {
      const active = current.filterKey === filterKey ? current : firstPage(filterKey);
      return { ...active, index: Math.max(0, active.index - 1) };
    }),
    nextPage: () => {
      const nextCursor = devices.data?.nextCursor;
      if (!nextCursor) return;
      setPagination((current) => {
        const active = current.filterKey === filterKey ? current : firstPage(filterKey);
        return {
          filterKey,
          cursors: [...active.cursors.slice(0, active.index + 1), nextCursor],
          index: active.index + 1,
        };
      });
    },
    refresh: async () => {
      const work: Promise<unknown>[] = [organizations.refetch()];
      if (canLoadDevices) work.push(devices.refetch());
      await Promise.all(work);
    },
    retry: async () => {
      if (organizationInitialError) await organizations.refetch();
      else if (devices.isError) await devices.refetch();
    },
  };
}
