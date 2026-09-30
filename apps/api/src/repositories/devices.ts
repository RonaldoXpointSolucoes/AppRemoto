import { Query, type Databases, type Models } from 'node-appwrite';

export interface DeviceRecord {
  id: string;
  createdAt: string;
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

export interface DeviceScan {
  records: DeviceRecord[];
  hasMore: boolean;
}

export interface DeviceRepository {
  scan(organizationIds: string[], afterId: string | null, snapshotTime: string, limit: number): Promise<DeviceScan>;
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

const selectedFields = ['$id', '$createdAt', 'organization_id', 'device_uuid', 'display_name',
  'hostname', 'operating_system', 'os_version', 'rustdesk_id', 'agent_version',
  'rustdesk_version', 'last_seen_at', 'enabled'];

export function createDeviceRepository(databases: Databases): DeviceRepository {
  return {
    async scan(organizationIds, afterId, snapshotTime, limit) {
      if (!organizationIds.length || organizationIds.length > 25 || limit < 1 || limit > 99) {
        throw new Error('Invalid device scan bounds');
      }
      const queries = [Query.equal('organization_id', organizationIds),
        Query.lessThanEqual('$createdAt', snapshotTime), Query.select(selectedFields),
        Query.orderAsc('$id'), Query.limit(limit + 1)];
      if (afterId) queries.push(Query.greaterThan('$id', afterId));
      const page = await databases.listDocuments<DeviceDocument>('remote_management', 'devices', queries);
      const documents = page.documents.slice(0, limit);
      if (documents.some((doc) => !organizationIds.includes(doc.organization_id) ||
          doc.$createdAt > snapshotTime || (afterId !== null && doc.$id <= afterId))) {
        throw new Error('Invalid Appwrite device page');
      }
      return {
        records: documents.map((doc) => ({
          id: doc.$id, createdAt: doc.$createdAt, organizationId: doc.organization_id,
          deviceUuid: doc.device_uuid, displayName: doc.display_name, hostname: doc.hostname,
          operatingSystem: doc.operating_system, osVersion: doc.os_version,
          rustdeskId: doc.rustdesk_id, agentVersion: doc.agent_version ?? null,
          rustdeskVersion: doc.rustdesk_version ?? null, lastSeenAt: doc.last_seen_at ?? null,
          enabled: doc.enabled,
        })),
        hasMore: page.documents.length > limit,
      };
    },
  };
}
