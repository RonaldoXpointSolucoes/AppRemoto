import { z } from 'zod';
import { DeviceViewSchema } from './devices.ts';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/);
export const CreateEnrollmentTokenRequestSchema = z.object({
  organizationId: id,
  deviceDisplayName: z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/),
}).strict();
export const CreateEnrollmentTokenResponseSchema = z.object({
  enrollmentId: id,
  enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export const EnrollmentStatusParamsSchema = z.object({ enrollmentId: id }).strict();
export const EnrollmentStatusResponseSchema = z.object({
  status: z.enum(['waiting', 'online', 'offline']),
  expiresAt: z.iso.datetime({ offset: true }),
  device: DeviceViewSchema.nullable(),
}).strict().refine((value) => value.status === 'waiting' ? value.device === null :
  value.device !== null && value.device.status.toLowerCase() === value.status, 'Inconsistent enrollment status');
export const ConnectDeviceParamsSchema = z.object({ deviceId: id }).strict();
export const ConnectDeviceResponseSchema = z.object({
  launchUri: z.string().max(2048).regex(/^rustdesk:\/\/connect\/[0-9]{6,16}@179\.199\.142\.157:21116\?key=[A-Za-z0-9%]+&password=[A-Za-z0-9_.!~*'()%+-]+$/),
}).strict();
export type CreateEnrollmentTokenRequest = z.infer<typeof CreateEnrollmentTokenRequestSchema>;
export type CreateEnrollmentTokenResponse = z.infer<typeof CreateEnrollmentTokenResponseSchema>;
export type EnrollmentStatusResponse = z.infer<typeof EnrollmentStatusResponseSchema>;
export type ConnectDeviceResponse = z.infer<typeof ConnectDeviceResponseSchema>;
