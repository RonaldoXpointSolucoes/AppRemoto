import { z } from 'zod';
import { DeviceViewSchema } from './devices.ts';

export const ConnectionModeSchema = z.enum(['automatic', 'manual']);
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>;
export const ConnectDeviceRequestSchema = z.object({ mode: ConnectionModeSchema, attemptId: z.uuid() }).strict();
// Both forms use the approved RustDesk server. Only automatic handoff carries a password.
export const ConnectDeviceLaunchResponseSchema = z.object({
  launchUri: z.string().max(2048).regex(/^rustdesk:\/\/connect\/[0-9]{6,16}@179\.199\.142\.157:21116\?key=[A-Za-z0-9%]+(?:&password=[A-Za-z0-9_.!~*'()%+-]+)?$/),
  attemptId: z.uuid(), mode: ConnectionModeSchema,
}).strict().refine((value) => value.launchUri.includes('&password=') === (value.mode === 'automatic'), 'Invalid launch mode');
export type ConnectDeviceRequest = z.infer<typeof ConnectDeviceRequestSchema>;
export type ConnectDeviceLaunchResponse = z.infer<typeof ConnectDeviceLaunchResponseSchema>;
export const DeviceDetailsResponseSchema = z.object({
  device: DeviceViewSchema,
  notes: z.string().max(2048),
  diagnostics: z.object({ agentOnline: z.boolean(), heartbeatConfirmed: z.boolean(),
    rustdeskIdValid: z.boolean(), credentialAvailable: z.boolean() }).strict(),
}).strict();
export const UpdateDeviceRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/),
  notes: z.string().max(2048).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/),
}).strict();
export const UpdateDeviceResponseSchema = z.object({ device: DeviceViewSchema, notes: z.string().max(2048) }).strict();
export type DeviceDetailsResponse = z.infer<typeof DeviceDetailsResponseSchema>;
export type UpdateDeviceRequest = z.infer<typeof UpdateDeviceRequestSchema>;
export type UpdateDeviceResponse = z.infer<typeof UpdateDeviceResponseSchema>;

export const ConnectionStageSchema = z.enum(['authorized', 'rejected', 'launch_requested', 'launch_failed',
  'not_opened', 'session_confirmed', 'session_failed']);
export const ConnectionCodeSchema = z.enum(['LAUNCH_AUTHORIZED', 'ACCESS_DENIED', 'DEVICE_OFFLINE',
  'HEARTBEAT_UNCONFIRMED', 'INVALID_RUSTDESK_ID', 'CREDENTIAL_UNAVAILABLE', 'CONNECT_UNAVAILABLE',
  'BROWSER_LAUNCH_REQUESTED', 'BROWSER_LAUNCH_FAILED', 'APP_NOT_OPENED',
  'OPERATOR_SESSION_CONFIRMED', 'OPERATOR_SESSION_FAILED']);
export const ConnectionHistoryEventSchema = z.object({
  id: z.string().min(1).max(36), attemptId: z.uuid(), at: z.iso.datetime({ offset: true }),
  mode: ConnectionModeSchema, stage: ConnectionStageSchema, code: ConnectionCodeSchema,
  source: z.enum(['api', 'browser', 'operator']),
}).strict();
export type ConnectionHistoryEvent = z.infer<typeof ConnectionHistoryEventSchema>;
export const ConnectionHistoryResponseSchema = z.object({ events: z.array(ConnectionHistoryEventSchema).max(30) }).strict();
export type ConnectionHistoryResponse = z.infer<typeof ConnectionHistoryResponseSchema>;
export const ConnectionEventRequestSchema = z.object({
  attemptId: z.uuid(), mode: ConnectionModeSchema,
  event: z.enum(['launch_requested', 'launch_failed', 'not_opened', 'session_confirmed', 'session_failed']),
  code: z.enum(['BROWSER_LAUNCH_REQUESTED', 'BROWSER_LAUNCH_FAILED', 'APP_NOT_OPENED',
    'OPERATOR_SESSION_CONFIRMED', 'OPERATOR_SESSION_FAILED']).optional(),
}).strict();
export type ConnectionEventInput = z.infer<typeof ConnectionEventRequestSchema>;
export const RecordConnectionEventResponseSchema = z.object({ recorded: z.literal(true) }).strict();
