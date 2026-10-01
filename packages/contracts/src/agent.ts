import { z } from 'zod';

const version = z.string().min(1).max(64);

export const EnrollRequestSchema = z.object({
  enrollmentToken: z.string().min(32).max(512),
  deviceUuid: z.uuid(),
  displayName: z.string().min(1).max(128),
  hostname: z.string().min(1).max(255),
  operatingSystem: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(128),
  agentVersion: version,
  rustdeskId: z.string().min(1).max(64),
  rustdeskVersion: version,
}).strict();

export const ReconfigureRequestSchema = EnrollRequestSchema.extend({
  currentDeviceToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const ReconfigureResponseSchema = z.object({
  deviceId: z.string().min(1).max(36),
  reconfigured: z.literal(true),
}).strict();
export type ReconfigureRequest = z.infer<typeof ReconfigureRequestSchema>;
export type ReconfigureResponse = z.infer<typeof ReconfigureResponseSchema>;

export const EnrollResponseSchema = z.object({
  deviceId: z.string().min(1).max(36),
  deviceToken: z.string().min(32).max(512),
  rustdeskPassword: z.string().min(8).max(128),
  heartbeatIntervalSeconds: z.number().int().min(10).max(300),
}).strict();

export const HeartbeatRequestSchema = z.object({
  agentVersion: version,
  rustdeskVersion: version,
  rustdeskId: z.string().min(1).max(64),
  operatingSystem: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(128),
}).strict();

export const HeartbeatResponseSchema = z.object({
  deviceId: z.string().min(1).max(36),
  lastSeenAt: z.iso.datetime({ offset: true }),
}).strict();

export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>;
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
