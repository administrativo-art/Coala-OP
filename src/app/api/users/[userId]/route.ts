import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { resolveCollaboratorCore } from "@/features/hr/lib/collaborator-core.server";
import { syncTransportVoucherProjection } from "@/features/hr/lib/collaborator-data-contract.server";
import { recordTransportVoucherDecision } from "@/features/hr/lib/transport-voucher-decision.server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { canDelegateUnitAccess } from "@/lib/unit-access";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
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
  updatePdvLegalUserAccess,
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

function cleanPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanPayload);
  }

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

function isProtectedUser(user: Record<string, unknown>) {
  return user.username === "Tiago Brasil" || user.email === "administrativo@coalas.com";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const actor = await requireUser(request);
    const { userId } = await context.params;
    const rawPayload = await request.json();

    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const canManageUsers = actor.isDefaultAdmin || actor.permissions.settings.manageUsers;
    const canManageDp =
      actor.permissions.dp?.collaborators?.edit === true ||
      actor.permissions.dp?.collaborators?.terminate === true;

    if (!canManageUsers && !canManageDp) {
      return NextResponse.json({ error: "Sem permissão para editar usuário." }, { status: 403 });
    }

    const payload = cleanPayload(rawPayload) as Record<string, unknown>;
    for (const field of SERVER_ONLY_FIELDS) {
      delete payload[field];
    }

    const userRef = dbAdmin.collection("users").doc(userId);
    const existingUserSnap = await userRef.get();
    const existingUser = existingUserSnap.data() ?? {};
    if (!existingUserSnap.exists) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }
    await assertEmployeeUnitAccess(actor, userId);
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
      return NextResponse.json(
        { error: "Somente o administrador padrão pode alterar privilégios administrativos." },
        { status: 403 }
      );
    }

    if (restrictedFields.length > 0 && !canManageUsers) {
      return NextResponse.json(
        { error: "Sem permissão para alterar acesso, perfil ou desligamento." },
        { status: 403 }
      );
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
      return NextResponse.json(
        { error: "Você não pode atribuir unidades ou um escopo maior que o seu próprio." },
        { status: 403 },
      );
    }

    if (
      !actor.isDefaultAdmin &&
      typeof payload.profileId === "string" &&
      payload.profileId.trim() &&
      valuesDiffer(payload.profileId.trim(), existingUser.profileId)
    ) {
      if (userId === actor.decoded.uid) {
        return NextResponse.json(
          { error: "Somente o administrador padrão pode alterar o próprio perfil de acesso." },
          { status: 403 }
        );
      }
      const targetProfile = await dbAdmin
        .collection("profiles")
        .doc(payload.profileId.trim())
        .get();
      if (!targetProfile.exists) {
        return NextResponse.json({ error: "Perfil não encontrado." }, { status: 400 });
      }
      if (targetProfile.data()?.isDefaultAdmin === true) {
        return NextResponse.json(
          { error: "Somente o administrador padrão pode atribuir o perfil administrativo." },
          { status: 403 }
        );
      }
    }

    const nextUser = { ...existingUser, ...payload };
    const pdvSyncPlans = planPdvOperationalUnitSyncs(existingUser, nextUser);
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
            ? await updatePdvLegalUserAccess({
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
          transaction.set(userRef, payload, { merge: true });
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
      await userRef.set(payload, { merge: true });
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
          entity: existingUser.unitId ?? existingUser.unitIds?.[0] ?? "CS",
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
    const integrationFailure = error instanceof PdvApiError;
    const message = integrationFailure
      ? "Não foi possível atualizar a filial da colaboradora no PDV Legal. Nenhuma alteração de unidade foi salva no Coala One."
      : error instanceof Error ? error.message : "Falha ao atualizar usuário.";
    return NextResponse.json({ error: message }, { status: integrationFailure ? 502 : 400 });
  }
}
