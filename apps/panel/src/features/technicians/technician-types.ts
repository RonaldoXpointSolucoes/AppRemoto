export type GlobalRole = 'super_admin' | 'technician';

export interface TechnicianProfileView {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  globalRole: GlobalRole;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
  organizationIds?: string[];
  invitedBy?: string;
}

export interface TechnicianInvite {
  id: string;
  token: string;
  email: string;
  name: string;
  role: GlobalRole;
  organizationIds: string[];
  inviteUrl: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'expired';
}

export interface CreateTechnicianInput {
  displayName: string;
  email: string;
  role: GlobalRole;
  organizationIds?: string[];
  sendWelcomeWhatsApp?: boolean;
}
