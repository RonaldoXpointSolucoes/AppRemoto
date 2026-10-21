import { z } from 'zod';

const version = z.string().min(1).max(64);
const optField = (max: number) => z.string().trim().max(max).optional();

export const DataDivasInfoSchema = z.object({
  nomeFantasia: optField(160),
  razaoSocial: optField(160),
  cnpj: optField(64),
  serial: optField(128),
  ie: optField(64),
  endereco: optField(255),
  cidade: optField(128),
  uf: optField(16),
  nomeMaq: optField(128),
  ipMaq: optField(128),
  ipDataDivas: optField(160),
  banco: optField(255),
  funcao: optField(32),
  windowsHostnameDesejado: optField(64),
  statusRenomeacao: optField(48),
  erroRenomeacao: optField(255),
  ultimaSincronizacao: optField(64),
  reservaId: optField(64),
  substituiuDeviceId: optField(64),
  cpuModelo: optField(96),
  cpuUsoPct: optField(16),
  ramTotalGb: optField(24),
  ramUsadaGb: optField(24),
  ramUsoPct: optField(16),
  discoTotalGb: optField(24),
  discoUsadoGb: optField(24),
  discoLivreGb: optField(24),
  discoUsoPct: optField(16),
  redeSubrede: optField(48),
  redeGateway: optField(48),
  redeTipo: optField(32),
}).strict();
export type DataDivasInfo = z.infer<typeof DataDivasInfoSchema>;

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
  datadivas: DataDivasInfoSchema.optional(),
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
  hostname: z.string().min(1).max(255).optional(),
  datadivas: DataDivasInfoSchema.optional(),
}).strict();

export const HeartbeatResponseSchema = z.object({
  deviceId: z.string().min(1).max(36),
  lastSeenAt: z.iso.datetime({ offset: true }),
}).strict();

export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>;
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
