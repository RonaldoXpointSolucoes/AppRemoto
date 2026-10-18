import { AppwriteException, Query, type Databases } from 'node-appwrite';
import {
  NamingHistoryEventSchema,
  NamingReservationRecordSchema,
  type NamingHistoryEvent,
  type NamingReservationRecord,
} from '@appremoto/contracts';
import type { Organization } from './organizations.ts';

export interface RawDeviceDocument {
  id: string;
  createdAt: string;
  organizationId: string;
  deviceUuid: string;
  displayName: string;
  hostname: string;
  rustdeskId: string;
  operatingSystem: string;
  osVersion: string;
  agentVersion: string | null;
  rustdeskVersion: string | null;
  lastSeenAt: string | null;
  enabled: boolean;
  notes: string | null;
}

export interface CnpjNamingRepository {
  listOrganizations(): Promise<Organization[]>;
  getOrganization(id: string): Promise<Organization | null>;
  createOrganization(organization: Organization): Promise<void>;
  updateOrganization(id: string, patch: { name?: string; active?: boolean }): Promise<void>;
  listAllDevices(): Promise<RawDeviceDocument[]>;
  getDevice(deviceId: string): Promise<RawDeviceDocument | null>;
  updateDevice(
    deviceId: string,
    patch: {
      organizationId?: string;
      displayName?: string;
      hostname?: string;
      rustdeskId?: string;
      enabled?: boolean;
      notes?: string | null;
    },
  ): Promise<void>;
  getReservation(reservationId: string): Promise<NamingReservationRecord | null>;
  listReservations(groupId: string): Promise<NamingReservationRecord[]>;
  upsertReservation(record: NamingReservationRecord, sourceIp: string): Promise<void>;
  appendHistory(event: NamingHistoryEvent, sourceIp: string): Promise<void>;
  listHistory(groupId: string): Promise<NamingHistoryEvent[]>;
}

const database = 'remote_management';
const deviceFields = [
  '$id',
  '$createdAt',
  'organization_id',
  'device_uuid',
  'display_name',
  'hostname',
  'rustdesk_id',
  'operating_system',
  'os_version',
  'agent_version',
  'rustdesk_version',
  'last_seen_at',
  'enabled',
  'notes',
];

function mapDevice(doc: Record<string, unknown>): RawDeviceDocument {
  return {
    id: String(doc.$id ?? ''),
    createdAt: String(doc.$createdAt ?? new Date(0).toISOString()),
    organizationId: String(doc.organization_id ?? ''),
    deviceUuid: String(doc.device_uuid ?? ''),
    displayName: String(doc.display_name ?? ''),
    hostname: String(doc.hostname ?? ''),
    rustdeskId: String(doc.rustdesk_id ?? ''),
    operatingSystem: String(doc.operating_system ?? 'Windows'),
    osVersion: String(doc.os_version ?? ''),
    agentVersion: typeof doc.agent_version === 'string' ? doc.agent_version : null,
    rustdeskVersion: typeof doc.rustdesk_version === 'string' ? doc.rustdesk_version : null,
    lastSeenAt: typeof doc.last_seen_at === 'string' ? doc.last_seen_at : null,
    enabled: Boolean(doc.enabled),
    notes: typeof doc.notes === 'string' ? doc.notes : null,
  };
}

function mapOrganization(doc: Record<string, unknown>): Organization {
  return {
    id: String(doc.$id ?? ''),
    name: String(doc.name ?? ''),
    slug: String(doc.slug ?? ''),
    active: Boolean(doc.active),
  };
}

