import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { serializedTimestampParts } from "@/lib/firestore-serialized-timestamp";
import { appendOperationalPeriod, sameOperationalPeriods, operationalCivilDate, operationalUnitsOnDate, validateOperationalPeriods } from '@/lib/operational-unit-periods';
import { currentOperationalPatch } from '@/lib/operational-unit-periods.server';
import { prepareContractChange, applyContractChange, cancelContractChange } from '@/lib/contractual-data.server';
import { contractualDiff } from '@/lib/contractual-data';
import { CnpjValidator } from '@/lib/company/cnpj-validator';

import { resolveCollaboratorCore } from "@/features/hr/lib/collaborator-core.server";
import { syncTransportVoucherProjection } from "@/features/hr/lib/collaborator-data-contract.server";
import { recordTransportVoucherDecision } from "@/features/hr/lib/transport-voucher-decision.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { isEmploymentRelationshipType } from "@/lib/hr/employment-relationship";
import { ensureEmployeeDocumentFolderProfile } from "@/lib/hr/employee-document-folder-profile.server";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { canAccessUnit, canDelegateUnitAccess } from "@/lib/unit-access";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import {
  EMPLOYMENT_CYCLE_FIELDS,
  setEmploymentCyclePatch,
} from "@/lib/employment-cycle.server";
import {
  PdvOperationalUnitSyncError,
  PDV_SERVER_MANAGED_USER_FIELDS,
  operationalUnitIds,
  pdvAccessEnabled,
  planPdvAccessRevocation,
  planPdvOperationalUnitSyncs,
  sameOperationalUnits,
} from "@/features/hr/lib/pdv-operational-unit-sync";
import { deriveAssignedKioskIds, executePdvSyncPlans, loadPdvUnitIds } from "@/features/hr/lib/pdv-unit-sync.server";
import { PdvApiError } from "@/lib/integrations/pdv-legal-admin";

const MANAGE_USERS_ONLY_FIELDS = new Set([
  "profileId",
  "isActive",
  "inactivationType",
  "terminationReason",
  "terminationCause",
  "terminationNotes",
  "terminationDate",
  "unitAccessScope",
  "unitAccessUnitIds",
  "corporateGoogleEmail",
]);

const UNIT_ASSIGNMENT_FIELDS = new Set([
  "unitId",
  "unitIds",
  "assignedKioskIds",
  "unitAccessScope",
  "unitAccessUnitIds",
]);

const DEFAULT_ADMIN_ONLY_FIELDS = new Set([
  "isDefaultAdmin",
]);

const SERVER_ONLY_FIELDS = new Set([
  "id",
  "email",
  "lastLoginAt",
  "passwordChangedAt",
  "createdAt",
  "updatedAt",
  "operationalProjectionDate",
  "nextOperationalUnitChangeDate",
  "operationalProjectionSyncPending",
  "operationalUnitCutoverDate",
  "operationalFollowUpPending",
  "operationalFollowUpFromUnitIds",
  "operationalFollowUpError",
  "operationalFollowUpAttempts",
  "contractualDataPeriods",
  "contractualDataVersion",
  "scheduledContractChange",
  "nextContractChangeDate",
  "contractProjectionSyncPending",
  "contractualFieldOverrides",
  "probationEffectiveMarker",
  "probationProjectionPending",
  "employerCnpj",
  "employerUnitName",
  "hrEmployeeId",
  "personRecordType",
  "profileCompliance",
  "employmentCycleVersion",
  "absenceDocumentDeletionFence",
  ...PDV_SERVER_MANAGED_USER_FIELDS,
]);

const COLLABORATOR_CORE_FIELDS = new Set([
  "jobRoleId",
  "functionId",
  "jobFunctionIds",
  "unitId",
  "unitIds",
  "assignedKioskIds",
  "responsibleUnitIds",
  "unitAccessScope",
  "unitAccessUnitIds",
  "shiftDefinitionId",
  "operational",
  "operacional",
  "participatesInGoals",
  "loginRestrictionEnabled",
  "needsTransportVoucher",
  "transportVoucherValue",
  "jobRoleProfileSyncDisabled",
]);

