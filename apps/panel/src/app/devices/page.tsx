'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { SessionBoundary } from '../../features/auth/session-boundary';
import { DeviceDirectory, type DeviceDirectoryService } from '../../features/devices/device-table';
import { createApiClient } from '../../lib/api';
import { createAppwriteSessionClient } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';

function createDeviceDirectoryService(): DeviceDirectoryService {
  const config = getPublicConfig();
  const { account, getJwt } = createAppwriteSessionClient(config);
  const api = createApiClient({ baseUrl: config.apiBaseUrl, getJwt });
  return {
    getMe: api.getMe,
    connectDevice: api.connectDevice,
    getDeviceDetails: api.getDeviceDetails,
    updateDevice: api.updateDevice,
    deleteDevice: api.deleteDevice,
    getConnectionHistory: api.getConnectionHistory,
    recordConnectionEvent: api.recordConnectionEvent,
    getOrganizations: api.getOrganizations,
    getDevices: api.getDevices,
    expireSession: async () => { await account.deleteSession('current'); },
  };
}

export default function DevicesPage() {
  const router = useRouter();
  const service = useMemo(() => createDeviceDirectoryService(), []);
  return (
    <SessionBoundary>
      <DeviceDirectory service={service} onSessionExpired={() => router.replace('/login')} />
    </SessionBoundary>
  );
}
