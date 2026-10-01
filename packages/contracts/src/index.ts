import { z } from 'zod';
export * from './setup.ts';
export * from './device-tools.ts';

export { DeviceListQuerySchema, DeviceViewSchema } from './devices.ts';
export type { DeviceListQuery, DeviceView } from './devices.ts';
export { ReconfigureRequestSchema, ReconfigureResponseSchema, EnrollRequestSchema, EnrollResponseSchema, HeartbeatRequestSchema, HeartbeatResponseSchema } from './agent.ts';
export type { ReconfigureRequest, ReconfigureResponse, EnrollRequest, EnrollResponse, HeartbeatRequest, HeartbeatResponse } from './agent.ts';

export const ApiErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  message: z.string().min(1).max(256),
  requestId: z.string().min(1).max(128).optional(),
}).strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;
