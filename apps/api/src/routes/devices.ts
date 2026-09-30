import { DeviceListQuerySchema } from '@appremoto/contracts';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import type { DeviceRepository } from '../repositories/devices.ts';
import { InvalidDeviceCursorError, listDevices } from '../services/device-list.ts';

const invalid = { error: { code: 'INVALID_DEVICE_QUERY', message: 'Invalid device query' } };
const unavailable = { error: { code: 'DEVICES_UNAVAILABLE', message: 'Devices unavailable' } };

export function registerDevicesRoute(app: FastifyInstance, authenticate: preHandlerHookHandler,
  repository: DeviceRepository, now: () => Date = () => new Date()): void {
  app.get('/v1/devices', { preHandler: authenticate }, async (request, reply) => {
    const parsed = DeviceListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalid);
    try {
      return await listDevices(request.technician!, parsed.data, repository, now());
    } catch (error) {
      if (error instanceof InvalidDeviceCursorError) return reply.code(400).send(invalid);
      return reply.code(503).send(unavailable);
    }
  });
}
