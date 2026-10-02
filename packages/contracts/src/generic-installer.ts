import { z } from 'zod';
import { ReconfigureRequestSchema } from './agent.ts';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/);
const label = z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/);
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const GenericInstallerViewSchema = z.object({ id, name: label, active: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }), revokedAt: z.iso.datetime({ offset: true }).nullable() }).strict();
export const GenericInstallerPackageSchema = z.object({ schemaVersion: z.literal(2), installerId: id, installerToken: secret }).strict();
export const GenericInstallerListResponseSchema = z.object({ installers: z.array(GenericInstallerViewSchema).max(100) }).strict();
export const CreateGenericInstallerRequestSchema = z.object({ name: label }).strict();
export const CreateGenericInstallerResponseSchema = z.object({ installer: GenericInstallerViewSchema, package: GenericInstallerPackageSchema }).strict();
export const GenericInstallerPackageResponseSchema = z.object({ package: GenericInstallerPackageSchema }).strict();
export const DownloadGenericInstallerResponseSchema = GenericInstallerPackageResponseSchema;
export const RevokeGenericInstallerResponseSchema = z.object({ revoked: z.literal(true) }).strict();
export const GenericInstallerParamsSchema = z.object({ installerId: id }).strict();
export const PrepareInstallationRequestSchema = z.object({ installerId: id, requestId: z.uuid(), requestSecret: secret,
  companyName: label, deviceDisplayName: label, existingOrganizationId: id.optional() }).strict();
export const PrepareInstallationResponseSchema = z.object({ schemaVersion: z.literal(1), enrollmentId: id,
  enrollmentToken: secret, expiresAt: z.iso.datetime({ offset: true }), organizationId: id,
  organizationName: label, deviceDisplayName: label }).strict();
export type GenericInstallerView = z.infer<typeof GenericInstallerViewSchema>;
export type GenericInstallerPackage = z.infer<typeof GenericInstallerPackageSchema>;
export type CreateGenericInstallerRequest = z.infer<typeof CreateGenericInstallerRequestSchema>;
export type CreateGenericInstallerResponse = z.infer<typeof CreateGenericInstallerResponseSchema>;
export type GenericInstallerListResponse = z.infer<typeof GenericInstallerListResponseSchema>;
export type GenericInstallerPackageResponse = z.infer<typeof GenericInstallerPackageResponseSchema>;
export type PrepareInstallationRequest = z.infer<typeof PrepareInstallationRequestSchema>;
export type PrepareInstallationResponse = z.infer<typeof PrepareInstallationResponseSchema>;
export const GenericPasswordRequestSchema = ReconfigureRequestSchema;
export const GenericPasswordResponseSchema = z.object({ deviceId: id, rustdeskPassword: z.string().min(16).max(128), rotationId: id }).strict();
export const ConfirmGenericPasswordResponseSchema = z.object({ deviceId: id, applied: z.literal(true) }).strict();
export type GenericPasswordRequest = z.infer<typeof GenericPasswordRequestSchema>;
export type GenericPasswordResponse = z.infer<typeof GenericPasswordResponseSchema>;
export type ConfirmGenericPasswordResponse = z.infer<typeof ConfirmGenericPasswordResponseSchema>;
