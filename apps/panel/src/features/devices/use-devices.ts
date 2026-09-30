'use client';

import type { DeviceListQuery } from '@appremoto/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

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
  const organizations = useQuery({
    queryKey: ['organizations'],
    queryFn: () => service.getOrganizations(),
    retry: false,
    staleTime: 0,
  });
  const canLoadDevices = organizations.isSuccess && organizations.data.length > 0;
  const devices = useInfiniteQuery({
    queryKey: ['devices', filters.organizationId, filters.status, filters.search],
    queryFn: ({ pageParam }) => service.getDevices(deviceQuery(filters, pageParam ?? undefined)),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: canLoadDevices,
    retry: false,
    staleTime: 0,
  });

  return {
    organizations,
    devices,
    rows: devices.data?.pages.flatMap((page) => page.devices) ?? [],
    error: organizations.error ?? devices.error,
    isLoading: organizations.isPending || (canLoadDevices && devices.isPending),
    isRefreshing: (organizations.isFetching && !organizations.isPending)
      || (devices.isFetching && !devices.isPending && !devices.isFetchingNextPage),
    refresh: async () => {
      const work: Promise<unknown>[] = [organizations.refetch()];
      if (canLoadDevices) work.push(devices.refetch());
      await Promise.all(work);
    },
    retry: async () => {
      if (organizations.isError) await organizations.refetch();
      else if (devices.isError) await devices.refetch();
    },
  };
}
