import { AppwriteException, Query, type Databases } from 'node-appwrite';
import type { EnrollmentData } from './enrollment.ts';
import { IndeterminateEnrollmentWrite, RejectedEnrollmentWrite } from './enrollment.ts';

export interface SetupReceiptRepository {
  committedReceipts(enrollmentId: string): Promise<EnrollmentData[]>;
  heartbeatPending(deviceId: string): Promise<boolean>;
  updateDeviceFields?(deviceId: string, fields: { displayName: string; notes: string }): Promise<void>;
  deleteDevice?(deviceId: string): Promise<void>;
}

export function createSetupReceiptRepository(databases: Databases): SetupReceiptRepository {
  return {
    async deleteDevice(deviceId) {
      await databases.deleteDocument('remote_management', 'devices', deviceId);
      try { await databases.deleteDocument('remote_management', 'device_credentials', deviceId); } catch {}
      try { await databases.deleteDocument('remote_management', 'device_tokens', deviceId); } catch {}
      try { await databases.deleteDocument('remote_management', 'heartbeat_guards', deviceId); } catch {}
      try {
        const receipts = await databases.listDocuments('remote_management', 'enrollment_receipts', [
          Query.equal('device_id', deviceId),
          Query.limit(100),
        ]);
        for (const doc of receipts.documents) {
          try { await databases.deleteDocument('remote_management', 'enrollment_receipts', doc.$id); } catch {}
        }
      } catch {}
    },
    async updateDeviceFields(deviceId, fields) {
      let acknowledged = false;
      try {
        // Editing descriptive fields must never replay a snapshot of agent, identity, status or credential fields.
        await databases.updateDocument('remote_management', 'devices', deviceId,
          { display_name: fields.displayName, notes: fields.notes });
        acknowledged = true;
      } catch (error) {
        if (error instanceof AppwriteException && error.code >= 400 && error.code < 500 && ![408, 429].includes(error.code)) {
          throw new RejectedEnrollmentWrite();
        }
      }
      try {
        const current = await databases.getDocument('remote_management', 'devices', deviceId,
          [Query.select(['display_name', 'notes'])]);
        if (current.display_name !== fields.displayName || current.notes !== fields.notes) throw new Error();
      } catch {
        // A lost response is resolved only by exact readback. Preserve the guard when a late PATCH remains possible.
        if (!acknowledged) throw new IndeterminateEnrollmentWrite();
        throw new Error('Device update unavailable');
      }
    },
    async committedReceipts(enrollmentId) {
      try {
        const page = await databases.listDocuments('remote_management', 'enrollment_receipts', [
          Query.equal('enrollment_token_id', enrollmentId), Query.equal('status', 'committed'), Query.limit(2),
          Query.select(['organization_id', 'enrollment_token_id', 'device_id', 'device_uuid', 'status',
            'token_use_consumed', 'expected_use_count', 'recovery_frozen', '$updatedAt']),
        ]);
        if (page.total > 1 || page.documents.length > 1) throw new Error();
        return page.documents.map((document) => ({ committed_at: document.$updatedAt, organization_id: document.organization_id,
          enrollment_token_id: document.enrollment_token_id, device_id: document.device_id,
          device_uuid: document.device_uuid, status: document.status, token_use_consumed: document.token_use_consumed,
          expected_use_count: document.expected_use_count, recovery_frozen: document.recovery_frozen }));
      } catch { throw new Error('Setup unavailable'); }
    },
    async heartbeatPending(deviceId) {
      try {
        await databases.getDocument('remote_management', 'heartbeat_guards', deviceId, [Query.select(['$id'])]);
        return true;
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return false;
        throw new Error('Setup unavailable');
      }
    },
  };
}
