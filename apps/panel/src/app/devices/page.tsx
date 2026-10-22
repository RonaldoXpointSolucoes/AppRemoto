'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { SessionBoundary } from '../../features/auth/session-boundary';
import { createLoginService, type LoginService } from '../../features/auth/session';
import { DeviceDirectory, type DeviceDirectoryService } from '../../features/devices/device-table';
import { buildPreservedRoute } from '../../features/embed/chatbot-bridge';
import { createApiClient, type DevicePage, type OrganizationView, type TechnicianView } from '../../lib/api';
import { createAppwriteSessionClient } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';

function createDevicesPageServices(): {
  directoryService: DeviceDirectoryService;
  loginService: LoginService;
} {
  const config = getPublicConfig();
  const { account, getJwt } = createAppwriteSessionClient(config);
  const api = createApiClient({ baseUrl: config.apiBaseUrl, getJwt });
  const baseLogin = createLoginService();

  let meBootstrap: { promise: Promise<TechnicianView>; expiresAt: number } | null = null;
  let orgsBootstrap: { promise: Promise<OrganizationView[]>; expiresAt: number } | null = null;
  let devicesBootstrap: { promise: Promise<DevicePage>; expiresAt: number } | null = null;

  const getMeOnce = () => {
    const now = Date.now();
    if (meBootstrap && now < meBootstrap.expiresAt) {
      const p = meBootstrap.promise;
      meBootstrap = null;
      return p;
    }
    return api.getMe();
  };

  const getOrgsOnce = () => {
    const now = Date.now();
    if (orgsBootstrap && now < orgsBootstrap.expiresAt) {
      const p = orgsBootstrap.promise;
      orgsBootstrap = null;
      return p;
    }
    return api.getOrganizations();
  };

  const getDevicesOnce: DeviceDirectoryService['getDevices'] = (query) => {
    const isDefaultUnfilteredPage =
      !query.organizationId && !query.status && !query.search && !query.cursor;
    const now = Date.now();
    if (isDefaultUnfilteredPage && devicesBootstrap && now < devicesBootstrap.expiresAt) {
      const p = devicesBootstrap.promise;
      devicesBootstrap = null;
      return p;
    }
    return api.getDevices(query);
  };

  const loginService: LoginService = {
    ...baseLogin,
    verifyProfile: async () => {
      const expiresAt = Date.now() + 8_000;
      const mePromise = api.getMe();
      meBootstrap = { promise: mePromise, expiresAt };

      const orgsPromise = api.getOrganizations();
      orgsPromise.catch(() => {});
      orgsBootstrap = { promise: orgsPromise, expiresAt };

      const devPromise = api.getDevices({ limit: 100 });
      devPromise.catch(() => {});
      devicesBootstrap = { promise: devPromise, expiresAt };

      await mePromise;
    },
    removeSession: async () => {
      meBootstrap = null;
      orgsBootstrap = null;
      devicesBootstrap = null;
      await account.deleteSession('current');
    },
  };

  const directoryService: DeviceDirectoryService = {
    getMe: getMeOnce,
    connectDevice: api.connectDevice,
    getDeviceDetails: api.getDeviceDetails,
    updateDevice: api.updateDevice,
    deleteDevice: api.deleteDevice,
    getConnectionHistory: api.getConnectionHistory,
    recordConnectionEvent: api.recordConnectionEvent,
    getOrganizations: getOrgsOnce,
    getDevices: getDevicesOnce,
    getCnpjGroups: api.getCnpjGroups,
    suggestCnpjName: api.suggestCnpjName,
    executeCnpjGroupAction: api.executeCnpjGroupAction,
    migrateCnpjGroups: api.migrateCnpjGroups,
    expireSession: async () => {
      meBootstrap = null;
      orgsBootstrap = null;
      devicesBootstrap = null;
      await account.deleteSession('current');
    },
  };

  return { directoryService, loginService };
}

export default function DevicesPage() {
  const router = useRouter();
  const { directoryService, loginService } = useMemo(() => createDevicesPageServices(), []);
  return (
    <SessionBoundary service={loginService}>
      <DeviceDirectory service={directoryService} onSessionExpired={() => router.replace(buildPreservedRoute('/login'))} />
    </SessionBoundary>
  );
}