export function createCnpjNamingRepository(databases: Databases): CnpjNamingRepository {
  return {
    async listOrganizations() {
      const result: Organization[] = [];
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const page = await databases.listDocuments(database, 'organizations', [
          Query.limit(100),
          Query.orderAsc('$id'),
          Query.select(['$id', 'name', 'slug', 'active']),
          ...(cursor ? [Query.cursorAfter(cursor)] : []),
        ]);
        result.push(...page.documents.map((doc) => mapOrganization(doc as unknown as Record<string, unknown>)));
        if (page.documents.length < 100) break;
        cursor = page.documents.at(-1)!.$id;
      }
      return result;
    },

    async getOrganization(id) {
      try {
        const doc = await databases.getDocument(database, 'organizations', id, [
          Query.select(['$id', 'name', 'slug', 'active']),
        ]);
        return mapOrganization(doc as unknown as Record<string, unknown>);
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return null;
        throw error;
      }
    },

    async createOrganization(org) {
      try {
        await databases.createDocument(
          database,
          'organizations',
          org.id,
          { name: org.name, slug: org.slug, active: org.active },
          [],
        );
      } catch (error) {
        if (!(error instanceof AppwriteException && error.code === 409)) {
          const existing = await this.getOrganization(org.id);
          if (!existing) throw error;
        }
      }
    },

    async updateOrganization(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.active !== undefined) body.active = patch.active;
      if (Object.keys(body).length === 0) return;
      await databases.updateDocument(database, 'organizations', id, body);
    },

    async listAllDevices() {
      const result: RawDeviceDocument[] = [];
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
        const page = await databases.listDocuments(database, 'devices', [
          Query.limit(100),
          Query.orderAsc('$id'),
          Query.select(deviceFields),
          ...(cursor ? [Query.cursorAfter(cursor)] : []),
        ]);
        result.push(...page.documents.map((doc) => mapDevice(doc as unknown as Record<string, unknown>)));
        if (page.documents.length < 100) break;
        cursor = page.documents.at(-1)!.$id;
      }
      return result;
    },

    async getDevice(deviceId) {
      try {
        const doc = await databases.getDocument(database, 'devices', deviceId, [Query.select(deviceFields)]);
        return mapDevice(doc as unknown as Record<string, unknown>);
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return null;
        throw error;
      }
    },

    async updateDevice(deviceId, patch) {
      const body: Record<string, unknown> = {};
      if (patch.organizationId !== undefined) body.organization_id = patch.organizationId;
      if (patch.displayName !== undefined) body.display_name = patch.displayName;
      if (patch.hostname !== undefined) body.hostname = patch.hostname;
      if (patch.rustdeskId !== undefined) body.rustdesk_id = patch.rustdeskId;
      if (patch.enabled !== undefined) body.enabled = patch.enabled;
      if (patch.notes !== undefined) body.notes = patch.notes;
      if (Object.keys(body).length === 0) return;
      await databases.updateDocument(database, 'devices', deviceId, body);
    },

    async getReservation(reservationId) {
      try {
        const doc = await databases.getDocument(database, 'audit_logs', reservationId, [
          Query.select(['$id', 'action', 'metadata_json']),
        ]);
        if (doc.action !== 'naming.reservation' || typeof doc.metadata_json !== 'string') return null;
        const parsed = NamingReservationRecordSchema.safeParse(JSON.parse(doc.metadata_json));
        return parsed.success ? parsed.data : null;
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return null;
        throw error;
      }
    },

    async listReservations(groupId) {
      const page = await databases.listDocuments(database, 'audit_logs', [
        Query.equal('organization_id', groupId),
        Query.equal('action', 'naming.reservation'),
        Query.orderDesc('$createdAt'),
        Query.limit(200),
        Query.select(['$id', 'action', 'metadata_json']),
      ]);
      const out: NamingReservationRecord[] = [];
      for (const doc of page.documents) {
        if (typeof doc.metadata_json === 'string') {
          try {
            const parsed = NamingReservationRecordSchema.safeParse(JSON.parse(doc.metadata_json));
            if (parsed.success) out.push(parsed.data);
          } catch {
            // Skip malformed metadata
          }
        }
      }
      return out;
    },

    async upsertReservation(record, sourceIp) {
      const payload = {
        organization_id: record.groupId,
        actor_type: 'system',
        actor_id: (record.deviceId ?? record.groupId).slice(0, 36),
        device_id: record.deviceId ? record.deviceId.slice(0, 36) : null,
        action: 'naming.reservation',
        result: 'success',
        source_ip: (sourceIp || '127.0.0.1').slice(0, 45),
        metadata_json: JSON.stringify(record),
      };
      try {
        await databases.createDocument(database, 'audit_logs', record.id, payload, []);
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 409) {
          await databases.updateDocument(database, 'audit_logs', record.id, payload);
          return;
        }
        throw error;
      }
    },

    async appendHistory(event, sourceIp) {
      const payload = {
        organization_id: event.groupId,
        actor_type: event.operatorId ? 'technician' : 'system',
        actor_id: (event.operatorId ?? event.deviceId ?? event.groupId).slice(0, 36),
        device_id: event.deviceId ? event.deviceId.slice(0, 36) : null,
        action: 'naming.history',
        result: event.result,
        source_ip: (sourceIp || '127.0.0.1').slice(0, 45),
        metadata_json: JSON.stringify(event),
      };
      try {
        await databases.createDocument(database, 'audit_logs', event.id, payload, []);
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 409) return;
        throw error;
      }
    },

    async listHistory(groupId) {
      const page = await databases.listDocuments(database, 'audit_logs', [
        Query.equal('organization_id', groupId),
        Query.equal('action', 'naming.history'),
        Query.orderDesc('$createdAt'),
        Query.limit(100),
        Query.select(['$id', 'action', 'metadata_json']),
      ]);
      const out: NamingHistoryEvent[] = [];
      for (const doc of page.documents) {
        if (typeof doc.metadata_json === 'string') {
          try {
            const parsed = NamingHistoryEventSchema.safeParse(JSON.parse(doc.metadata_json));
            if (parsed.success) out.push(parsed.data);
          } catch {
            // Skip malformed metadata
          }
        }
      }
      return out;
    },
  };
}
