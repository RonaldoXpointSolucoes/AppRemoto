import { randomBytes, randomInt } from 'node:crypto';
import { ID, Query, type Databases, type Models, type Users } from 'node-appwrite';

const DATABASE_ID = 'remote_management';
const PROFILES_COLLECTION = 'technician_profiles';
const MEMBERS_COLLECTION = 'organization_members';
const ORGANIZATIONS_COLLECTION = 'organizations';

export type ManagedRole = 'super_admin' | 'technician';

export interface ManagedTechnicianView {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  globalRole: ManagedRole;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
  invitedBy?: string;
}

export interface ManagedTechnicianInvite {
  id: string;
  token: string;
  email: string;
  name: string;
  role: ManagedRole;
  inviteUrl: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'expired';
}

export interface AuthorizedSessionResult {
  userId: string;
  secret: string;
  email: string;
  displayName: string;
  globalRole: ManagedRole;
}

export interface RecentAccessView {
  id: string;
  deviceId: string;
  displayName: string;
  hostname: string;
  rustdeskId: string;
  technicianName: string;
  connectedAt: string;
}

export interface TechnicianManagementService {
  listTechnicians(): Promise<{ technicians: ManagedTechnicianView[]; invites: ManagedTechnicianInvite[] }>;
  listRecentAccesses?(): Promise<{ accesses: RecentAccessView[] }>;
  upsertTechnicianWithInvite(input: {
    displayName: string;
    email: string;
    role: ManagedRole;
    invitedBy?: string;
  }): Promise<{ technician: ManagedTechnicianView; invite: ManagedTechnicianInvite }>;
  toggleTechnicianActive(userId: string): Promise<{ technicians: ManagedTechnicianView[]; invites: ManagedTechnicianInvite[] }>;
  deleteTechnician(userId: string): Promise<{ technicians: ManagedTechnicianView[]; invites: ManagedTechnicianInvite[] }>;
  createAuthorizedGoogleOrInviteSession(input: {
    email: string;
    inviteToken?: string;
  }): Promise<AuthorizedSessionResult>;
  activateInviteWithPassword(input: {
    email: string;
    password: string;
    displayName?: string;
    inviteToken?: string;
    requireUnconfiguredOrToken?: boolean;
  }): Promise<AuthorizedSessionResult>;
}

export class TechnicianAuthActionError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

type ProfileDoc = Models.Document & {
  user_id: string;
  display_name: string;
  global_role?: string | null;
  active: boolean;
};

type OrgDoc = Models.Document & {
  name: string;
  slug: string;
  active: boolean;
};

type MemberDoc = Models.Document & {
  organization_id: string;
  user_id: string;
  role: string;
  can_view: boolean;
  can_connect: boolean;
  can_manage_devices: boolean;
};

interface UserPrefs {
  inviteToken?: string;
  inviteStatus?: 'pending' | 'accepted' | 'expired';
  inviteCreatedAt?: string;
  inviteExpiresAt?: string;
  invitedBy?: string;
  passwordConfigured?: boolean;
  lastLoginAt?: string;
  deletedFromPanel?: boolean;
}

const CANONICAL_DEFAULT_TECHNICIANS: ReadonlyArray<{
  email: string;
  displayName: string;
  role: ManagedRole;
  preferredUserId?: string;
}> = [
  {
    email: 'ronaldo.xpointsolucoes@gmail.com',
    displayName: 'Ronaldo',
    role: 'super_admin',
    preferredUserId: '6ac0542e002986e82f85',
  },
  {
    email: 'david_ladivas@hotmail.com',
    displayName: 'David Clemente',
    role: 'super_admin',
  },
];

function generateInitialPassword(): string {
  const classes = [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz',
    '0123456789',
    '!@#$%^&*()-_=+',
  ];
  const all = classes.join('');
  const chars = classes.map((alphabet) => alphabet[randomInt(alphabet.length)]!);
  while (chars.length < 28) chars.push(all[randomInt(all.length)]!);
  return chars.join('');
}