const MAX_AUTOMATIC_PDV_UNIT_SYNCS = 10;
type RouteContext = { params: Promise<{ userId: string }> };
type UpdateUserResource = {
  userId: string;
  existingUser: Record<string, unknown>;
};

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "users.update",
  version: 1,
  surface: { method: "PATCH", path: "/api/users/[userId]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "user-management-update" },
  resourceScope: { kind: "custom", strategy: "employee-unit" },
  input: { kind: "none" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<
  NextRequest,
  RouteContext,
  unknown,
  ServerUserContext,
  Record<string, unknown>,
  UpdateUserResource
>({
  id: "user-management-update-v1",
  guarantees: [
    "authenticated-user",
    "active-user",
    "authorization:user-management-update",
    "scope:employee-unit",
  ],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "USER_UPDATE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const canManageUsers = actor.isDefaultAdmin || actor.permissions.settings.manageUsers;
    const canManageDp =
      actor.permissions.dp?.collaborators?.edit === true ||
      actor.permissions.dp?.collaborators?.terminate === true;
    if (!canManageUsers && !canManageDp) {
      throw new AppError({
        code: "USER_UPDATE_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para editar usuário.",
      });
    }

    const [params, rawPayload] = await Promise.all([
      routeContext.params,
      request.json().catch(() => null),
    ]);
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      throw new AppError({
        code: "USER_UPDATE_PAYLOAD_INVALID",
        kind: "VALIDATION",
        safeMessage: "Payload inválido.",
      });
    }

    const userId = params.userId;
    const existingUserSnap = await dbAdmin.collection("users").doc(userId).get();
    if (!existingUserSnap.exists) {
      throw new AppError({
        code: "USER_UPDATE_TARGET_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Usuário não encontrado.",
      });
    }
    await assertEmployeeUnitAccess(actor, userId).catch((cause) => {
      throw new AppError({
        code: "USER_UPDATE_UNIT_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Você não possui acesso à unidade deste colaborador.",
        cause,
      });
    });

    return {
      actor,
      input: rawPayload as Record<string, unknown>,
      resource: { userId, existingUser: existingUserSnap.data() ?? {} },
    };
  },
});

const collaboratorCoreValidationMessages = new Set([
  "Cargo não encontrado.",
  "Função não encontrada.",
  "A função selecionada não está vinculada ao cargo escolhido.",
  "Turno não encontrado.",
  "O turno selecionado não pertence à unidade escolhida.",
  "Escopo de unidades inválido.",
  "Selecione ao menos uma unidade para o escopo específico.",
]);

function cleanPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanPayload);
  }

  const timestamp = serializedTimestampParts(value);
  if (timestamp) return new Timestamp(timestamp.seconds, timestamp.nanoseconds);

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, cleanPayload(entry)])
    );
  }

  return value;
}

function hasCollaboratorCoreFields(payload: Record<string, unknown>) {
  return Object.keys(payload).some((field) => COLLABORATOR_CORE_FIELDS.has(field));
}

