import { Query, type Databases, type Models } from 'node-appwrite';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export interface OrganizationRepository {
  listActive(): Promise<Organization[]>;
}

type OrganizationDocument = Models.Document & { name: string; slug: string; active: boolean };

export function createOrganizationRepository(databases: Databases): OrganizationRepository {
  return {
    async listActive() {
      const organizations: Organization[] = [];
      while (true) {
        const page = await databases.listDocuments<OrganizationDocument>('remote_management', 'organizations', [
          Query.equal('active', true), Query.select(['$id', 'name', 'slug', 'active']),
          Query.limit(100), Query.offset(organizations.length),
        ]);
        organizations.push(...page.documents.map((doc) => ({
          id: doc.$id, name: doc.name, slug: doc.slug, active: doc.active,
        })));
        if (organizations.length >= page.total) return organizations;
        if (!page.documents.length) throw new Error('Incomplete Appwrite organization page');
      }
    },
  };
}
