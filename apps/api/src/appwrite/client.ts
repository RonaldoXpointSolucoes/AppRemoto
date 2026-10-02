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
import { createHeartbeatService } from '../services/record-heartbeat.ts';
import { createOperatorSetupService } from '../services/operator-setup.ts';
import { createSetupReceiptRepository } from '../repositories/operator-setup.ts';
import { createGenericInstallerRepository } from '../repositories/generic-installers.ts';
import { createGenericInstallerService } from '../services/generic-installers.ts';

export function createAppwriteServices(config: ApiConfig): TechnicianServices {
  const dataClient = new Client().setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId).setKey(config.appwriteApiKey);
  const databases = new Databases(dataClient);

  const enrollmentRepository = createEnrollmentRepository(databases);
  const auditRepository = createAuditRepository(databases);
  const genericInstallers = createGenericInstallerService({ repository: createGenericInstallerRepository(databases),
    enrollment: enrollmentRepository, audit: auditRepository, encryptionKey: config.masterEncryptionKey,
    sharedPassword: config.genericInstallerSharedPassword });
  return {
    genericInstallers,
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
    enrollDevice: createEnrollmentService({ repository: enrollmentRepository, reconfigurationGuard: enrollmentRepository,
      genericPassword: genericInstallers.enrollmentPassword,
      audit: auditRepository, encryptionKey: config.masterEncryptionKey, keyVersion: config.encryptionKeyVersion }),
    recordHeartbeat: createHeartbeatService({ repository: enrollmentRepository, audit: auditRepository }),
    operatorSetup: createOperatorSetupService({ repository: enrollmentRepository,
      guard: enrollmentRepository,
      receipts: createSetupReceiptRepository(databases), audit: auditRepository,
      encryptionKey: config.masterEncryptionKey, keyVersion: config.encryptionKeyVersion }),
    cursorSecret: Buffer.from(hkdfSync('sha256', config.masterEncryptionKey, Buffer.alloc(0),
      'appremoto-device-list-cursor-v1', 32)),
  };
}
