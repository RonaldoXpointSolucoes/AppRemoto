import { Account, AppwriteException, Client, Databases } from 'node-appwrite';
import { hkdfSync } from 'node:crypto';

import type { ApiConfig } from '../config.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';
import { createOrganizationRepository } from '../repositories/organizations.ts';
import { createTechnicianRepository } from '../repositories/technicians.ts';
import { createDeviceRepository } from '../repositories/devices.ts';
import { createEnrollmentRepository } from '../repositories/enrollment.ts';
import { createAuditRepository } from '../repositories/audit.ts';
import { createEnrollmentService } from '../services/enroll-device.ts';

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
    devices: createDeviceRepository(databases),
    enrollDevice: createEnrollmentService({ repository: createEnrollmentRepository(databases),
      audit: createAuditRepository(databases), encryptionKey: config.masterEncryptionKey, keyVersion: config.encryptionKeyVersion }),
    cursorSecret: Buffer.from(hkdfSync('sha256', config.masterEncryptionKey, Buffer.alloc(0),
      'appremoto-device-list-cursor-v1', 32)),
  };
}
