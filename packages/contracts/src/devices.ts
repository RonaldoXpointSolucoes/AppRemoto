import { z } from 'zod';

const shortId = z.string().min(1).max(36);
const deviceStatus = z.enum(['ONLINE', 'OFFLINE']);

export const DeviceListQuerySchema = z.object({
  organizationId: shortId.optional(),
  status: deviceStatus.optional(),
  search: z.string().trim().min(1).max(128).optional(),
  cursor: shortId.optional(),
  limit: z.preprocess(
    (value) => typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value,
    z.number().int().min(1).max(100),
  ).default(50),
}).strict();

export const DeviceViewSchema = z.object({
  id: shortId,
  organizationId: shortId,
  organizationName: z.string().min(1).max(128),
  deviceUuid: z.uuid(),
  displayName: z.string().min(1).max(128),
  hostname: z.string().min(1).max(255),
  operatingSystem: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(128),
  rustdeskId: z.string().min(1).max(64),
  agentVersion: z.string().min(1).max(64).nullable(),
  rustdeskVersion: z.string().min(1).max(64).nullable(),
  lastSeenAt: z.iso.datetime({ offset: true }).nullable(),
  enabled: z.boolean(),
  status: deviceStatus,
}).strict();

export type DeviceListQuery = z.infer<typeof DeviceListQuerySchema>;
export type DeviceView = z.infer<typeof DeviceViewSchema>;
