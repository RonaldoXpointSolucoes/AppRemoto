import { z } from 'zod';
export * from './setup.ts';

export { DeviceListQuerySchema, DeviceViewSchema } from './devices.ts';
export type { DeviceListQuery, DeviceView } from './devices.ts';
export { EnrollRequestSchema, EnrollResponseSchema, HeartbeatRequestSchema, HeartbeatResponseSchema } from './agent.ts';
export type { EnrollRequest, EnrollResponse, HeartbeatRequest, HeartbeatResponse } from './agent.ts';

export const ApiErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  message: z.string().min(1).max(256),
  requestId: z.string().min(1).max(128).optional(),
}).strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;