function hasOwn(payload: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function comparable(value: unknown) {
  if (value && typeof value === "object" && "seconds" in value && "nanoseconds" in value) {
    return value;
  }
  return value ?? null;
}

function valuesDiffer(left: unknown, right: unknown) {
  return JSON.stringify(comparable(left)) !== JSON.stringify(comparable(right));
}

function userEntity(user: Record<string, unknown>) {
  if (typeof user.unitId === "string" && user.unitId.trim()) return user.unitId.trim();
  if (Array.isArray(user.unitIds)) {
    const unitId = user.unitIds.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    if (unitId) return unitId.trim();
  }
  return "CS";
}

function isProtectedUser(user: Record<string, unknown>) {
  return user.username === "Tiago Brasil" || user.email === "administrativo@coalas.com";
}

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  try {
    const { actor, input: rawPayload, resource } = security;
    const { userId, existingUser } = resource;
    const canManageUsers = actor.isDefaultAdmin || actor.permissions.settings.manageUsers;
    const payload = cleanPayload(rawPayload) as Record<string, unknown>;
    const contractReason = payload.contractChangeReason;
    const contractEffectiveDate = payload.contractEffectiveDate;
    const cancelContractId = typeof payload.cancelContractChangeId === 'string' ? payload.cancelContractChangeId : null;
    delete payload.cancelContractChangeId;
    if (cancelContractId && !canManageUsers && actor.permissions.dp.collaborators.edit !== true) {
      throw new AppError({ code: 'CONTRACT_CANCEL_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    delete payload.contractChangeReason;
    delete payload.contractEffectiveDate;
    for (const field of SERVER_ONLY_FIELDS) {
      delete payload[field];
    }
    const operationalHistoryChanged = hasOwn(payload, 'operationalUnitPeriods')
      && valuesDiffer(payload.operationalUnitPeriods, existingUser.operationalUnitPeriods);
    if (!operationalHistoryChanged) delete payload.operationalUnitPeriods;
    if (operationalHistoryChanged) {
      if (!canManageUsers && actor.permissions.dp.collaborators.edit !== true) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para alterar as unidades operacionais.' });
      }
      if (!validateOperationalPeriods(payload.operationalUnitPeriods)) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_INVALID', kind: 'VALIDATION', safeMessage: 'Confira as datas e unidades das vigências operacionais.' });
      }
      const before = existingUser.operationalUnitPeriods;
      if (before !== undefined && !validateOperationalPeriods(before)) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_INCONSISTENT', kind: 'DATA_INTEGRITY', safeMessage: 'O histórico operacional precisa ser conferido antes da alteração.' });
      }
      const previous = before ?? [];
      const last = payload.operationalUnitPeriods.at(-1);
      if (last && previous.at(-1) && (last.validFrom <= previous.at(-1)!.validFrom
        || previous.at(-1)!.validTo && last.validFrom <= previous.at(-1)!.validTo!)) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_START', kind: 'VALIDATION', safeMessage: 'A nova vigência precisa começar depois da anterior.' });
      }
      if (!last || previous.length && last.validFrom < operationalCivilDate()
        || last.validTo !== undefined
        || !sameOperationalPeriods(appendOperationalPeriod(previous, last.validFrom, last.unitIds), payload.operationalUnitPeriods)) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_APPEND_ONLY', kind: 'VALIDATION', safeMessage: 'Acrescente uma nova vigência sem modificar os períodos anteriores.' });
      }
      if (payload.operationalUnitPeriods.some((period) => period.unitIds.some((id) => !canAccessUnit(actor.userDoc, id, { isDefaultAdmin: actor.isDefaultAdmin })))) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_SCOPE', kind: 'AUTHORIZATION', safeMessage: 'Uma das unidades da vigência está fora do seu escopo.' });
      }
      const selectedUnitIds = [...new Set(last.unitIds)];
      const selectedUnits = await dbAdmin.getAll(...selectedUnitIds.map((id) => dbAdmin.collection('dp_units').doc(id)));
      if (selectedUnits.some((unit) => !unit.exists || unit.get('isArchived') === true)) {
        throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_UNIT', kind: 'VALIDATION', safeMessage: 'Selecione unidades existentes e ativas para a nova vigência.' });
      }
    }
    const operationalPeriods = payload.operationalUnitPeriods ?? existingUser.operationalUnitPeriods;
    if (operationalPeriods !== undefined) {
      if (!validateOperationalPeriods(operationalPeriods)) throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_INVALID', kind: 'VALIDATION' });
      payload.unitIds = operationalUnitsOnDate({ operationalUnitPeriods: operationalPeriods });
      // Com vigência, os quiosques atribuídos saem dela; o valor enviado pelo cliente é ignorado.
      payload.assignedKioskIds = await deriveAssignedKioskIds(payload.unitIds as string[]);
    }
    if (hasOwn(payload, "pdvAccessEnabled")) {
      if (typeof payload.pdvAccessEnabled !== "boolean") {
        throw new AppError({ code: "USER_UPDATE_PDV_SWITCH_INVALID", kind: "VALIDATION", safeMessage: "Informe se a pessoa tem acesso ao PDV." });
      }
      if (payload.pdvAccessEnabled === pdvAccessEnabled(existingUser) && existingUser.pdvAccessEnabled === undefined) {
        delete payload.pdvAccessEnabled;
      } else if (payload.pdvAccessEnabled !== pdvAccessEnabled(existingUser)
        && !canManageUsers && actor.permissions.dp.collaborators.edit !== true) {
        throw new AppError({ code: "USER_UPDATE_PDV_SWITCH_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para alterar o acesso ao PDV." });
      }
    }
    if (
      hasOwn(payload, "employmentRelationshipType") &&
      !isEmploymentRelationshipType(payload.employmentRelationshipType)
    ) {
      throw new AppError({
        code: "USER_UPDATE_RELATIONSHIP_INVALID",
        kind: "VALIDATION",
        safeMessage: "Tipo de vínculo inválido.",
      });
    }

    const userRef = dbAdmin.collection("users").doc(userId);
    const unitAssignmentChanged = Object.keys(payload).some((field) =>
      UNIT_ASSIGNMENT_FIELDS.has(field) && valuesDiffer(payload[field], existingUser[field])
    );

    const restrictedFields = Object.keys(payload).filter((field) =>
      MANAGE_USERS_ONLY_FIELDS.has(field) && valuesDiffer(payload[field], existingUser[field])
    );
    const defaultAdminOnlyFields = Object.keys(payload).filter((field) =>
      DEFAULT_ADMIN_ONLY_FIELDS.has(field) && valuesDiffer(payload[field], existingUser[field])
    );

    if (defaultAdminOnlyFields.length > 0 && !actor.isDefaultAdmin) {
      throw new AppError({
        code: "USER_UPDATE_DEFAULT_ADMIN_REQUIRED",
        kind: "AUTHORIZATION",
        safeMessage: "Somente o administrador padrão pode alterar privilégios administrativos.",
      });
    }

    if (restrictedFields.length > 0 && !canManageUsers) {
      throw new AppError({
        code: "USER_UPDATE_RESTRICTED_FIELDS_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para alterar acesso, perfil ou desligamento.",
      });
    }

    if (hasOwn(payload, "corporateGoogleEmail")) {
      if (existingUser.googleWorkspaceMigrationStatus === "pending_auth") {
        throw new AppError({ code: "USER_UPDATE_GOOGLE_MIGRATION_IN_PROGRESS", kind: "CONFLICT",
          safeMessage: "A migração Google deste cadastro está em andamento. Aguarde a conclusão antes de trocar a conta autorizada." });
      }
      if (payload.corporateGoogleEmail === null || payload.corporateGoogleEmail === "") {
        payload.corporateGoogleEmail = null;
      } else if (typeof payload.corporateGoogleEmail === "string") {
        const corporateGoogleEmail = payload.corporateGoogleEmail.trim().toLowerCase();
        if (!/^[^\s@]+@coalashakes\.com$/.test(corporateGoogleEmail)) {
          throw new AppError({
            code: "USER_UPDATE_CORPORATE_GOOGLE_EMAIL_INVALID",
            kind: "VALIDATION",
            safeMessage: "Informe uma conta Google empresarial de coalashakes.com.",
          });
        }
        payload.corporateGoogleEmail = corporateGoogleEmail;
      } else {
        throw new AppError({
          code: "USER_UPDATE_CORPORATE_GOOGLE_EMAIL_INVALID",
          kind: "VALIDATION",
          safeMessage: "Conta Google empresarial inválida.",
        });
      }
    }

    if (hasCollaboratorCoreFields(payload)) {
      const collaboratorCore = await resolveCollaboratorCore(payload, {
        currentUser: existingUser,
        protectedUser: isProtectedUser(existingUser),
        syncProfile: true,
        inferFinancialUnit: false,
      });
      Object.assign(payload, collaboratorCore.userPatch);
    }

    if (
      unitAssignmentChanged &&
      !canDelegateUnitAccess(
        actor.userDoc,
        { ...existingUser, ...payload },
        { isDefaultAdmin: actor.isDefaultAdmin },
      )
    ) {
      throw new AppError({
        code: "USER_UPDATE_UNIT_SCOPE_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Você não pode atribuir unidades ou um escopo maior que o seu próprio.",
      });
    }
    if (typeof payload.unitId === "string" && payload.unitId.trim()
      && payload.unitId !== existingUser.unitId
      && !canAccessUnit(actor.userDoc, payload.unitId.trim(), { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({
        code: "USER_UPDATE_FINANCIAL_UNIT_SCOPE_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "A referência financeira está fora do seu escopo de unidades.",
      });
    }

    if (
      !actor.isDefaultAdmin &&
      typeof payload.profileId === "string" &&
      payload.profileId.trim() &&
      valuesDiffer(payload.profileId.trim(), existingUser.profileId)
    ) {
      if (userId === actor.decoded.uid) {
        throw new AppError({
          code: "USER_UPDATE_OWN_PROFILE_FORBIDDEN",
          kind: "AUTHORIZATION",
          safeMessage: "Somente o administrador padrão pode alterar o próprio perfil de acesso.",
        });
      }
      const targetProfile = await dbAdmin
        .collection("profiles")
        .doc(payload.profileId.trim())
        .get();
      if (!targetProfile.exists) {
        throw new AppError({
          code: "USER_UPDATE_PROFILE_NOT_FOUND",
          kind: "VALIDATION",
          safeMessage: "Perfil não encontrado.",
        });
      }
      if (targetProfile.data()?.isDefaultAdmin === true) {
        throw new AppError({
          code: "USER_UPDATE_ADMIN_PROFILE_FORBIDDEN",
          kind: "AUTHORIZATION",
          safeMessage: "Somente o administrador padrão pode atribuir o perfil administrativo.",
        });
      }
    }

    const contractChanged = Object.keys(contractualDiff(existingUser, payload)).length > 0;
    if (cancelContractId && contractChanged) throw new AppError({ code: 'CONTRACT_CANCEL_SEPARATE_ACTION', kind: 'VALIDATION', safeMessage: 'Cancele o agendamento antes de alterar os dados contratuais.' });
    if (contractChanged && !canManageUsers && actor.permissions.dp.collaborators.edit !== true) {
      throw new AppError({ code: 'CONTRACT_CHANGE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para alterar dados contratuais.' });
    }
    const employerId = typeof payload.employerUnitId === 'string' ? payload.employerUnitId : existingUser.employerUnitId;
    let employerSnapshot: import('@/lib/contractual-data.server').ContractualPeriod['employer'];
    if (contractChanged && typeof employerId === 'string' && employerId) {
      if (!canAccessUnit(actor.userDoc, employerId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: 'CONTRACT_EMPLOYER_SCOPE', kind: 'AUTHORIZATION', safeMessage: 'Empregador fora do seu escopo.' });
      const employer = await dbAdmin.collection('dp_units').doc(employerId).get();
      const cnpj = CnpjValidator.validate(String(employer.get('cnpj') ?? ''));
      if (employer.exists && cnpj.valid && employer.get('name') && employer.get('address')) {
        employerSnapshot = { unitId: employerId, unitName: String(employer.get('name')), address: String(employer.get('address')), cnpj: cnpj.clean, identityStatus: 'catalog_identifiers_consistent_unverified' };
        if (payload.employerUnitId !== undefined && payload.employerUnitId !== existingUser.employerUnitId) {
          payload.employerCnpj = cnpj.clean;
          payload.employerUnitName = String(employer.get('name'));
        }
      } else if (payload.employerUnitId !== undefined && payload.employerUnitId !== existingUser.employerUnitId) {
        throw new AppError({ code: 'CONTRACT_EMPLOYER_INCOMPLETE', kind: 'VALIDATION', safeMessage: 'Confira CNPJ, nome e endereço do empregador antes de salvar.' });
      }
    }
    const contractChange = prepareContractChange(existingUser, payload, { reason: contractReason, effectiveDate: contractEffectiveDate,
      id: userRef.collection('contractualChanges').doc().id, actorId: actor.decoded.uid,
      actorName: String(actor.userDoc.username ?? actor.decoded.uid), employer: employerSnapshot });
    if (!contractChange && payload.profileId === existingUser.profileId) delete payload.profileId;
    if (typeof contractChange?.fields.profileId === 'string') {
      contractChange.profileWasDefaultAdmin = (await dbAdmin.collection('profiles').doc(contractChange.fields.profileId).get()).get('isDefaultAdmin') === true;
    }
    if (contractChange && contractChange.effectiveDate === operationalCivilDate()) Object.assign(payload, contractChange.fields);
    const nextUser = { ...existingUser, ...payload };
    const corporateGoogleEmailForUniqueness = hasOwn(payload, "corporateGoogleEmail")
      && typeof payload.corporateGoogleEmail === "string" ? payload.corporateGoogleEmail : null;
    const assertCorporateGoogleEmailUnique = async (transaction: FirebaseFirestore.Transaction) => {
      if (!corporateGoogleEmailForUniqueness) return;
      const duplicate = await transaction.get(dbAdmin.collection("users")
        .where("corporateGoogleEmail", "==", corporateGoogleEmailForUniqueness).limit(2));
      if (duplicate.docs.some((document) => document.id !== userId)) {
        throw new AppError({ code: "USER_UPDATE_CORPORATE_GOOGLE_EMAIL_IN_USE", kind: "CONFLICT",
          safeMessage: "Esta conta Google empresarial já está autorizada para outro cadastro." });
      }
    };
    const pdvWasEnabled = pdvAccessEnabled(existingUser);
    const pdvEnabled = pdvAccessEnabled(nextUser);
    const pdvSyncPlans = pdvWasEnabled && !pdvEnabled
      ? planPdvAccessRevocation(existingUser)
      : pdvEnabled && !sameOperationalUnits(existingUser, nextUser)
        ? planPdvOperationalUnitSyncs(existingUser, nextUser, {
            pdvUnitIds: await loadPdvUnitIds([...operationalUnitIds(existingUser), ...operationalUnitIds(nextUser)]),
          })
        : [];
    const employmentCycleChanged = Object.keys(payload).some((field) =>
      EMPLOYMENT_CYCLE_FIELDS.has(field) && valuesDiffer(payload[field], existingUser[field])
    );
    if (employmentCycleChanged && pdvSyncPlans.length > 0) {
      throw new AppError({ code: "USER_UPDATE_EMPLOYMENT_AND_PDV_CONFLICT", kind: "CONFLICT",
        safeMessage: "Atualize o vínculo e as unidades do PDV em operações separadas." });
    }
    if (pdvSyncPlans.length > MAX_AUTOMATIC_PDV_UNIT_SYNCS) {
      throw new PdvOperationalUnitSyncError(
        `Selecione no máximo ${MAX_AUTOMATIC_PDV_UNIT_SYNCS} novas unidades por alteração para sincronizar o PDV Legal.`,
      );
    }
    let pdvSyncAuditRef: FirebaseFirestore.DocumentReference | null = null;
    let pdvSyncCompletedAt: string | null = null;
    let pdvSyncResults: Array<Record<string, unknown>> = [];

    if (pdvSyncPlans.length > 0) {
      const execution = await executePdvSyncPlans({
        userRef,
        user: existingUser,
        plans: pdvSyncPlans,
        actorId: actor.decoded.uid,
        actorName: String(actor.userDoc.username ?? actor.userDoc.email ?? actor.decoded.uid),
        action: pdvWasEnabled && !pdvEnabled ? "pdv_access_revoked" : "pdv_access_unit_sync",
      });
      pdvSyncAuditRef = execution.auditRef;
      pdvSyncCompletedAt = execution.completedAt;
      pdvSyncResults = execution.results;
      Object.assign(payload, execution.patch);
    }

    if (pdvSyncAuditRef && pdvSyncPlans.length > 0) {
      try {
        await dbAdmin.runTransaction(async (transaction) => {
          const latestUserSnap = await transaction.get(userRef);
          if (corporateGoogleEmailForUniqueness && latestUserSnap.get('googleWorkspaceMigrationStatus') === 'pending_auth') {
            throw new AppError({ code: "USER_UPDATE_GOOGLE_MIGRATION_IN_PROGRESS", kind: "CONFLICT",
              safeMessage: "A migração Google deste cadastro está em andamento. Aguarde a conclusão antes de trocar a conta autorizada." });
          }
          await assertCorporateGoogleEmailUnique(transaction);
          const latestUser = latestUserSnap.data() ?? {};
          if (operationalHistoryChanged && valuesDiffer(latestUser.operationalUnitPeriods, existingUser.operationalUnitPeriods)) {
            throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_CONFLICT', kind: 'CONFLICT', safeMessage: 'As vigências mudaram. Atualize o cadastro antes de salvar.' });
          }
          if (!sameOperationalUnits(existingUser, latestUser)) {
            throw new PdvOperationalUnitSyncError(
              "As unidades da colaboradora foram alteradas durante a sincronização. Tente novamente.",
            );
          }
          const contractPatch = cancelContractId
            ? cancelContractChange(transaction, userRef, latestUserSnap, existingUser, { id: cancelContractId, reason: contractReason, actorId: actor.decoded.uid, actorName: String(actor.userDoc.username ?? actor.decoded.uid) })
            : applyContractChange(transaction, userRef, latestUserSnap, existingUser, contractChange);
          setEmploymentCyclePatch(transaction, userRef, latestUserSnap, currentOperationalPatch(latestUser, { ...payload, ...contractPatch }),
            { cycleMutation: employmentCycleChanged });
          if (operationalHistoryChanged) transaction.create(userRef.collection('operationalUnitAudit').doc(), {
            actorId: actor.decoded.uid, before: existingUser.operationalUnitPeriods ?? [],
            after: payload.operationalUnitPeriods, createdAt: Timestamp.now(),
          });
          transaction.set(pdvSyncAuditRef!, {
            status: "completed",
            completedOperations: pdvSyncResults,
            completedAt: Timestamp.now(),
            confirmedAt: pdvSyncCompletedAt,
          }, { merge: true });
        });
      } catch (error) {
        await pdvSyncAuditRef.set({
          status: "failed_after_external_update",
          failureCode: "LOCAL_COMMIT_FAILED",
          failedAt: Timestamp.now(),
        }, { merge: true }).catch(() => undefined);
        throw error;
      }
    } else {
      await dbAdmin.runTransaction(async (transaction) => {
        const latestUserSnap = await transaction.get(userRef);
        if (corporateGoogleEmailForUniqueness && latestUserSnap.get('googleWorkspaceMigrationStatus') === 'pending_auth') {
          throw new AppError({ code: "USER_UPDATE_GOOGLE_MIGRATION_IN_PROGRESS", kind: "CONFLICT",
            safeMessage: "A migração Google deste cadastro está em andamento. Aguarde a conclusão antes de trocar a conta autorizada." });
        }
        await assertCorporateGoogleEmailUnique(transaction);
        if (!latestUserSnap.exists) throw new AppError({ code: "USER_UPDATE_TARGET_NOT_FOUND", kind: "NOT_FOUND" });
        if (operationalHistoryChanged && valuesDiffer(latestUserSnap.get('operationalUnitPeriods'), existingUser.operationalUnitPeriods)) {
          throw new AppError({ code: 'USER_OPERATIONAL_PERIOD_CONFLICT', kind: 'CONFLICT', safeMessage: 'As vigências mudaram. Atualize o cadastro antes de salvar.' });
        }
        const contractPatch = cancelContractId
          ? cancelContractChange(transaction, userRef, latestUserSnap, existingUser, { id: cancelContractId, reason: contractReason, actorId: actor.decoded.uid, actorName: String(actor.userDoc.username ?? actor.decoded.uid) })
          : applyContractChange(transaction, userRef, latestUserSnap, existingUser, contractChange);
        setEmploymentCyclePatch(transaction, userRef, latestUserSnap, currentOperationalPatch(latestUserSnap.data() ?? {}, { ...payload, ...contractPatch }),
          { cycleMutation: employmentCycleChanged });
        if (operationalHistoryChanged) transaction.create(userRef.collection('operationalUnitAudit').doc(), {
          actorId: actor.decoded.uid, before: existingUser.operationalUnitPeriods ?? [],
          after: payload.operationalUnitPeriods, createdAt: Timestamp.now(),
        });
      });
    }

    if (unitAssignmentChanged) {
      const nextUser = (await userRef.get()).data() ?? { ...existingUser, ...payload };
      const employeeId = typeof nextUser.hrEmployeeId === "string" && nextUser.hrEmployeeId.trim()
        ? nextUser.hrEmployeeId.trim()
        : typeof nextUser.registrationIdBizneo === "string" && nextUser.registrationIdBizneo.trim()
          ? nextUser.registrationIdBizneo.trim()
          : userId;
      const employeeRef = hrDbAdmin.collection("employees").doc(employeeId);
      const employeeSnap = await employeeRef.get();
      if (employeeSnap.exists) {
        const nextUnitIds = Array.isArray(nextUser.unitIds)
          ? nextUser.unitIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          : [];
        const nextPrimaryUnitId = typeof nextUser.unitId === "string" && nextUser.unitId.trim()
          ? nextUser.unitId.trim()
          : nextUnitIds[0] ?? "sem-unidade";
        await employeeRef.set({
          unit_id: nextPrimaryUnitId,
          unit_ids: nextUnitIds,
          updated_at: Timestamp.now(),
        }, { merge: true });
      }
    }

    if (hasOwn(payload, "employmentRelationshipType") && valuesDiffer(payload.employmentRelationshipType, existingUser.employmentRelationshipType)) {
      const employeeId = typeof existingUser.hrEmployeeId === "string" && existingUser.hrEmployeeId.trim()
        ? existingUser.hrEmployeeId.trim()
        : userId;
      await ensureEmployeeDocumentFolderProfile({
        employeeId,
        relationshipType: payload.employmentRelationshipType,
        actorId: actor.decoded.uid,
        source: "user_relationship_update",
      });
    }

    if (hasOwn(payload, "needsTransportVoucher") || hasOwn(payload, "transportVoucherValue")) {
      const active = payload.needsTransportVoucher === true;
      const latestHistory = Array.isArray(payload.transportVoucherHistory)
        ? [...payload.transportVoucherHistory].reverse().find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined
        : undefined;
      const decisionChanged =
        active !== (existingUser.needsTransportVoucher === true)
        || (active && valuesDiffer(payload.transportVoucherValue, existingUser.transportVoucherValue));
      if (decisionChanged) {
        await recordTransportVoucherDecision({
          employeeId: userId,
          active,
          dailyValue: typeof payload.transportVoucherValue === "number" ? payload.transportVoucherValue : null,
          effectiveDate: typeof latestHistory?.effectiveDate === "string" ? latestHistory.effectiveDate : null,
          reason: typeof latestHistory?.reason === "string" ? latestHistory.reason : null,
          entity: userEntity(existingUser),
          actorId: actor.decoded.uid,
        });
      }
      await syncTransportVoucherProjection({
        userId,
        active,
        valueReais: typeof payload.transportVoucherValue === "number" ? payload.transportVoucherValue : null,
        actorId: actor.decoded.uid,
        source: "collaborator_data_contract_v1",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const knownMessage = error instanceof Error ? error.message : "";
    if (error instanceof PdvApiError) {
      throw new AppError({
        code: "USER_UPDATE_PDV_SYNC_FAILED",
        kind: "PERMANENT_EXTERNAL",
        safeMessage: "Não foi possível atualizar a filial da colaboradora no PDV Legal. Nenhuma alteração de unidade foi salva no Coala One.",
        cause: error,
      });
    }
    if (error instanceof PdvOperationalUnitSyncError) {
      throw new AppError({
        code: "USER_UPDATE_PDV_SYNC_INVALID",
        kind: "CONFLICT",
        safeMessage: knownMessage,
        cause: error,
      });
    }
    if (collaboratorCoreValidationMessages.has(knownMessage)) {
      throw new AppError({
        code: "USER_UPDATE_CORE_INVALID",
        kind: "VALIDATION",
        safeMessage: knownMessage,
        cause: error,
      });
    }
    throw new AppError({
      code: "USER_UPDATE_FAILED",
      kind: "UNEXPECTED_APPLICATION",
      safeMessage: "Falha ao atualizar usuário.",
      cause: error,
    });
  }
});
