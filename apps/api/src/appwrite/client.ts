import { Account, Client, Databases } from 'node-appwrite';

import type { ApiConfig } from '../config.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';
import { createOrganizationRepository } from '../repositories/organizations.ts';
import { createTechnicianRepository } from '../repositories/technicians.ts';

export function createAppwriteServices(config: ApiConfig): TechnicianServices {
  const dataClient = new Client().setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId).setKey(config.appwriteApiKey);
  const databases = new Databases(dataClient);

  return {
    projectId: config.appwriteProjectId,
    sessionVerifier: {
      async verify(session) {
        const sessionClient = new Client().setEndpoint(config.appwriteEndpoint)
          .setProject(config.appwriteProjectId).setSession(session);
        const account = await new Account(sessionClient).get();
        return account.$id ? { userId: account.$id } : null;
      },
    },
    technicians: createTechnicianRepository(databases),
    organizations: createOrganizationRepository(databases),
  };
}
