import type {
  CreateTechnicianInput,
  TechnicianInvite,
  TechnicianProfileView,
} from './technician-types';

const STORAGE_KEY_TECHS = 'xpoint_remote_technicians_v1';
const STORAGE_KEY_INVITES = 'xpoint_remote_invites_v1';

const INITIAL_TECHNICIANS: TechnicianProfileView[] = [
  {
    id: 'tech_ronaldo',
    userId: '6ac0542e002986e82f85',
    displayName: 'Ronaldo',
    email: 'ronaldo.xpointsolucoes@gmail.com',
    globalRole: 'super_admin',
    active: true,
    createdAt: '2026-10-02T22:00:00.000Z',
    lastLoginAt: new Date().toISOString(),
  },
  {
    id: 'tech_1',
    userId: 'remote-bootstrap-admin',
    displayName: 'Remote Administrator',
    email: 'remote.admin@xpointsolucoes.com.br',
    globalRole: 'super_admin',
    active: true,
    createdAt: '2026-09-29T10:00:00.000Z',
    lastLoginAt: '2026-10-02T21:00:00.000Z',
  },
  {
    id: 'tech_2',
    userId: '6ac0373631f7bd6b3620',
    displayName: 'Técnico XPoint',
    email: 'tecnico@xpointsolucoes.com.br',
    globalRole: 'technician',
    active: true,
    createdAt: '2026-09-30T14:30:00.000Z',
    lastLoginAt: '2026-10-02T18:00:00.000Z',
  },
  {
    id: 'tech_3',
    userId: '6ac0390b5f28d28b525a',
    displayName: 'Técnico 2 (Operação)',
    email: 'tecnico2@xpointsolucoes.com.br',
    globalRole: 'technician',
    active: true,
    createdAt: '2026-10-01T09:15:00.000Z',
  },
];

export function getTechnicians(): TechnicianProfileView[] {
  if (typeof window === 'undefined') return INITIAL_TECHNICIANS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TECHS);
    let list: TechnicianProfileView[] = INITIAL_TECHNICIANS;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        list = parsed;
      }
    }
    // Garante que os membros canônicos essenciais (especialmente o Ronaldo) estejam presentes
    for (const initTech of INITIAL_TECHNICIANS) {
      if (!list.some((t) => t.email.toLowerCase() === initTech.email.toLowerCase())) {
        list.unshift(initTech);
      }
    }
    localStorage.setItem(STORAGE_KEY_TECHS, JSON.stringify(list));
    return list;
  } catch {
    return INITIAL_TECHNICIANS;
  }
}

export function saveTechnicians(list: TechnicianProfileView[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_TECHS, JSON.stringify(list));
  } catch (err) {
    console.error('Failed to save technicians to localStorage', err);
  }
}

export function getInvites(): TechnicianInvite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INVITES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveInvites(list: TechnicianInvite[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_INVITES, JSON.stringify(list));
  } catch (err) {
    console.error('Failed to save invites to localStorage', err);
  }
}

export function createTechnicianWithInvite(
  input: CreateTechnicianInput,
  invitedByName = 'Admin'
): { technician: TechnicianProfileView; invite: TechnicianInvite } {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://remoto.xpointsolucoes.com.br';
  const token = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `inv_${Date.now()}`;
  const inviteUrl = `${origin}/login?invite=${token}&email=${encodeURIComponent(input.email.trim())}`;
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 dias

  const newTech: TechnicianProfileView = {
    id: `tech_${Date.now()}`,
    userId: `usr_${Date.now()}`,
    displayName: input.displayName.trim(),
    email: input.email.trim().toLowerCase(),
    globalRole: input.role,
    active: true,
    createdAt: now.toISOString(),
    organizationIds: input.organizationIds ?? [],
    invitedBy: invitedByName,
  };

  const newInvite: TechnicianInvite = {
    id: `inv_${Date.now()}`,
    token,
    email: input.email.trim().toLowerCase(),
    name: input.displayName.trim(),
    role: input.role,
    organizationIds: input.organizationIds ?? [],
    inviteUrl,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    status: 'pending',
  };

  const currentTechs = getTechnicians();
  const updatedTechs = [newTech, ...currentTechs.filter((t) => t.email !== newTech.email)];
  saveTechnicians(updatedTechs);

  const currentInvites = getInvites();
  const updatedInvites = [newInvite, ...currentInvites.filter((i) => i.email !== newInvite.email)];
  saveInvites(updatedInvites);

  return { technician: newTech, invite: newInvite };
}

export function toggleTechnicianActive(id: string): TechnicianProfileView[] {
  const current = getTechnicians();
  const updated = current.map((t) => (t.id === id ? { ...t, active: !t.active } : t));
  saveTechnicians(updated);
  return updated;
}

export function deleteTechnician(id: string): TechnicianProfileView[] {
  const current = getTechnicians();
  const updated = current.filter((t) => t.id !== id);
  saveTechnicians(updated);
  return updated;
}

export function buildWhatsAppInviteUrl(invite: TechnicianInvite, portalName = 'XPoint Remote'): string {
  const text = `Olá, ${invite.name}! Você foi convidado para a equipe técnica da ${portalName}.\n\nAcesse o link abaixo para ativar sua conta ou fazer login instantâneo com o Google:\n${invite.inviteUrl}\n\nO convite é válido por 7 dias.`;
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}
