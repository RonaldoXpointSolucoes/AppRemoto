import { Query, type Databases, type Models } from 'node-appwrite';

export interface DeviceRecord {
  id: string;
  organizationId: string;
  deviceUuid: string;
  displayName: string;
  hostname: string;
  operatingSystem: string;
  osVersion: string;
  rustdeskId: string;
  agentVersion: string | null;
  rustdeskVersion: string | null;
  lastSeenAt: string | null;
  enabled: boolean;
}

export interface DeviceRepository {
  listByOrganization(organizationId: string): Promise<DeviceRecord[]>;
}

type DeviceDocument = Models.Document & {
  organization_id: string;
  device_uuid: string;
  display_name: string;
  hostname: string;
  operating_system: string;
  os_version: string;
  rustdesk_id: string;
  agent_version?: string | null;
  rustdesk_version?: string | null;
  last_seen_at?: string | null;
  enabled: boolean;
};

const selectedFields = ['$id', 'organization_id', 'device_uuid', 'display_name', 'hostname',
  'operating_system', 'os_version', 'rustdesk_id', 'agent_version', 'rustdesk_version',
  'last_seen_at', 'enabled'];
const pageSize = 100;
const maxPages = 1000;

export function createDeviceRepository(databases: Databases): DeviceRepository {
  return {
    async listByOrganization(organizationId) {
      const devices: DeviceRecord[] = [];
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const page = await databases.listDocuments<DeviceDocument>('remote_management', 'devices', [
          Query.equal('organization_id', organizationId), Query.select(selectedFields),
          Query.orderAsc('$id'), Query.limit(pageSize), Query.offset(devices.length),
        ]);
        devices.push(...page.documents.map((doc) => ({
          id: doc.$id, organizationId: doc.organization_id, deviceUuid: doc.device_uuid,
          displayName: doc.display_name, hostname: doc.hostname, operatingSystem: doc.operating_system,
          osVersion: doc.os_version, rustdeskId: doc.rustdesk_id,
          agentVersion: doc.agent_version ?? null, rustdeskVersion: doc.rustdesk_version ?? null,
          lastSeenAt: doc.last_seen_at ?? null, enabled: doc.enabled,
        })));
        if (devices.length >= page.total) return devices;
        if (!page.documents.length) throw new Error('Incomplete Appwrite device page');
      }
      throw new Error('Appwrite device page limit exceeded');
    },
  };
}
