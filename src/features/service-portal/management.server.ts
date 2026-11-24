import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';

import { portalDefaults, portalFailure, portalHash, PORTAL_INVITATION_SECONDS, publicPortalMember } from './auth.server';
import { portalManagementSchema, type PortalManagementInput } from './schemas';
import type {
  PortalDependencies, PortalManagementResult, PortalManager, PortalPrincipal,
  ProviderGrant, ProviderMember, ProviderOffice, StoredProviderMember,
} from './types';

export async function listPortalManagement(workspaceId: string, injected: Partial<PortalDependencies> = {}) {
  const { db } = { ...portalDefaults, ...injected };
  const [offices, members, grants] = await Promise.all([
    db.collection('providerOffices').where('workspaceId', '==', workspaceId).limit(101).get(),
    db.collection('providerMembers').where('workspaceId', '==', workspaceId).limit(501).get(),
    db.collection('providerPortalGrants').where('workspaceId', '==', workspaceId).limit(1001).get(),
  ]);
  if (offices.size > 100 || members.size > 500 || grants.size > 1000) throw portalFailure('O volume excedeu o limite desta consulta. Solicite a paginação do cadastro.');
  return { offices: offices.docs.map((doc) => doc.data() as ProviderOffice),
    members: members.docs.map((doc) => publicPortalMember(doc.data() as StoredProviderMember)),
    grants: grants.docs.map((doc) => doc.data() as ProviderGrant) };
}

export async function listPortalGrants(principal: PortalPrincipal, injected: Partial<PortalDependencies> = {}) {
  const deps = { ...portalDefaults, ...injected };
  const docs = await deps.db.collection('providerPortalGrants').where('workspaceId', '==', principal.workspaceId)
    .where('officeId', '==', principal.officeId).where('memberId', '==', principal.memberId)
    .where('revokedAt', '==', null).where('expiresAt', '>', deps.now().toISOString()).limit(101).get();
  if (docs.size > 100) throw portalFailure('O volume de autorizações excedeu o limite da consulta.');
  return docs.docs.map((doc) => doc.data() as ProviderGrant);
}

