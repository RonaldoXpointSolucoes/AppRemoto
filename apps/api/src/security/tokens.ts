import { createHash, createHmac, randomBytes } from 'node:crypto';

const maxTokenLength = 512;

export interface DeviceTokenIdentity {
  organizationId: string;
  enrollmentTokenId: string;
  deviceId: string;
  deviceUuid: string;
  receiptId: string;
}

export function deriveDeviceToken(masterKey: Buffer, identity: DeviceTokenIdentity): string {
  const parts = identity && [identity.organizationId, identity.enrollmentTokenId, identity.deviceId, identity.deviceUuid, identity.receiptId];
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32 || !parts ||
      parts.some((part) => typeof part !== 'string' || !part.length || part.length > 512 || Buffer.from(part, 'utf8').toString('utf8') !== part)) {
    throw new Error('Invalid token derivation');
  }
  return createHmac('sha256', masterKey).update('appremoto:enrollment-device-token:v1\0')
    .update(JSON.stringify(parts), 'utf8').digest('base64url');
}

export function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0 || token.length > maxTokenLength) {
    throw new Error('Invalid token');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
