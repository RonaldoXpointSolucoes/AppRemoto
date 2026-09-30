import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Organization, OrganizationRepository } from '../repositories/organizations.ts';
import type { TechnicianRepository } from '../repositories/technicians.ts';

export interface SessionVerifier {
  verify(session: string): Promise<{ userId: string } | null>;
}

export interface TechnicianServices {
  projectId: string;
  sessionVerifier: SessionVerifier;
  technicians: TechnicianRepository;
  organizations: OrganizationRepository;
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

function sessionFromRequest(request: FastifyRequest, projectId: string): string | null {
  const headerValues: string[] = [];
  const cookieValues: string[] = [];
  const cookieName = `a_session_${projectId}`;

  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    const name = request.raw.rawHeaders[index]?.toLowerCase();
    const value = request.raw.rawHeaders[index + 1] ?? '';
    if (name === 'x-appwrite-session') headerValues.push(value);
    if (name === 'cookie') {
      for (const part of value.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
        try { cookieValues.push(decodeURIComponent(part.slice(separator + 1).trim())); }
        catch { return null; }
      }
    }
  }

  if (headerValues.length + cookieValues.length !== 1) return null;
  const session = (headerValues[0] ?? cookieValues[0]).trim();
  if (!session || session.length > 4096 || /[\s,;]/.test(session)) return null;
  return session;
}

export function registerTechnicianAuth(app: FastifyInstance, services: TechnicianServices) {
  app.decorateRequest('technician', null);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = sessionFromRequest(request, services.projectId);
    if (!session) return reply.code(401).send(unauthenticated);

    let identity: { userId: string } | null;
    try { identity = await services.sessionVerifier.verify(session); }
    catch { identity = null; }
    if (!identity?.userId) return reply.code(401).send(unauthenticated);

    try {
      const profile = await services.technicians.findByUserId(identity.userId);
      if (!profile?.active || profile.userId !== identity.userId) return reply.code(403).send(disabled);

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
      return reply.code(503).send(unavailable);
    }
  };
}
