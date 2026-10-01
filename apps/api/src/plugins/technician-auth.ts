import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Organization, OrganizationRepository } from '../repositories/organizations.ts';
import type { TechnicianRepository } from '../repositories/technicians.ts';
import type { DeviceRepository } from '../repositories/devices.ts';
import type { EnrollDevice } from '../services/enroll-device.ts';
import type { RecordHeartbeat } from '../services/record-heartbeat.ts';
import type { OperatorSetupService } from '../services/operator-setup.ts';

export interface JwtVerifier {
  verify(jwt: string): Promise<{ userId: string } | null>;
}

export interface TechnicianServices {
  projectId: string;
  jwtVerifier: JwtVerifier;
  technicians: TechnicianRepository;
  organizations: OrganizationRepository;
  devices?: DeviceRepository;
  cursorSecret?: Buffer;
  now?: () => Date;
  enrollDevice?: EnrollDevice;
  recordHeartbeat?: RecordHeartbeat;
  operatorSetup?: OperatorSetupService;
}

export interface OrganizationAuthorization {
  organizationId: string;
  role: string;
  canView: boolean;
  canConnect: boolean;
  canManageDevices: boolean;
}

export interface AuthenticatedTechnician {
  userId: string;
  displayName: string;
  globalRole: string | null;
  authorization: OrganizationAuthorization[];
  organizations: Organization[];
}

declare module 'fastify' {
  interface FastifyRequest {
    technician: AuthenticatedTechnician | null;
  }
}

const unauthenticated = { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } };
const disabled = { error: { code: 'TECHNICIAN_DISABLED', message: 'Access denied' } };
const unavailable = { error: { code: 'AUTHORIZATION_UNAVAILABLE', message: 'Access unavailable' } };

type TechnicianAuthFailure = 'credential_missing_or_malformed' | 'jwt_rejected' |
  'jwt_verifier_unavailable' | 'profile_disabled_or_missing' | 'authorization_store_unavailable';

function auditFailure(request: FastifyRequest, reason: TechnicianAuthFailure): void {
  request.log.warn({ authAudit: {
    action: 'technician.authenticate', result: 'failure', reason, scope: 'unscoped',
  } }, 'Technician authentication failed');
}

function jwtFromRequest(request: FastifyRequest, projectId: string): string | null {
  const authorizationValues: string[] = [];
  const cookieName = `a_session_${projectId}`;
  let legacyCredential = false;

  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    const name = request.raw.rawHeaders[index]?.toLowerCase();
    const value = request.raw.rawHeaders[index + 1] ?? '';
    if (name === 'authorization') authorizationValues.push(value);
    if (name === 'x-appwrite-session') legacyCredential = true;
    if (name === 'cookie') {
      for (const part of value.split(';')) {
        const separator = part.indexOf('=');
        if (separator >= 0 && part.slice(0, separator).trim() === cookieName) legacyCredential = true;
      }
    }
  }

  if (legacyCredential || authorizationValues.length !== 1) return null;
  const authorization = authorizationValues[0];
  if (authorization.length > 8199) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export function registerTechnicianAuth(app: FastifyInstance, services: TechnicianServices) {
  app.decorateRequest('technician', null);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const jwt = jwtFromRequest(request, services.projectId);
    if (!jwt) {
      auditFailure(request, 'credential_missing_or_malformed');
      return reply.code(401).send(unauthenticated);
    }

    let identity: { userId: string } | null;
    try { identity = await services.jwtVerifier.verify(jwt); }
    catch {
      auditFailure(request, 'jwt_verifier_unavailable');
      return reply.code(503).send(unavailable);
    }
    if (!identity?.userId) {
      auditFailure(request, 'jwt_rejected');
      return reply.code(401).send(unauthenticated);
    }

    try {
      const profile = await services.technicians.findByUserId(identity.userId);
      if (!profile?.active || profile.userId !== identity.userId) {
        auditFailure(request, 'profile_disabled_or_missing');
        return reply.code(403).send(disabled);
      }

      const activeOrganizations = (await services.organizations.listActive()).filter((organization) => organization.active);
      const memberships = profile.globalRole === 'super_admin' ? [] : await services.technicians.listMemberships(identity.userId);
      const visibleMemberships = new Map(memberships
        .filter((membership) => membership.userId === identity.userId && membership.canView)
        .map((membership) => [membership.organizationId, membership]));
      const organizations = activeOrganizations.filter((organization) =>
        profile.globalRole === 'super_admin' || visibleMemberships.has(organization.id));
      const authorization = organizations.map((organization): OrganizationAuthorization => {
        if (profile.globalRole === 'super_admin') return {
          organizationId: organization.id, role: 'super_admin', canView: true, canConnect: true, canManageDevices: true,
        };
        const membership = visibleMemberships.get(organization.id)!;
        return { organizationId: organization.id, role: membership.role, canView: true,
          canConnect: membership.canConnect, canManageDevices: membership.canManageDevices };
      });

      request.technician = { userId: identity.userId, displayName: profile.displayName,
        globalRole: profile.globalRole ?? null, authorization, organizations };
    } catch {
      auditFailure(request, 'authorization_store_unavailable');
      return reply.code(503).send(unavailable);
    }
  };
}
