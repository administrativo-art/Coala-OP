import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { portalLoginSchema, portalPasswordSchema } from './schemas';
import type { PortalDependencies, PortalPrincipal, ProviderMember, ProviderOffice, StoredProviderMember } from './types';

export const PORTAL_SESSION_SECONDS = 8 * 60 * 60;
export const PORTAL_INVITATION_SECONDS = 48 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const GLOBAL_ADMISSION_WINDOW_MS = 60 * 1000;
const MAX_GLOBAL_ADMISSIONS = 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const portalDefaults: PortalDependencies = {
  db: dbAdmin, now: () => new Date(), randomId: randomUUID, randomToken: () => randomBytes(32).toString('base64url'),
  async internalEmailExists(email) {
    try { await authAdmin.getUserByEmail(email); return true; }
    catch (cause) {
      if ((cause as { code?: string }).code === 'auth/user-not-found') return false;
      throw cause;
    }
  },
};
export function portalHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function portalFailure(message = 'Acesso não autorizado.', status = 403) {
  return new AppError({ code: 'SERVICE_PORTAL_ACCESS_DENIED', kind: 'AUTHORIZATION', httpStatus: status, safeMessage: message, reportable: false });
}
export function publicPortalMember(member: StoredProviderMember): ProviderMember {
  return { id: member.id, workspaceId: member.workspaceId, officeId: member.officeId,
    name: member.name, email: member.email, accountType: member.accountType, profile: member.profile,
    active: member.active, status: member.status, createdAt: member.createdAt, updatedAt: member.updatedAt,
    createdBy: member.createdBy, updatedBy: member.updatedBy };
}
function principalOf(member: StoredProviderMember): PortalPrincipal {
  return { memberId: member.id, workspaceId: member.workspaceId, officeId: member.officeId,
    name: member.name, email: member.email, accountType: 'service_provider', profile: 'accounting' };
}
function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (cause, key) => cause ? reject(cause) : resolve(key)));
}
export async function hashPortalPassword(password: string) {
  portalPasswordSchema.parse(password);
  const salt = randomBytes(16).toString('hex');
  const hash = (await derivePassword(password, salt)).toString('hex');
  return { salt, hash, version: 1 as const };
}
export async function verifyPortalPassword(password: string, stored: StoredProviderMember['password']) {
  const valid = stored?.version === 1 && /^[a-f0-9]{32}$/.test(stored.salt) && /^[a-f0-9]{128}$/.test(stored.hash);
  const key = await derivePassword(password.slice(0, 128), valid ? stored.salt : '00000000000000000000000000000000');
  return Boolean(valid && timingSafeEqual(key, Buffer.from(stored.hash, 'hex')));
}
function validMember(member: StoredProviderMember | undefined, office: ProviderOffice | undefined) {
  return Boolean(member && office && member.active && member.status === 'active' && office.active
    && member.accountType === 'service_provider' && member.profile === 'accounting'
    && member.officeId === office.id && member.workspaceId === office.workspaceId
    && Number.isSafeInteger(member.sessionVersion) && member.sessionVersion >= 0
    && Number.isSafeInteger(office.sessionVersion) && office.sessionVersion >= 0);
}
async function reservePortalAdmission(deps: PortalDependencies) {
  const ref = deps.db.collection('providerPortalLoginAttempts').doc('_global_admission');
  await deps.db.runTransaction(async (tx) => {
    const at = deps.now();
    const windowStart = Math.floor(at.getTime() / GLOBAL_ADMISSION_WINDOW_MS) * GLOBAL_ADMISSION_WINDOW_MS;
    const previous = await tx.get(ref);
    const count = previous.get('windowStart') === windowStart ? Number(previous.get('count') ?? 0) : 0;
    if (count >= MAX_GLOBAL_ADMISSIONS) throw portalFailure('O portal recebeu muitas tentativas. Tente novamente em um minuto.', 429);
    tx.set(ref, { count: count + 1, windowStart,
      deleteAfter: Timestamp.fromMillis(at.getTime() + 24 * 60 * 60 * 1000) });
  });
}
export async function activatePortalInvitation(token: string, password: string, injected: Partial<PortalDependencies> = {}) {
  if (!TOKEN_PATTERN.test(token)) throw portalFailure('Convite inválido ou expirado.');
  const deps = { ...portalDefaults, ...injected };
  portalPasswordSchema.parse(password);
  const invitationHash = portalHash(token);
  const invitationRef = deps.db.collection('providerPortalInvitations').doc(invitationHash);
  const at = deps.now().toISOString();
  const initial = await invitationRef.get();
  if (!initial.exists || initial.get('consumedAt') || initial.get('expiresAt') <= at) throw portalFailure('Convite inválido ou expirado.');
  await reservePortalAdmission(deps);
  const credential = await hashPortalPassword(password);
  return deps.db.runTransaction(async (tx) => {
    const invitation = await tx.get(invitationRef);
    const memberId = invitation.get('memberId');
    if (!invitation.exists || typeof memberId !== 'string' || invitation.get('consumedAt')) {
      throw portalFailure('Convite inválido ou expirado.');
    }
    const memberRef = deps.db.collection('providerMembers').doc(memberId);
    const member = (await tx.get(memberRef)).data() as StoredProviderMember | undefined;
    if (!member || member.workspaceId !== invitation.get('workspaceId') || member.invitationHash !== invitationHash || !member.active
      || invitation.get('memberSessionVersion') !== member.sessionVersion) throw portalFailure('Convite inválido ou expirado.');
    const office = (await tx.get(deps.db.collection('providerOffices').doc(member.officeId))).data() as ProviderOffice | undefined;
    if (!office?.active || office.workspaceId !== member.workspaceId
      || invitation.get('officeSessionVersion') !== office.sessionVersion) throw portalFailure('Convite inválido ou expirado.');
    const at = deps.now().toISOString();
    if (typeof invitation.get('expiresAt') !== 'string' || !Number.isFinite(Date.parse(invitation.get('expiresAt')))
      || invitation.get('expiresAt') <= at) throw portalFailure('Convite inválido ou expirado.');
    const updated: StoredProviderMember = { ...member, password: credential, status: 'active', invitationHash: null,
      sessionVersion: member.sessionVersion + 1, updatedAt: at };
    tx.update(invitationRef, { consumedAt: at });
    tx.set(memberRef, updated);
    tx.create(deps.db.collection('providerPortalAudit').doc(deps.randomId()), {
      workspaceId: member.workspaceId, officeId: member.officeId, memberId, actorMemberId: memberId, actorUid: null, event: 'activated', at,
    });
    const safe = publicPortalMember(updated);
    return { id: safe.id, officeId: safe.officeId, name: safe.name, email: safe.email, accountType: safe.accountType, profile: safe.profile };
  });
}
export async function loginPortal(email: string, password: string, injected: Partial<PortalDependencies> = {}) {
  const deps = { ...portalDefaults, ...injected };
  const parsed = portalLoginSchema.safeParse({ email, password });
  if (!parsed.success) throw portalFailure('E-mail ou senha inválidos.', 401);
  await reservePortalAdmission(deps);
  const emailHash = portalHash(parsed.data.email);
  const at = deps.now();
  const attemptRef = deps.db.collection('providerPortalLoginAttempts').doc(emailHash);
  await deps.db.runTransaction(async (tx) => {
    const attempt = await tx.get(attemptRef);
    const insideWindow = Date.parse(attempt.get('resetAt') ?? '') > at.getTime();
    const count = insideWindow ? Number(attempt.get('count') ?? 0) : 0;
    if (count >= MAX_LOGIN_ATTEMPTS) throw portalFailure('Muitas tentativas. Tente novamente mais tarde.', 429);
    tx.set(attemptRef, { count: count + 1, resetAt: insideWindow ? attempt.get('resetAt') : new Date(at.getTime() + LOGIN_WINDOW_MS).toISOString(), deleteAfter: Timestamp.fromMillis(at.getTime() + 24 * 60 * 60 * 1000) });
  });
  const lookup = await deps.db.collection('providerPortalEmailLookups').doc(emailHash).get();
  const memberId = lookup.get('memberId');
  const memberRef = typeof memberId === 'string' ? deps.db.collection('providerMembers').doc(memberId) : null;
  const member = memberRef ? (await memberRef.get()).data() as StoredProviderMember | undefined : undefined;
  const passwordMatches = await verifyPortalPassword(password, member?.password ?? null);
  if (!passwordMatches || !memberRef || !member) throw portalFailure('E-mail ou senha inválidos.', 401);
  const token = deps.randomToken();
  const expiresAt = new Date(at.getTime() + PORTAL_SESSION_SECONDS * 1000).toISOString();
  const sessionRef = deps.db.collection('providerPortalSessions').doc(portalHash(token));
  const principal = await deps.db.runTransaction(async (tx) => {
    const fresh = (await tx.get(memberRef)).data() as StoredProviderMember | undefined;
    const office = fresh ? (await tx.get(deps.db.collection('providerOffices').doc(fresh.officeId))).data() as ProviderOffice | undefined : undefined;
    if (!validMember(fresh, office) || fresh!.password?.hash !== member.password?.hash || fresh!.sessionVersion !== member.sessionVersion) throw portalFailure('E-mail ou senha inválidos.', 401);
    tx.set(attemptRef, { count: 0, resetAt: new Date(at.getTime() + LOGIN_WINDOW_MS).toISOString(), deleteAfter: Timestamp.fromMillis(at.getTime() + 24 * 60 * 60 * 1000) });
    tx.create(sessionRef, { memberId: fresh!.id, officeId: fresh!.officeId, workspaceId: fresh!.workspaceId,
      sessionVersion: fresh!.sessionVersion, officeSessionVersion: office!.sessionVersion, createdAt: at.toISOString(), expiresAt, deleteAfter: Timestamp.fromMillis(Date.parse(expiresAt) + 24 * 60 * 60 * 1000), revokedAt: null });
    tx.create(deps.db.collection('providerPortalAudit').doc(deps.randomId()), {
      memberId: fresh!.id, officeId: fresh!.officeId, workspaceId: fresh!.workspaceId, actorMemberId: fresh!.id, actorUid: null, event: 'login', at: at.toISOString(),
    });
    return principalOf(fresh!);
  });
  return { token, expiresAt, principal };
}
export async function authenticatePortalSession(token: string, injected: Partial<PortalDependencies> = {}) {
  if (!TOKEN_PATTERN.test(token)) throw portalFailure('Entre novamente no portal.', 401);
  const deps = { ...portalDefaults, ...injected };
  return deps.db.runTransaction(async (tx) => {
    const session = await tx.get(deps.db.collection('providerPortalSessions').doc(portalHash(token)));
    if (!session.exists || session.get('revokedAt') || typeof session.get('expiresAt') !== 'string'
      || !Number.isFinite(Date.parse(session.get('expiresAt'))) || session.get('expiresAt') <= deps.now().toISOString()) throw portalFailure('Entre novamente no portal.', 401);
    const member = (await tx.get(deps.db.collection('providerMembers').doc(session.get('memberId')))).data() as StoredProviderMember | undefined;
    const office = member ? (await tx.get(deps.db.collection('providerOffices').doc(member.officeId))).data() as ProviderOffice | undefined : undefined;
    if (!validMember(member, office) || member!.sessionVersion !== session.get('sessionVersion')
      || office!.sessionVersion !== session.get('officeSessionVersion')
      || member!.workspaceId !== session.get('workspaceId') || member!.officeId !== session.get('officeId')) throw portalFailure('Entre novamente no portal.', 401);
    return principalOf(member!);
  });
}
export async function revokePortalSession(token: string, injected: Partial<PortalDependencies> = {}) {
  if (!TOKEN_PATTERN.test(token)) return;
  const deps = { ...portalDefaults, ...injected };
  await deps.db.runTransaction(async (tx) => {
    const ref = deps.db.collection('providerPortalSessions').doc(portalHash(token));
    const session = await tx.get(ref);
    if (!session.exists || session.get('revokedAt')) return;
    const at = deps.now().toISOString();
    tx.update(ref, { revokedAt: at });
    tx.create(deps.db.collection('providerPortalAudit').doc(deps.randomId()), {
      workspaceId: session.get('workspaceId'), officeId: session.get('officeId'), memberId: session.get('memberId'),
      actorMemberId: session.get('memberId'), actorUid: null, event: 'logout', at,
    });
  });
}
