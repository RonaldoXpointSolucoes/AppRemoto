import { AppwriteException, type Databases } from 'node-appwrite';
import { redactLogData } from '../security/redaction.ts';

export interface EnrollmentAudit {
  organizationId: string;
  deviceId: string;
  sourceIp: string;
  result: 'success' | 'failure';
  retry: boolean;
  recoveryRequired: boolean;
  reason?: 'token_inactive' | 'token_expired' | 'token_invalid' | 'organization_inactive' | 'token_exhausted' |
    'identity_mismatch' | 'pending_recovery' | 'storage_failure';
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

export function createAuditRepository(databases: Databases): AuditRepository & HeartbeatAuditRepository {
  return {
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
          organization_id: event.organizationId, actor_type: 'system', actor_id: 'enrollment',
          device_id: event.deviceId, action: 'device.enroll', result: event.result, source_ip: event.sourceIp,
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
