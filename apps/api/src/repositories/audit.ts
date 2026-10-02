import { AppwriteException, Query, type Databases } from 'node-appwrite';
import { ConnectionHistoryEventSchema, type ConnectionHistoryEvent } from '@appremoto/contracts';
import { redactLogData } from '../security/redaction.ts';

export interface EnrollmentAudit {
  organizationId: string;
  deviceId: string;
  sourceIp: string;
  result: 'success' | 'failure';
  retry: boolean;
  recoveryRequired: boolean;
  reason?: 'token_inactive' | 'token_expired' | 'token_invalid' | 'organization_inactive' | 'token_exhausted' |
    'identity_mismatch' | 'pending_recovery' | 'storage_failure' | 'already_enrolled';
  operation?: 'generic_password_confirm';
}
export interface AuditRepository {
  record(id: string, event: EnrollmentAudit): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface HeartbeatAuditRepository {
  recordHeartbeat(id: string, event: HeartbeatAudit): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface HeartbeatAudit {
  organizationId: string;
  deviceId: string;
  sourceIp: string;
  result: 'success' | 'failure';
  recoveryRequired: boolean;
}

export interface OperatorAudit {
  organizationId: string;
  actorId: string;
  actorType?: 'technician' | 'system';
  deviceId?: string;
  enrollmentId?: string;
  sourceIp: string;
  action: 'enrollment.create' | 'device.connect' | 'device.connect.event' | 'device.update.requested' | 'device.update' | 'installation.prepare';
  result?: 'success' | 'failure';
  connection?: Omit<ConnectionHistoryEvent, 'id' | 'at'>;
}
export interface ConnectionAuditRecord {
  organizationId: string; actorId: string; deviceId: string; action: 'device.connect' | 'device.connect.event';
  result: 'success' | 'failure'; event: ConnectionHistoryEvent;
}
export interface OperatorAuditRepository {
  recordOperator(id: string, event: OperatorAudit): Promise<void>;
  connectionAttempt?(id: string): Promise<ConnectionAuditRecord | null>;
  connectionHistory?(deviceId: string): Promise<ConnectionAuditRecord[]>;
}

function projectConnection(document: Record<string, unknown>): ConnectionAuditRecord | null {
  try {
    if (document.actor_type !== 'technician' || !['device.connect', 'device.connect.event'].includes(String(document.action)) ||
        typeof document.organization_id !== 'string' || typeof document.actor_id !== 'string' ||
        typeof document.device_id !== 'string' || !['success', 'failure'].includes(String(document.result)) ||
        typeof document.metadata_json !== 'string') return null;
    const metadata: unknown = JSON.parse(document.metadata_json);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const event = ConnectionHistoryEventSchema.parse({ ...metadata, id: document.$id, at: document.$createdAt });
    return { organizationId: document.organization_id, actorId: document.actor_id, deviceId: document.device_id,
      action: document.action as ConnectionAuditRecord['action'], result: document.result as ConnectionAuditRecord['result'], event };
  } catch { return null; }
}

export function createAuditRepository(databases: Databases): AuditRepository & HeartbeatAuditRepository & OperatorAuditRepository {
  return {
    async connectionAttempt(id) {
      try { return projectConnection(await databases.getDocument('remote_management', 'audit_logs', id)); }
      catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return null;
        throw new Error('Operator audit unavailable');
      }
    },
    async connectionHistory(deviceId) {
      try {
        const page = await databases.listDocuments('remote_management', 'audit_logs', [
          Query.equal('device_id', deviceId), Query.equal('action', ['device.connect', 'device.connect.event']),
          Query.orderDesc('$createdAt'), Query.limit(30), Query.select(['$id', '$createdAt', 'organization_id',
            'actor_type', 'actor_id', 'device_id', 'action', 'result', 'metadata_json']),
        ]);
        return page.documents.map(projectConnection).filter((value): value is ConnectionAuditRecord => value !== null);
      } catch { throw new Error('Operator audit unavailable'); }
    },
    async recordOperator(id, event) {
      // Reconstruct a fixed allowlist; caller objects and free-form error strings never become audit metadata.
      const connection = event.connection && ConnectionHistoryEventSchema.parse({ ...event.connection,
        id, at: new Date(0).toISOString() });
      const metadata = connection ? { attemptId: connection.attemptId, mode: connection.mode,
        stage: connection.stage, code: connection.code, source: connection.source } :
        event.enrollmentId ? { enrollmentId: event.enrollmentId } : {};
      const data = { organization_id: event.organizationId, actor_type: event.actorType ?? 'technician', actor_id: event.actorId,
        device_id: event.deviceId ?? null, action: event.action, result: event.result ?? 'success', source_ip: event.sourceIp,
        metadata_json: JSON.stringify(metadata) };
      try {
        try { await databases.createDocument('remote_management', 'audit_logs', id, data, []); }
        catch (error) {
          // Only bounded, deterministic follow-up events are idempotent. A launch ID cannot release a URI twice.
          if (!(error instanceof AppwriteException) || error.code !== 409 || !['device.connect.event', 'installation.prepare'].includes(event.action)) throw error;
        }
        const current = await databases.getDocument('remote_management', 'audit_logs', id);
        if (!Object.entries(data).every(([key, value]) => current[key] === value)) throw new Error();
      } catch { throw new Error('Operator audit unavailable'); }
    },
    async recordHeartbeat(id, event) {
      const data = { organization_id: event.organizationId, actor_type: 'device', actor_id: event.deviceId,
        device_id: event.deviceId, action: 'device.heartbeat', result: event.result,
        source_ip: event.sourceIp,
        metadata_json: JSON.stringify({ recoveryRequired: event.recoveryRequired }) };
      const unavailable = () => new Error('Heartbeat audit unavailable');
      async function matchingRecord(): Promise<boolean> {
        try {
          const current = await databases.getDocument('remote_management', 'audit_logs', id);
          return Object.entries(data).every(([key, value]) => current[key] === value);
        } catch (error) {
          if (error instanceof AppwriteException && error.code === 404) return false;
          throw unavailable();
        }
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await databases.createDocument('remote_management', 'audit_logs', id, data, []);
          return;
        } catch (error) {
          if (await matchingRecord()) return;
          if (error instanceof AppwriteException && error.code >= 400 && error.code < 500 &&
              ![408, 409, 429].includes(error.code)) throw unavailable();
        }
      }
      if (await matchingRecord()) return;
      throw unavailable();
    },
    async record(id, event) {
      try {
        await databases.createDocument('remote_management', 'audit_logs', id, {
          organization_id: event.organizationId, actor_type: event.operation ? 'device' : 'system', actor_id: event.operation ? event.deviceId : 'enrollment',
          device_id: event.deviceId, action: event.operation ? 'device.password.rotate' : 'device.enroll', result: event.result, source_ip: event.sourceIp,
          metadata_json: JSON.stringify(redactLogData({ retry: event.retry, recoveryRequired: event.recoveryRequired,
            ...(event.reason ? { reason: event.reason } : {}) })),
        }, []);
      } catch { throw new Error('Enrollment audit unavailable'); }
    },
    async remove(id) {
      try { await databases.deleteDocument('remote_management', 'audit_logs', id); }
      catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return;
        throw new Error('Enrollment audit unavailable');
      }
    },
  };
}