export async function managePortal(actor: PortalManager, rawInput: PortalManagementInput, injected: Partial<PortalDependencies> = {}): Promise<PortalManagementResult> {
  const input = portalManagementSchema.parse(rawInput);
  const deps = { ...portalDefaults, ...injected };
  if (!actor.uid || !actor.workspaceId) throw portalFailure();
  const at = deps.now();
  if (input.action === 'grant' && Date.parse(input.expiresAt) <= at.getTime()) throw portalFailure('Informe uma validade futura.');
  if (input.action === 'invite_member' && await deps.internalEmailExists(input.email)) throw portalFailure('Este endereço já pertence a uma conta interna. Use um endereço próprio do prestador.');
  const operationId = 'requestId' in input ? portalHash(JSON.stringify([actor.workspaceId, actor.uid, input.requestId])) : null;
  const digest = portalHash(JSON.stringify(input));
  const officeId = input.action === 'create_office' ? deps.randomId() : 'officeId' in input ? input.officeId : null;
  const memberId = input.action === 'invite_member' ? deps.randomId() : 'memberId' in input ? input.memberId : null;
  const grantId = input.action === 'grant' ? portalHash(JSON.stringify([actor.workspaceId, input.memberId, input.employerUnitId, input.competence])) : input.action === 'revoke_grant' ? input.grantId : null;
  const invitationToken = input.action === 'invite_member' || input.action === 'reissue_invitation' ? deps.randomToken() : null;
  const invitationHash = invitationToken ? portalHash(invitationToken) : null;
  const invitationExpiresAt = new Date(at.getTime() + PORTAL_INVITATION_SECONDS * 1000).toISOString();
  return deps.db.runTransaction(async (tx) => {
    const operationRef = operationId ? deps.db.collection('providerPortalOperations').doc(operationId) : null;
    if (operationRef) {
      const replay = await tx.get(operationRef);
      if (replay.exists) {
        if (replay.get('digest') !== digest) throw portalFailure('O identificador da tentativa foi usado com outro conteúdo.');
        const resourceId = replay.get('resourceId');
        const kind = replay.get('kind');
        if (kind === 'office') return { office: (await tx.get(deps.db.collection('providerOffices').doc(resourceId))).data() as ProviderOffice };
        if (kind === 'member') return { member: publicPortalMember((await tx.get(deps.db.collection('providerMembers').doc(resourceId))).data() as StoredProviderMember) };
        return { grant: (await tx.get(deps.db.collection('providerPortalGrants').doc(resourceId))).data() as ProviderGrant };
      }
    }
    let office: ProviderOffice | undefined;
    let member: StoredProviderMember | undefined;
    let grant: ProviderGrant | undefined;
    if (officeId && input.action !== 'create_office') {
      office = (await tx.get(deps.db.collection('providerOffices').doc(officeId))).data() as ProviderOffice | undefined;
      if (!office || office.workspaceId !== actor.workspaceId) throw portalFailure('Prestador não encontrado.');
    }
    if (memberId && input.action !== 'invite_member') {
      member = (await tx.get(deps.db.collection('providerMembers').doc(memberId))).data() as StoredProviderMember | undefined;
      if (!member || member.workspaceId !== actor.workspaceId) throw portalFailure('Profissional não encontrado.');
      office = (await tx.get(deps.db.collection('providerOffices').doc(member.officeId))).data() as ProviderOffice | undefined;
      if (!office || office.workspaceId !== actor.workspaceId) throw portalFailure('Prestador não encontrado.');
    }
    if (grantId) {
      grant = (await tx.get(deps.db.collection('providerPortalGrants').doc(grantId))).data() as ProviderGrant | undefined;
      if (input.action === 'revoke_grant' && (!grant || grant.workspaceId !== actor.workspaceId)) throw portalFailure('Autorização não encontrada.');
    }
    if (input.action === 'invite_member') {
      const lookup = await tx.get(deps.db.collection('providerPortalEmailLookups').doc(portalHash(input.email)));
      if (lookup.exists) throw portalFailure('Este endereço já possui um cadastro de prestador.');
    }
    if (input.action === 'grant' && (!member?.active || member.status !== 'active' || !office?.active)) throw portalFailure('Ative o profissional e o prestador antes de conceder acesso.');
    if (input.action === 'reissue_invitation' && !member?.active) throw portalFailure('Ative o profissional antes de emitir outro convite.');
    if ((input.action === 'invite_member' || input.action === 'reissue_invitation') && !office?.active) throw portalFailure('Ative o prestador antes de convidar um profissional.');
    if (input.action === 'set_office_active' && office!.active === input.active) return { office };
    if (input.action === 'set_member_active' && member!.active === input.active) return { member: publicPortalMember(member!) };
    if (input.action === 'revoke_grant' && grant!.revokedAt) return { grant };
    const result: PortalManagementResult = {};
    let resourceId: string;
    let kind: 'office' | 'member' | 'grant';
    if (input.action === 'create_office') {
      office = { id: officeId!, workspaceId: actor.workspaceId, name: input.name, active: true, sessionVersion: 0,
        createdAt: at.toISOString(), updatedAt: at.toISOString(), createdBy: actor.uid, updatedBy: actor.uid };
      tx.create(deps.db.collection('providerOffices').doc(office.id), office);
      result.office = office; resourceId = office.id; kind = 'office';
    } else if (input.action === 'set_office_active') {
      office = { ...office!, active: input.active, sessionVersion: office!.sessionVersion + 1, updatedAt: at.toISOString(), updatedBy: actor.uid };
      tx.set(deps.db.collection('providerOffices').doc(office.id), office);
      result.office = office; resourceId = office.id; kind = 'office';
    } else if (input.action === 'invite_member' || input.action === 'reissue_invitation') {
      member = input.action === 'invite_member' ? {
        id: memberId!, workspaceId: actor.workspaceId, officeId: office!.id, name: input.name, email: input.email,
        accountType: 'service_provider', profile: 'accounting', active: true, status: 'invited', password: null,
        invitationHash, sessionVersion: 0, createdAt: at.toISOString(), updatedAt: at.toISOString(), createdBy: actor.uid, updatedBy: actor.uid,
      } : { ...member!, invitationHash, status: 'invited', password: null, sessionVersion: member!.sessionVersion + 1,
        updatedAt: at.toISOString(), updatedBy: actor.uid };
      tx.set(deps.db.collection('providerMembers').doc(member.id), member);
      if (input.action === 'invite_member') tx.create(deps.db.collection('providerPortalEmailLookups').doc(portalHash(member.email)), {
        memberId: member.id, workspaceId: actor.workspaceId, officeId: member.officeId, createdAt: at.toISOString(),
      });
      tx.create(deps.db.collection('providerPortalInvitations').doc(invitationHash!), {
        memberId: member.id, officeId: member.officeId, workspaceId: actor.workspaceId,
        createdBy: actor.uid, createdAt: at.toISOString(), memberSessionVersion: member.sessionVersion,
        officeSessionVersion: office!.sessionVersion, expiresAt: invitationExpiresAt, deleteAfter: Timestamp.fromMillis(Date.parse(invitationExpiresAt) + 24 * 60 * 60 * 1000), consumedAt: null,
      });
      result.member = publicPortalMember(member);
      result.invitation = { token: invitationToken!, expiresAt: invitationExpiresAt, memberId: member.id };
      resourceId = member.id; kind = 'member';
    } else if (input.action === 'set_member_active') {
      member = { ...member!, active: input.active, sessionVersion: member!.sessionVersion + 1, updatedAt: at.toISOString(), updatedBy: actor.uid };
      tx.set(deps.db.collection('providerMembers').doc(member.id), member);
      result.member = publicPortalMember(member); resourceId = member.id; kind = 'member';
    } else if (input.action === 'grant') {
      if (grant && grant.workspaceId !== actor.workspaceId) throw portalFailure();
      grant = { id: grantId!, memberId: member!.id, officeId: member!.officeId, workspaceId: actor.workspaceId,
        employerUnitId: input.employerUnitId, competence: input.competence, expiresAt: new Date(input.expiresAt).toISOString(),
        revokedAt: null, revokedBy: null, createdAt: at.toISOString(), createdBy: actor.uid };
      tx.set(deps.db.collection('providerPortalGrants').doc(grant.id), grant);
      result.grant = grant; resourceId = grant.id; kind = 'grant';
    } else {
      grant = { ...grant!, revokedAt: at.toISOString(), revokedBy: actor.uid };
      tx.set(deps.db.collection('providerPortalGrants').doc(grant.id), grant);
      result.grant = grant; resourceId = grant.id; kind = 'grant';
    }
    if (operationRef) tx.create(operationRef, { workspaceId: actor.workspaceId, actorUid: actor.uid,
      memberId: result.member?.id ?? result.grant?.memberId ?? null, digest, resourceId, kind, createdAt: at.toISOString() });
    tx.create(deps.db.collection('providerPortalAudit').doc(deps.randomId()), {
      workspaceId: actor.workspaceId, officeId: result.office?.id ?? result.member?.officeId ?? result.grant?.officeId ?? null,
      memberId: result.member?.id ?? result.grant?.memberId ?? null, actorUid: actor.uid, actorMemberId: null,
      event: input.action, resourceId, at: at.toISOString(),
      employerUnitId: result.grant?.employerUnitId ?? null, competence: result.grant?.competence ?? null,
      expiresAt: result.grant?.expiresAt ?? null, revokedAt: result.grant?.revokedAt ?? null,
      active: result.office?.active ?? result.member?.active ?? null,
    });
    return result;
  });
}