function generateInviteToken(): string {
  return randomBytes(16).toString('hex');
}

function buildInviteUrl(panelOrigin: string, token: string, email: string): string {
  const base = panelOrigin.replace(/\/+$/, '');
  return `${base}/login?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

export function createTechnicianManagementService(options: {
  databases: Databases;
  users: Users;
  panelOrigin?: string;
}): TechnicianManagementService {
  const { databases, users } = options;
  const panelOrigin = options.panelOrigin || 'https://remoto.xpointsolucoes.com.br';
  let canonicalSeeded = false;

  async function findUserByEmail(email: string): Promise<Models.User<Models.Preferences> | null> {
    const normalized = email.trim().toLowerCase();
    const page = await users.list([Query.equal('email', [normalized]), Query.limit(5)]);
    const match = page.users.find((u) => (u.email || '').toLowerCase() === normalized);
    return match ?? null;
  }

  async function findProfileByUserId(userId: string): Promise<ProfileDoc | null> {
    const page = await databases.listDocuments<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, [
      Query.equal('user_id', [userId]),
      Query.limit(2),
    ]);
    return page.documents[0] ?? null;
  }

  async function ensureTechnicianMemberships(userId: string): Promise<void> {
    try {
      const orgsPage = await databases.listDocuments<OrgDoc>(DATABASE_ID, ORGANIZATIONS_COLLECTION, [
        Query.equal('active', [true]),
        Query.limit(100),
      ]);
      const membersPage = await databases.listDocuments<MemberDoc>(DATABASE_ID, MEMBERS_COLLECTION, [
        Query.equal('user_id', [userId]),
        Query.limit(100),
      ]);
      const existingOrgIds = new Set(membersPage.documents.map((m) => m.organization_id));

      for (const org of orgsPage.documents) {
        if (!existingOrgIds.has(org.$id)) {
          await databases.createDocument(
            DATABASE_ID,
            MEMBERS_COLLECTION,
            ID.unique(),
            {
              organization_id: org.$id,
              user_id: userId,
              role: 'technician',
              can_view: true,
              can_connect: true,
              can_manage_devices: true,
            },
            []
          );
        }
      }
    } catch {
      // Non-fatal if organization sync encounters a race
    }
  }

  async function ensureCanonicalTechnicians(): Promise<void> {
    if (canonicalSeeded) return;
    try {
      for (const item of CANONICAL_DEFAULT_TECHNICIANS) {
        const normalizedEmail = item.email.toLowerCase();
        let user = await findUserByEmail(normalizedEmail);
        if (!user) {
          user = await users.create(
            item.preferredUserId || ID.unique(),
            normalizedEmail,
            undefined,
            generateInitialPassword(),
            item.displayName
          );
        }
        const prefs = (user.prefs ?? {}) as UserPrefs;
        if (prefs.deletedFromPanel) continue;

        const existingProfile = await findProfileByUserId(user.$id);
        if (!existingProfile) {
          await databases.createDocument<ProfileDoc>(
            DATABASE_ID,
            PROFILES_COLLECTION,
            ID.unique(),
            {
              user_id: user.$id,
              display_name: item.displayName,
              global_role: item.role === 'super_admin' ? 'super_admin' : null,
              active: true,
            },
            []
          );
        }
        if (item.role === 'technician') {
          await ensureTechnicianMemberships(user.$id);
        }
      }
      canonicalSeeded = true;
    } catch {
      // Allow subsequent calls to retry if transient network issue occurred
    }
  }

  async function ensureUserInvitePrefs(
    user: Models.User<Models.Preferences>,
    displayName: string,
    role: ManagedRole,
    forceNewToken = false,
    invitedBy?: string
  ): Promise<{ prefs: UserPrefs; invite: ManagedTechnicianInvite }> {
    const rawPrefs = (user.prefs ?? {}) as UserPrefs;
    const now = new Date();
    const token =
      !forceNewToken && rawPrefs.inviteToken ? rawPrefs.inviteToken : generateInviteToken();
    const createdAt =
      !forceNewToken && rawPrefs.inviteCreatedAt ? rawPrefs.inviteCreatedAt : now.toISOString();
    const expiresAt =
      !forceNewToken && rawPrefs.inviteExpiresAt
        ? rawPrefs.inviteExpiresAt
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const status: 'pending' | 'accepted' | 'expired' = forceNewToken
      ? 'pending'
      : rawPrefs.inviteStatus || (rawPrefs.passwordConfigured ? 'accepted' : 'pending');

    const nextPrefs: UserPrefs = {
      ...rawPrefs,
      inviteToken: token,
      inviteCreatedAt: createdAt,
      inviteExpiresAt: expiresAt,
      inviteStatus: status,
      invitedBy: invitedBy || rawPrefs.invitedBy || 'Ronaldo (Super Admin)',
      deletedFromPanel: false,
    };

    if (
      forceNewToken ||
      !rawPrefs.inviteToken ||
      rawPrefs.deletedFromPanel
    ) {
      try {
        await users.updatePrefs(user.$id, nextPrefs);
      } catch {
        // Ignore prefs update race
      }
    }

    const email = (user.email || '').toLowerCase();
    return {
      prefs: nextPrefs,
      invite: {
        id: `inv_${user.$id}`,
        token,
        email,
        name: displayName,
        role,
        inviteUrl: buildInviteUrl(panelOrigin, token, email),
        createdAt,
        expiresAt,
        status,
      },
    };
  }

  return {
    async listTechnicians() {
      await ensureCanonicalTechnicians();

      const [profilesPage, usersPage] = await Promise.all([
        databases.listDocuments<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, [
          Query.limit(100),
          Query.orderDesc('$createdAt'),
        ]),
        users.list([Query.limit(100)]),
      ]);

      const usersById = new Map<string, Models.User<Models.Preferences>>();
      for (const u of usersPage.users) {
        usersById.set(u.$id, u);
      }

      const technicians: ManagedTechnicianView[] = [];
      const invites: ManagedTechnicianInvite[] = [];

      for (const profile of profilesPage.documents) {
        let user = usersById.get(profile.user_id);
        if (!user) {
          try {
            user = await users.get(profile.user_id);
          } catch {
            continue;
          }
        }
        const email = (user.email || '').toLowerCase();
        if (!email) continue;

        const existingPrefs = (user.prefs ?? {}) as UserPrefs;
        if (existingPrefs.deletedFromPanel) {
          try {
            await databases.deleteDocument(DATABASE_ID, PROFILES_COLLECTION, profile.$id);
          } catch {
            // Ignore cleanup race
          }
          continue;
        }

        const role: ManagedRole =
          profile.global_role === 'super_admin' ? 'super_admin' : 'technician';
        const { prefs, invite } = await ensureUserInvitePrefs(
          user,
          profile.display_name,
          role,
          false
        );

        technicians.push({
          id: profile.$id,
          userId: profile.user_id,
          displayName: profile.display_name,
          email,
          globalRole: role,
          active: Boolean(profile.active),
          createdAt: profile.$createdAt || user.$createdAt || new Date().toISOString(),
          ...(prefs.lastLoginAt || user.accessedAt
            ? { lastLoginAt: prefs.lastLoginAt || user.accessedAt }
            : {}),
          ...(prefs.invitedBy ? { invitedBy: prefs.invitedBy } : {}),
        });
        invites.push(invite);
      }

      return { technicians, invites };
    },

    async upsertTechnicianWithInvite(input) {
      await ensureCanonicalTechnicians();

      const normalizedEmail = input.email.trim().toLowerCase();
      const displayName = input.displayName.trim();
      const role: ManagedRole = input.role === 'super_admin' ? 'super_admin' : 'technician';

      if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || !displayName) {
        throw new TechnicianAuthActionError(400, 'INVALID_TECHNICIAN_INPUT', 'Informe nome e e-mail válidos.');
      }

      let user = await findUserByEmail(normalizedEmail);
      if (!user) {
        user = await users.create(
          ID.unique(),
          normalizedEmail,
          undefined,
          generateInitialPassword(),
          displayName
        );
      } else if (user.name !== displayName) {
        try {
          user = await users.updateName(user.$id, displayName);
        } catch {
          // Ignore name update race
        }
      }

      if (!user.status) {
        try {
          user = await users.updateStatus(user.$id, true);
        } catch {
          // Ignore status update race
        }
      }

      let profile = await findProfileByUserId(user.$id);
      if (!profile) {
        profile = await databases.createDocument<ProfileDoc>(
          DATABASE_ID,
          PROFILES_COLLECTION,
          ID.unique(),
          {
            user_id: user.$id,
            display_name: displayName,
            global_role: role === 'super_admin' ? 'super_admin' : null,
            active: true,
          },
          []
        );
      } else {
        profile = await databases.updateDocument<ProfileDoc>(
          DATABASE_ID,
          PROFILES_COLLECTION,
          profile.$id,
          {
            display_name: displayName,
            global_role: role === 'super_admin' ? 'super_admin' : null,
            active: true,
          }
        );
      }

      if (role === 'technician') {
        await ensureTechnicianMemberships(user.$id);
      }

      const { prefs, invite } = await ensureUserInvitePrefs(
        user,
        displayName,
        role,
        true,
        input.invitedBy
      );

      const technician: ManagedTechnicianView = {
        id: profile.$id,
        userId: profile.user_id,
        displayName: profile.display_name,
        email: normalizedEmail,
        globalRole: role,
        active: Boolean(profile.active),
        createdAt: profile.$createdAt || user.$createdAt || new Date().toISOString(),
        ...(prefs.lastLoginAt ? { lastLoginAt: prefs.lastLoginAt } : {}),
        ...(prefs.invitedBy ? { invitedBy: prefs.invitedBy } : {}),
      };

      return { technician, invite };
    },

    async toggleTechnicianActive(userId) {
      await ensureCanonicalTechnicians();
      let profile = await findProfileByUserId(userId);
      if (!profile) {
        try {
          profile = await databases.getDocument<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, userId);
        } catch {
          throw new TechnicianAuthActionError(404, 'TECHNICIAN_NOT_FOUND', 'Técnico não encontrado.');
        }
      }

      await databases.updateDocument<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, profile.$id, {
        active: !profile.active,
      });

      return this.listTechnicians();
    },

    async deleteTechnician(userId) {
      await ensureCanonicalTechnicians();
      let profile = await findProfileByUserId(userId);
      if (!profile) {
        try {
          profile = await databases.getDocument<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, userId);
        } catch {
          return this.listTechnicians();
        }
      }

      const targetUserId = profile.user_id;
      if (targetUserId === '6ac0542e002986e82f85') {
        throw new TechnicianAuthActionError(400, 'PROTECTED_TECHNICIAN', 'A conta principal do proprietário não pode ser removida.');
      }

      // Delete all profile documents for this user_id
      try {
        const allProfiles = await databases.listDocuments<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, [
          Query.equal('user_id', [targetUserId]),
          Query.limit(20),
        ]);
        for (const doc of allProfiles.documents) {
          await databases.deleteDocument(DATABASE_ID, PROFILES_COLLECTION, doc.$id);
        }
      } catch {
        try {
          await databases.deleteDocument(DATABASE_ID, PROFILES_COLLECTION, profile.$id);
        } catch {
          // Ignore if already deleted
        }
      }

      // Delete organization memberships for this user_id
      try {
        const memberships = await databases.listDocuments<MemberDoc>(DATABASE_ID, MEMBERS_COLLECTION, [
          Query.equal('user_id', [targetUserId]),
          Query.limit(100),
        ]);
        for (const m of memberships.documents) {
          await databases.deleteDocument(DATABASE_ID, MEMBERS_COLLECTION, m.$id);
        }
      } catch {
        // Ignore membership cleanup error
      }

      try {
        const user = await users.get(targetUserId);
        const rawPrefs = (user.prefs ?? {}) as UserPrefs;
        await users.updatePrefs(targetUserId, {
          ...rawPrefs,
          deletedFromPanel: true,
        });
      } catch {
        // Ignore if user does not exist
      }

      return this.listTechnicians();
    },

    async createAuthorizedGoogleOrInviteSession(input) {
      await ensureCanonicalTechnicians();
      const normalizedEmail = input.email.trim().toLowerCase();
      if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        throw new TechnicianAuthActionError(400, 'INVALID_EMAIL', 'Informe um e-mail válido.');
      }

      const user = await findUserByEmail(normalizedEmail);
      if (!user) {
        throw new TechnicianAuthActionError(
          403,
          'TECHNICIAN_NOT_AUTHORIZED',
          'Este e-mail não consta na lista de técnicos liberados. Solicite liberação ao administrador.'
        );
      }

      const profile = await findProfileByUserId(user.$id);
      if (!profile || !profile.active) {
        throw new TechnicianAuthActionError(
          403,
          'TECHNICIAN_DISABLED',
          'Seu acesso não está liberado ou encontra-se desativado na lista de Técnicos.'
        );
      }

      if (!user.status) {
        try {
          await users.updateStatus(user.$id, true);
        } catch {
          // Ignore
        }
      }

      const role: ManagedRole =
        profile.global_role === 'super_admin' ? 'super_admin' : 'technician';
      if (role === 'technician') {
        await ensureTechnicianMemberships(user.$id);
      }

      const token = await users.createToken(user.$id, 64, 900);
      try {
        const rawPrefs = (user.prefs ?? {}) as UserPrefs;
        await users.updatePrefs(user.$id, {
          ...rawPrefs,
          inviteStatus: 'accepted',
          lastLoginAt: new Date().toISOString(),
        });
      } catch {
        // Ignore prefs update error
      }

      return {
        userId: user.$id,
        secret: token.secret,
        email: normalizedEmail,
        displayName: profile.display_name,
        globalRole: role,
      };
    },

    async activateInviteWithPassword(input) {
      await ensureCanonicalTechnicians();
      const normalizedEmail = input.email.trim().toLowerCase();
      const password = input.password;

      if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        throw new TechnicianAuthActionError(400, 'INVALID_EMAIL', 'Informe um e-mail válido.');
      }
      if (!password || password.length < 8 || password.length > 256) {
        throw new TechnicianAuthActionError(
          400,
          'INVALID_PASSWORD',
          'A senha deve ter no mínimo 8 caracteres.'
        );
      }

      const user = await findUserByEmail(normalizedEmail);
      if (!user) {
        throw new TechnicianAuthActionError(
          403,
          'TECHNICIAN_NOT_AUTHORIZED',
          'Este e-mail não consta na lista de técnicos liberados.'
        );
      }

      const profile = await findProfileByUserId(user.$id);
      if (!profile || !profile.active) {
        throw new TechnicianAuthActionError(
          403,
          'TECHNICIAN_DISABLED',
          'Seu acesso não está liberado ou encontra-se desativado.'
        );
      }

      const rawPrefs = (user.prefs ?? {}) as UserPrefs;
      if (input.requireUnconfiguredOrToken && rawPrefs.passwordConfigured && !input.inviteToken) {
        throw new TechnicianAuthActionError(
          401,
          'INVALID_CREDENTIALS',
          'E-mail ou senha inválidos.'
        );
      }

      if (!user.status) {
        try {
          await users.updateStatus(user.$id, true);
        } catch {
          // Ignore
        }
      }

      await users.updatePassword(user.$id, password);

      let resolvedDisplayName = profile.display_name;
      if (input.displayName && input.displayName.trim()) {
        resolvedDisplayName = input.displayName.trim();
        try {
          await users.updateName(user.$id, resolvedDisplayName);
          await databases.updateDocument(DATABASE_ID, PROFILES_COLLECTION, profile.$id, {
            display_name: resolvedDisplayName,
          });
        } catch {
          // Ignore optional name update error
        }
      }

      const role: ManagedRole =
        profile.global_role === 'super_admin' ? 'super_admin' : 'technician';
      if (role === 'technician') {
        await ensureTechnicianMemberships(user.$id);
      }

      const token = await users.createToken(user.$id, 64, 900);
      try {
        await users.updatePrefs(user.$id, {
          ...rawPrefs,
          inviteStatus: 'accepted',
          passwordConfigured: true,
          lastLoginAt: new Date().toISOString(),
        });
      } catch {
        // Ignore
      }

      return {
        userId: user.$id,
        secret: token.secret,
        email: normalizedEmail,
        displayName: resolvedDisplayName,
        globalRole: role,
      };
    },

    async listRecentAccesses() {
      try {
        const auditRes = await databases.listDocuments(DATABASE_ID, 'audit_logs', [
          Query.equal('action', 'device.connect'),
          Query.equal('result', 'success'),
          Query.orderDesc('$createdAt'),
          Query.limit(50),
        ]);

        const dedupedDocs: Array<Models.Document & { actor_id?: string; device_id?: string }> = [];
        for (const rawDoc of auditRes.documents) {
          const doc = rawDoc as Models.Document & { actor_id?: string; device_id?: string };
          if (!doc.device_id) continue;
          const ts = Date.parse(doc.$createdAt);
          const isDuplicate = dedupedDocs.some((prev) => {
            if (prev.device_id !== doc.device_id || prev.actor_id !== doc.actor_id) return false;
            const prevTs = Date.parse(prev.$createdAt);
            return Math.abs(prevTs - ts) <= 15_000;
          });
          if (!isDuplicate) {
            dedupedDocs.push(doc);
          }
          if (dedupedDocs.length >= 15) break;
        }

        if (dedupedDocs.length === 0) {
          return { accesses: [] };
        }

        const deviceIds = Array.from(new Set(dedupedDocs.map((d) => d.device_id!).filter(Boolean)));
        const actorIds = Array.from(new Set(dedupedDocs.map((d) => d.actor_id || '').filter(Boolean)));

        const deviceMap = new Map<string, { displayName: string; hostname: string; rustdeskId: string }>();
        if (deviceIds.length > 0) {
          try {
            const devRes = await databases.listDocuments(DATABASE_ID, 'devices', [
              Query.equal('$id', deviceIds),
              Query.limit(100),
            ]);
            for (const d of devRes.documents) {
              const devDoc = d as Models.Document & {
                display_name?: string;
                hostname?: string;
                rustdesk_id?: string;
              };
              deviceMap.set(devDoc.$id, {
                displayName: devDoc.display_name || devDoc.hostname || 'Computador',
                hostname: devDoc.hostname || devDoc.$id,
                rustdeskId: devDoc.rustdesk_id || '',
              });
            }
          } catch {
            // Ignore partial device lookup error
          }
        }

        const techNameMap = new Map<string, string>();
        if (actorIds.length > 0) {
          try {
            const profRes = await databases.listDocuments<ProfileDoc>(DATABASE_ID, PROFILES_COLLECTION, [
              Query.equal('user_id', actorIds),
              Query.limit(100),
            ]);
            for (const p of profRes.documents) {
              if (p.user_id && p.display_name) {
                techNameMap.set(p.user_id, p.display_name);
              }
            }
          } catch {
            // Ignore profile lookup error
          }
        }

        const accesses: RecentAccessView[] = dedupedDocs.map((doc) => {
          const devInfo = deviceMap.get(doc.device_id!);
          const techName = (doc.actor_id && techNameMap.get(doc.actor_id)) || 'Técnico';
          return {
            id: doc.$id,
            deviceId: doc.device_id!,
            displayName: devInfo?.displayName || `Estação ${doc.device_id!.slice(0, 6)}`,
            hostname: devInfo?.hostname || doc.device_id!,
            rustdeskId: devInfo?.rustdeskId || '',
            technicianName: techName,
            connectedAt: doc.$createdAt,
          };
        });

        return { accesses };
      } catch {
        return { accesses: [] };
      }
    },
  };
}
