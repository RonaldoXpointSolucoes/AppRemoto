import { DeviceListQuerySchema, type DataDivasInfo, type DeviceView } from '@appremoto/contracts';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import type { DeviceRepository } from '../repositories/devices.ts';
import { InvalidDeviceCursorError, listDevices } from '../services/device-list.ts';

const invalid = { error: { code: 'INVALID_DEVICE_QUERY', message: 'Invalid device query' } };
const unavailable = { error: { code: 'DEVICES_UNAVAILABLE', message: 'Devices unavailable' } };

const V161_TELEMETRY_KEYS: (keyof DataDivasInfo)[] = [
  'cpuModelo',
  'cpuUsoPct',
  'ramTotalGb',
  'ramUsadaGb',
  'ramUsoPct',
  'discoTotalGb',
  'discoUsadoGb',
  'discoLivreGb',
  'discoUsoPct',
  'redeSubrede',
  'redeGateway',
  'redeTipo',
];

function stripForLegacyStrictClient(device: DeviceView): DeviceView {
  const { publicIp: _publicIp, datadivas, ...rest } = device;
  if (!datadivas) return rest;
  const legacyDataDivas: DataDivasInfo = { ...datadivas };
  for (const key of V161_TELEMETRY_KEYS) {
    delete legacyDataDivas[key];
  }
  const hasAnyKey = Object.keys(legacyDataDivas).length > 0;
  return {
    ...rest,
    ...(hasAnyKey ? { datadivas: legacyDataDivas } : {}),
  };
}

export function registerDevicesRoute(app: FastifyInstance, authenticate: preHandlerHookHandler,
  repository: DeviceRepository, cursorSecret: Buffer, now: () => Date = () => new Date()): void {
  app.get('/v1/devices', { preHandler: authenticate }, async (request, reply) => {
    const parsed = DeviceListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalid);
    try {
      const page = await listDevices(request.technician!, parsed.data, repository, now(), cursorSecret);
      const acceptHeader = typeof request.headers.accept === 'string' ? request.headers.accept : '';
      const isLegacyStrictBundle = acceptHeader === 'application/json';
      if (isLegacyStrictBundle) {
        return {
          ...page,
          devices: page.devices.map(stripForLegacyStrictClient),
        };
      }
      return page;
    } catch (error) {
      if (error instanceof InvalidDeviceCursorError) return reply.code(400).send(invalid);
      return reply.code(503).send(unavailable);
    }
  });
}
