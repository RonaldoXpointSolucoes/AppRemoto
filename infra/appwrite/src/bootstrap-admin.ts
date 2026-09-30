import { randomInt } from 'node:crypto';
import type { AdministratorGateway } from './gateway.ts';
import { requireTargetProject } from './safety.ts';

export const ADMIN_EMAIL = 'remote.admin@xpointsolucoes.com.br';
export type ProtectSecret = (password: string) => Promise<string>;
export type BootstrapReport = {
  identity: 'created' | 'reused'; userId: string;
  profile: 'created' | 'reused'; profileId: string; role: 'super_admin';
  encryptedArtifactPath?: string;
};

function generatePassword(): string {
  const classes = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%^&*()-_=+'];
  const all = classes.join('');
  const characters = classes.map((alphabet) => alphabet[randomInt(alphabet.length)]!);
  while (characters.length < 32) characters.push(all[randomInt(all.length)]!);
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j]!, characters[i]!];
  }
  return characters.join('');
}

export async function bootstrapAdministrator(gateway: AdministratorGateway, protect: ProtectSecret): Promise<BootstrapReport> {
  requireTargetProject(gateway.projectId);
  try {
    let user = await gateway.findUserByEmail(ADMIN_EMAIL);
    const identity = user ? 'reused' : 'created';
    let encryptedArtifactPath: string | undefined;
    if (!user) {
      let password = generatePassword();
      try {
        // Protect first so an interruption after user creation cannot lose its password.
        encryptedArtifactPath = await protect(password);
        user = await gateway.createUser('remote-bootstrap-admin', ADMIN_EMAIL, password);
      } finally {
        password = '';
      }
    }
    if (user.email !== ADMIN_EMAIL) throw new Error('Unexpected identity');
    let profile = await gateway.findProfileByUserId(user.id);
    const profileOutcome = profile ? 'reused' : 'created';
    if (!profile) {
      profile = await gateway.createProfile(user.id, {
        user_id: user.id, display_name: 'Remote Administrator', global_role: 'super_admin', active: true,
      });
    } else if (profile.global_role !== 'super_admin' || !profile.active) {
      profile = await gateway.updateProfile(profile.id, { global_role: 'super_admin', active: true });
    }
    return { identity, userId: user.id, profile: profileOutcome, profileId: profile.id, role: 'super_admin',
      ...(encryptedArtifactPath ? { encryptedArtifactPath } : {}) };
  } catch {
    throw new Error('Administrator bootstrap failed; inspect before retrying');
  }
}
