import { AppwriteException, Query, type Databases } from 'node-appwrite';
import type { EnrollmentData } from './enrollment.ts';

export interface SetupReceiptRepository {
  committedReceipts(enrollmentId: string): Promise<EnrollmentData[]>;
  heartbeatPending(deviceId: string): Promise<boolean>;
}

export function createSetupReceiptRepository(databases: Databases): SetupReceiptRepository {
  return {
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
