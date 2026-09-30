'use client';

import type { DeviceListQuery } from '@appremoto/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError, type DevicePage, type OrganizationView } from '../../lib/api';
import { sessionEpoch } from '../auth/session-cache';

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
  snapshot: number;
}

function firstPage(filterKey: string, snapshot = 0): PaginationState {
  return { filterKey, cursors: [undefined], index: 0, snapshot };
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
  const queryClient = useQueryClient();
  const [epoch] = useState(() => sessionEpoch(queryClient));
  const filterKey = `${filters.organizationId}\u0000${filters.status}\u0000${filters.search}`;
  const [pagination, setPagination] = useState<PaginationState>(() => firstPage(filterKey));
  const activePagination = pagination.filterKey === filterKey ? pagination : firstPage(filterKey);
  const cursor = activePagination.cursors[activePagination.index];
  const retained = useRef<{ filterKey: string; snapshot: number; data: DevicePage } | undefined>(undefined);
  const refreshLock = useRef(false);

  useEffect(() => {
    if (pagination.filterKey !== filterKey) setPagination(firstPage(filterKey));
  }, [filterKey, pagination.filterKey]);

  const organizations = useQuery({
    queryKey: ['session', epoch, 'organizations'],
    queryFn: () => service.getOrganizations(),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const canLoadDevices = organizations.isSuccess && organizations.data.length > 0;
  const devices = useQuery({
    queryKey: ['session', epoch, 'devices', filterKey, activePagination.snapshot, cursor ?? null],
    queryFn: () => service.getDevices(deviceQuery(filters, cursor)),
    enabled: canLoadDevices,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (devices.data && devices.isSuccess) {
    retained.current = { filterKey, snapshot: activePagination.snapshot, data: devices.data };
  }
  const previousSnapshot = retained.current?.filterKey === filterKey
    && retained.current.snapshot !== activePagination.snapshot ? retained.current.data : undefined;
  const page = devices.data ?? previousSnapshot;
  const fetching = organizations.isFetching || devices.isFetching;
  useEffect(() => {
    if (!fetching) refreshLock.current = false;
  }, [fetching]);

  function refresh() {
    if (fetching || refreshLock.current || sessionEpoch(queryClient) !== epoch) return;
    refreshLock.current = true;
    setPagination((current) => firstPage(filterKey, current.snapshot + 1));
    void organizations.refetch();
  }

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const timer = setInterval(() => refreshRef.current(), 30_000);
    return () => clearInterval(timer);
  }, []);

  const organizationInitialError = organizations.isError && !organizations.data;
  const deviceInitialError = devices.isError && !page;
  const backgroundError = organizations.isError && organizations.data
    ? organizations.error
    : devices.isError && page ? devices.error : null;

  return {
    organizations,
    devices,
    rows: page?.devices ?? [],
    error: organizationInitialError ? organizations.error : deviceInitialError ? devices.error : null,
    backgroundError,
    isOrganizationLoading: organizations.isPending,
    isPageLoading: canLoadDevices && devices.isPending && !page,
    isRefreshing: (organizations.isFetching && !organizations.isPending)
      || (devices.isFetching && Boolean(page)),
    hasPreviousPage: activePagination.index > 0,
    hasNextPage: Boolean(page?.nextCursor),
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
          snapshot: active.snapshot,
          cursors: [...active.cursors.slice(0, active.index + 1), nextCursor],
          index: active.index + 1,
        };
      });
    },
    refresh,
    retry: async () => {
      if (organizationInitialError) await organizations.refetch();
      else if (devices.isError) refresh();
    },
  };
}
