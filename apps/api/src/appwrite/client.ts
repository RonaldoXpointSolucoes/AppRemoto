import { Account, AppwriteException, Client, Databases } from 'node-appwrite';

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
    jwtVerifier: {
      async verify(jwt) {
        const jwtClient = new Client().setEndpoint(config.appwriteEndpoint)
          .setProject(config.appwriteProjectId).setJWT(jwt);
        try {
          const account = await new Account(jwtClient).get();
          return account.$id && account.status ? { userId: account.$id } : null;
        } catch (error) {
          if (error instanceof AppwriteException && error.code === 401) return null;
          throw new Error('Authentication service unavailable');
        }
      },
    },
    technicians: createTechnicianRepository(databases),
    organizations: createOrganizationRepository(databases),
  };
}
