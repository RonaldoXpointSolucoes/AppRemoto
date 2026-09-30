import { Query, type Databases, type Models } from 'node-appwrite';

const databaseId = 'remote_management';

export interface TechnicianProfile {
  userId: string;
  displayName: string;
  globalRole?: string | null;
  active: boolean;
}

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  role: string;
  canView: boolean;
  canConnect: boolean;
  canManageDevices: boolean;
}

export interface TechnicianRepository {
  findByUserId(userId: string): Promise<TechnicianProfile | null>;
  listMemberships(userId: string): Promise<OrganizationMembership[]>;
}

type ProfileDocument = Models.Document & {
  user_id: string; display_name: string; global_role?: string | null; active: boolean;
};
type MembershipDocument = Models.Document & {
  organization_id: string; user_id: string; role: string;
  can_view: boolean; can_connect: boolean; can_manage_devices: boolean;
};

export function createTechnicianRepository(databases: Databases): TechnicianRepository {
  return {
    async findByUserId(userId) {
      const page = await databases.listDocuments<ProfileDocument>(databaseId, 'technician_profiles', [
        Query.equal('user_id', userId),
        Query.select(['user_id', 'display_name', 'global_role', 'active']),
        Query.limit(2),
      ]);
      if (page.total > 1 || page.documents.length > 1) throw new Error('Duplicate technician profile');
      const doc = page.documents[0];
      return doc ? { userId: doc.user_id, displayName: doc.display_name,
        globalRole: doc.global_role, active: doc.active } : null;
    },
    async listMemberships(userId) {
      const memberships: OrganizationMembership[] = [];
      while (true) {
        const page = await databases.listDocuments<MembershipDocument>(databaseId, 'organization_members', [
          Query.equal('user_id', userId),
          Query.select(['organization_id', 'user_id', 'role', 'can_view', 'can_connect', 'can_manage_devices']),
          Query.limit(100), Query.offset(memberships.length),
        ]);
        memberships.push(...page.documents.map((doc) => ({
          organizationId: doc.organization_id, userId: doc.user_id, role: doc.role,
          canView: doc.can_view, canConnect: doc.can_connect, canManageDevices: doc.can_manage_devices,
        })));
        if (memberships.length >= page.total) return memberships;
        if (!page.documents.length) throw new Error('Incomplete Appwrite membership page');
      }
    },
  };
}
