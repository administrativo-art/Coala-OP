import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { serializedTimestampParts } from "@/lib/firestore-serialized-timestamp";

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
import { canDelegateUnitAccess } from "@/lib/unit-access";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import {
  EMPLOYMENT_CYCLE_FIELDS,
  setEmploymentCyclePatch,
} from "@/lib/employment-cycle.server";
import {
  PdvOperationalUnitSyncError,
  PDV_SERVER_MANAGED_USER_FIELDS,
  pdvOperationalUnitPatch,
  planPdvOperationalUnitSyncs,
  sameOperationalUnits,
} from "@/features/hr/lib/pdv-operational-unit-sync";
import {
  PdvApiError,
  clonePdvLegalUserAccessToFilial,
  movePdvLegalUserAccessToFilial,
} from "@/lib/integrations/pdv-legal-admin";

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
    for (const field of SERVER_ONLY_FIELDS) {
      delete payload[field];
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

    if (hasCollaboratorCoreFields(payload)) {
      const collaboratorCore = await resolveCollaboratorCore(payload, {
        currentUser: existingUser,
        protectedUser: isProtectedUser(existingUser),
        syncProfile: true,
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

    const nextUser = { ...existingUser, ...payload };
    const pdvSyncPlans = planPdvOperationalUnitSyncs(existingUser, nextUser);
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
    const pdvSyncResults: Array<Record<string, unknown>> = [];

    if (pdvSyncPlans.length > 0) {
      const targetUnitSnapshots = await Promise.all(pdvSyncPlans.map((plan) =>
        dbAdmin.collection("dp_units").doc(plan.targetUnitId).get()
      ));
      const targetUnits = new Map(pdvSyncPlans.map((plan, index) => {
        const snapshot = targetUnitSnapshots[index];
        const unit = snapshot.data() ?? {};
        const name = typeof unit.name === "string" ? unit.name.trim() : "";
        const filialId = typeof unit.pdvFilialId === "string" ? unit.pdvFilialId.trim() : "";
        if (!snapshot.exists || unit.isArchived === true) {
          throw new PdvOperationalUnitSyncError(`A unidade operacional ${plan.targetUnitId} não foi encontrada ou está arquivada.`);
        }
        if (!filialId) {
          throw new PdvOperationalUnitSyncError(
            `A unidade operacional ${name || plan.targetUnitId} ainda não está vinculada a uma filial do PDV Legal.`,
          );
        }
        return [plan.targetUnitId, { name: name || plan.targetUnitId, filialId }] as const;
      }));

      pdvSyncAuditRef = userRef.collection("systemAccessAudit").doc();
      const requestedAt = Timestamp.now();
      await pdvSyncAuditRef.set({
        action: "pdv_access_unit_sync",
        status: "pending",
        operations: pdvSyncPlans.map((plan) => ({
          operation: plan.kind,
          sourceExternalUserId: plan.sourceExternalUserId,
          fromUnitId: plan.sourceUnitId,
          toUnitId: plan.targetUnitId,
          toFilialId: targetUnits.get(plan.targetUnitId)?.filialId ?? null,
        })),
        actorId: actor.decoded.uid,
        actorName: actor.userDoc.username ?? actor.userDoc.email ?? actor.decoded.uid,
        requestedAt,
      });

      try {
        let workingPdvUser = existingUser;
        for (const plan of pdvSyncPlans) {
          const targetUnit = targetUnits.get(plan.targetUnitId)!;
          const updatedPdvUser = plan.kind === "move"
            ? await movePdvLegalUserAccessToFilial({
                userId: plan.sourceExternalUserId,
                filialId: targetUnit.filialId,
                profileId: plan.profileId,
              })
            : await clonePdvLegalUserAccessToFilial({
                sourceUserId: plan.sourceExternalUserId,
                filialId: targetUnit.filialId,
                profileId: plan.profileId,
              });
          const confirmedProfileId = updatedPdvUser.profileId;
          if (!confirmedProfileId) {
            throw new PdvApiError(
              "O PDV Legal não confirmou o perfil preservado após a sincronização de filial.",
              "USER_PROFILE_NOT_CONFIRMED",
            );
          }
          pdvSyncCompletedAt = new Date().toISOString();
          const pdvPatch = pdvOperationalUnitPatch({
            currentUser: workingPdvUser,
            plan,
            externalUserId: updatedPdvUser.id,
            targetUnitName: targetUnit.name,
            targetFilialId: targetUnit.filialId,
            targetFilialName: targetUnit.name,
            confirmedProfileId,
            updatedAt: pdvSyncCompletedAt,
          });
          workingPdvUser = { ...workingPdvUser, ...pdvPatch };
          Object.assign(payload, pdvPatch);
          pdvSyncResults.push({
            operation: plan.kind,
            externalUserId: updatedPdvUser.id,
            unitId: plan.targetUnitId,
            filialId: targetUnit.filialId,
            status: "completed",
          });
        }
      } catch (error) {
        await pdvSyncAuditRef.set({
          status: "failed",
          completedOperations: pdvSyncResults,
          failureCode: error instanceof PdvApiError ? error.code : "UNEXPECTED_FAILURE",
          failedAt: Timestamp.now(),
        }, { merge: true }).catch(() => undefined);
        throw error;
      }
    }

    if (pdvSyncAuditRef && pdvSyncPlans.length > 0) {
      try {
        await dbAdmin.runTransaction(async (transaction) => {
          const latestUserSnap = await transaction.get(userRef);
          const latestUser = latestUserSnap.data() ?? {};
          if (!sameOperationalUnits(existingUser, latestUser)) {
            throw new PdvOperationalUnitSyncError(
              "As unidades da colaboradora foram alteradas durante a sincronização. Tente novamente.",
            );
          }
          setEmploymentCyclePatch(transaction, userRef, latestUserSnap, payload,
            { cycleMutation: employmentCycleChanged });
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
        if (!latestUserSnap.exists) throw new AppError({ code: "USER_UPDATE_TARGET_NOT_FOUND", kind: "NOT_FOUND" });
        setEmploymentCyclePatch(transaction, userRef, latestUserSnap, payload,
          { cycleMutation: employmentCycleChanged });
      });
    }

    if (unitAssignmentChanged) {
      const nextUser = { ...existingUser, ...payload };
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
