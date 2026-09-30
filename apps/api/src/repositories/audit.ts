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
      try {
        await databases.createDocument('remote_management', 'audit_logs', id, {
          organization_id: event.organizationId, actor_type: 'device', actor_id: event.deviceId,
          device_id: event.deviceId, action: 'device.heartbeat', result: event.result,
          source_ip: event.sourceIp,
          metadata_json: JSON.stringify({ recoveryRequired: event.recoveryRequired }),
        }, []);
      } catch { throw new Error('Heartbeat audit unavailable'); }
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
