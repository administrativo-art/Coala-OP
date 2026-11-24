import type { Firestore } from 'firebase-admin/firestore';

export type ProviderOffice = {
  id: string; workspaceId: string; name: string; active: boolean; sessionVersion: number;
  createdAt: string; updatedAt: string; createdBy: string; updatedBy: string;
};
export type ProviderMember = {
  id: string; workspaceId: string; officeId: string; name: string; email: string;
  accountType: 'service_provider'; profile: 'accounting'; active: boolean;
  status: 'invited' | 'active'; createdAt: string; updatedAt: string;
  createdBy: string; updatedBy: string;
};
export type StoredProviderMember = ProviderMember & {
  sessionVersion: number; invitationHash: string | null;
  password: { salt: string; hash: string; version: 1 } | null;
};
export type ProviderGrant = {
  id: string; workspaceId: string; officeId: string; memberId: string;
  employerUnitId: string; competence: string; expiresAt: string;
  revokedAt: string | null; revokedBy: string | null;
  createdAt: string; createdBy: string;
};
export type PortalPrincipal = {
  memberId: string; workspaceId: string; officeId: string; name: string; email: string;
  accountType: 'service_provider'; profile: 'accounting';
};
export type PortalManager = { uid: string; workspaceId: string };
export type PortalDependencies = {
  db: Firestore; now: () => Date; randomId: () => string; randomToken: () => string;
  internalEmailExists: (email: string) => Promise<boolean>;
};
export type PortalInvitation = { token: string; expiresAt: string; memberId: string };
export type PortalManagementResult = {
  office?: ProviderOffice; member?: ProviderMember; grant?: ProviderGrant;
  invitation?: PortalInvitation;
};
