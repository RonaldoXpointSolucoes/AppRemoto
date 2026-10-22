'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { SessionBoundary } from '../../features/auth/session-boundary';
import { clearVerifiedSessionBootstrap } from '../../features/auth/session-cache';
import { DeviceDirectory, type DeviceDirectoryService } from '../../features/devices/device-table';
import { buildPreservedRoute } from '../../features/embed/chatbot-bridge';
import { createApiClient } from '../../lib/api';
import { createAppwriteSessionClient, deleteCurrentSessionSafely } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';

function createEmbedDeviceDirectoryService(): DeviceDirectoryService {
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
    getCnpjGroups: api.getCnpjGroups,
    suggestCnpjName: api.suggestCnpjName,
    executeCnpjGroupAction: api.executeCnpjGroupAction,
    migrateCnpjGroups: api.migrateCnpjGroups,
    expireSession: async () => {
      clearVerifiedSessionBootstrap();
      await deleteCurrentSessionSafely(account, 2_500);
    },
  };
}

export default function EmbedDevicesPage() {
  const router = useRouter();
  const service = useMemo(() => createEmbedDeviceDirectoryService(), []);
  return (
    <SessionBoundary>
      <DeviceDirectory
        service={service}
        onSessionExpired={() => router.replace(buildPreservedRoute('/login'))}
      />
    </SessionBoundary>
  );
}
