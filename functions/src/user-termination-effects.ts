import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from "firebase-admin/firestore";

type UserRecord = Record<string, unknown>;
type PendingWrite = (batch: WriteBatch) => void;

export type TerminationEffectsReport = {
  version: 1;
  userId: string;
  userName: string;
  employer: {
    unitId: string | null;
    entityId: string | null;
    legalName: string | null;
    cnpj: string | null;
  } | null;
  effectiveDate: string;
  appliedAt: string;
  counts: Record<string, number>;
  pendingActions: Array<{ type: string; count: number; label: string }>;
};

const TERMINAL_TASK_STATUSES = new Set(["completed", "rejected", "cancelled", "canceled"]);
const TERMINAL_FORM_STATUSES = new Set(["completed", "cancelled", "canceled", "rejected"]);
const TERMINAL_ASSET_STATUSES = new Set(["fora_de_uso", "vendido", "descartado", "baixado"]);

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
    : [];
}

function effectiveDateFor(user: UserRecord, now: Date) {
  const raw = user.terminationDate;
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 10);
  if (raw && typeof raw === "object" && "toDate" in raw && typeof raw.toDate === "function") {
    return raw.toDate().toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10);
}

async function commitInChunks(db: Firestore, writes: PendingWrite[]) {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    writes.slice(index, index + 400).forEach((write) => write(batch));
    await batch.commit();
  }
}

function addCount(counts: Record<string, number>, key: string, amount = 1) {
  counts[key] = (counts[key] ?? 0) + amount;
}

function taskFallback(user: UserRecord) {
  const roleId = stringValue(user.jobRoleId);
  if (roleId) return { type: "role", id: roleId };
  const unitId = stringValue(user.unitId) ?? stringArray(user.unitIds)[0] ?? stringArray(user.assignedKioskIds)[0];
  if (unitId) return { type: "unit", id: unitId };
  return { type: "user", id: "__unassigned__" };
}

async function queryUnique(
  db: Firestore,
  collection: string,
  fields: string[],
  userId: string,
) {
  const documents = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const field of fields) {
    const snapshot = await db.collection(collection).where(field, "==", userId).get();
    snapshot.docs.forEach((document) => documents.set(document.ref.path, document));
  }
  return [...documents.values()];
}

export async function applyUserTerminationEffects(params: {
  db: Firestore;
  hrDb: Firestore;
  checklistDb: Firestore;
  userId: string;
  user: UserRecord;
  now?: Date;
}): Promise<TerminationEffectsReport> {
  const now = params.now ?? new Date();
  const appliedAt = now.toISOString();
  const effectiveDate = effectiveDateFor(params.user, now);
  const userName = stringValue(params.user.username) ?? params.userId;
  const employerCnpj = stringValue(params.user.terminationEmployerCnpj) ?? stringValue(params.user.employerCnpj);
  const employer = employerCnpj ? {
    unitId: stringValue(params.user.terminationEmployerUnitId) ?? stringValue(params.user.employerUnitId),
    entityId: stringValue(params.user.terminationEmployerEntityId),
    legalName: stringValue(params.user.terminationEmployerName) ?? stringValue(params.user.employerUnitName),
    cnpj: employerCnpj.replace(/\D/g, ""),
  } : null;
  const counts: Record<string, number> = {};
  const mainWrites: PendingWrite[] = [];
  const hrWrites: PendingWrite[] = [];
  const checklistWrites: PendingWrite[] = [];

  // Cadastro canônico do RH e cache de acesso não podem continuar ativos.
  const employeeDocuments = new Map<string, FirebaseFirestore.DocumentSnapshot>(
    (await queryUnique(params.hrDb, "employees", ["auth_uid", "source_user_id"], params.userId))
      .map((employee) => [employee.ref.path, employee]),
  );
  const directEmployee = await params.hrDb.collection("employees").doc(params.userId).get();
  if (directEmployee.exists) employeeDocuments.set(directEmployee.ref.path, directEmployee);
  employeeDocuments.forEach((employee) => {
    hrWrites.push((batch) => batch.set(employee.ref, {
      status: "terminated",
      employment_status: "terminated",
      is_active: false,
      termination_date: effectiveDate,
      termination_effects_applied_at: appliedAt,
      updated_at: appliedAt,
    }, { merge: true }));
    addCount(counts, "hrEmployeesReconciled");
  });
  const accessCacheDocuments = new Map<string, FirebaseFirestore.DocumentSnapshot>(
    (await queryUnique(params.hrDb, "rh_access_cache", ["auth_uid", "source_user_id"], params.userId))
      .map((cache) => [cache.ref.path, cache]),
  );
  const directAccessCache = await params.hrDb.collection("rh_access_cache").doc(params.userId).get();
  if (directAccessCache.exists) accessCacheDocuments.set(directAccessCache.ref.path, directAccessCache);
  accessCacheDocuments.forEach((cache) => {
    hrWrites.push((batch) => batch.set(cache.ref, {
      status: "inactive",
      is_active: false,
      access_revoked_at: appliedAt,
      updated_at: appliedAt,
    }, { merge: true }));
    addCount(counts, "hrAccessCachesRevoked");
  });

  // Responsabilidade atual: preserva o cargo/função e desocupa apenas a pessoa.
  for (const collection of ["dp_unitGroups", "dp_unitOrganizations"]) {
    const snapshot = await params.db.collection(collection).where("responsibleUserId", "==", params.userId).get();
    snapshot.docs.forEach((document) => {
      mainWrites.push((batch) => batch.update(document.ref, {
        responsibleUserId: FieldValue.delete(),
        responsibleUserName: FieldValue.delete(),
        responsibilityStatus: "replacement_required",
        responsibilityVacatedAt: appliedAt,
        responsibilityVacatedByTerminationUserId: params.userId,
      }));
      addCount(counts, "unitResponsibilitiesVacated");
    });
  }

  // Escalas passadas são histórico. Somente datas posteriores ao último dia são removidas.
  const schedules = await params.db.collection("dp_schedules").get();
  const removedWorkBySchedule = new Map<DocumentReference, number>();
  for (const schedule of schedules.docs) {
    const shifts = await schedule.ref.collection("shifts").where("userId", "==", params.userId).get();
    shifts.docs.forEach((shift) => {
      const date = stringValue(shift.get("date"));
      if (!date || date <= effectiveDate) return;
      mainWrites.push((batch) => batch.delete(shift.ref));
      if (shift.get("type") !== "day_off") {
        removedWorkBySchedule.set(schedule.ref, (removedWorkBySchedule.get(schedule.ref) ?? 0) + 1);
      }
      addCount(counts, "futureShiftsRemoved");
    });
  }
  removedWorkBySchedule.forEach((amount, scheduleRef) => {
    mainWrites.push((batch) => batch.update(scheduleRef, { shiftCount: FieldValue.increment(-amount) }));
  });

  // Férias futuras não podem continuar aparecendo como planejadas/aprovadas.
  const vacations = await params.db.collection("dp_vacations").where("userId", "==", params.userId).get();
  vacations.docs.forEach((vacation) => {
    const startDate = stringValue(vacation.get("startDate"));
    const status = stringValue(vacation.get("status"));
    if (!startDate || startDate <= effectiveDate || status === "REJECTED") return;
    mainWrites.push((batch) => batch.update(vacation.ref, {
      status: "REJECTED",
      warnings: FieldValue.arrayUnion("Cancelada automaticamente devido ao desligamento."),
      cancelledByTermination: true,
      cancelledAt: appliedAt,
    }));
    addCount(counts, "futureVacationsCancelled");
  });

  // Tarefas abertas migram para o cargo/unidade; tarefas terminais preservam a autoria.
  const tasks = await queryUnique(params.db, "tasks", ["assigneeId", "assignee_id", "approverId", "approver_id"], params.userId);
  const fallback = taskFallback(params.user);
  tasks.forEach((task) => {
    const status = stringValue(task.get("status")) ?? "pending";
    if (TERMINAL_TASK_STATUSES.has(status)) return;
    const data = task.data();
    const update: Record<string, unknown> = {
      requiresRelinkDecision: true,
      terminationRelinkedAt: appliedAt,
      terminationRelinkedUserId: params.userId,
      updatedAt: appliedAt,
      updated_at: appliedAt,
    };
    if (data.assigneeId === params.userId || data.assignee_id === params.userId) {
      Object.assign(update, {
        assigneeType: fallback.type,
        assignee_type: fallback.type,
        assigneeId: fallback.id,
        assignee_id: fallback.id,
        previousAssigneeUserId: params.userId,
      });
      addCount(counts, "openTasksRelinked");
    }
    if (data.approverId === params.userId || data.approver_id === params.userId) {
      Object.assign(update, {
        approverType: fallback.type,
        approver_type: fallback.type,
        approverId: fallback.id,
        approver_id: fallback.id,
        previousApproverUserId: params.userId,
      });
      addCount(counts, "openApprovalsRelinked");
    }
    mainWrites.push((batch) => batch.set(task.ref, update, { merge: true }));
  });

  const watchedTasks = await params.db.collection("tasks").where("watcherUserIds", "array-contains", params.userId).get();
  watchedTasks.docs.forEach((task) => {
    mainWrites.push((batch) => batch.update(task.ref, {
      watcherUserIds: FieldValue.arrayRemove(params.userId),
      watcher_user_ids: FieldValue.arrayRemove(params.userId),
    }));
    addCount(counts, "taskWatchersRemoved");
  });

  // Participação em metas permanece auditável, mas termina na data do desligamento.
  const activePeriods = await params.db.collection("goalPeriods").where("status", "==", "active").get();
  const activePeriodIds = new Set(activePeriods.docs.map((period) => period.id));
  activePeriods.docs.forEach((period) => {
    const recipients = Array.isArray(period.get("leadershipRecipients"))
      ? period.get("leadershipRecipients")
      : [];
    const filtered = recipients.filter((recipient: unknown) => {
      return !recipient || typeof recipient !== "object"
        || (recipient as Record<string, unknown>).userId !== params.userId;
    });
    if (filtered.length === recipients.length) return;
    mainWrites.push((batch) => batch.set(period.ref, {
      leadershipRecipients: filtered,
      leadershipRecipientsReconciledAt: appliedAt,
      leadershipReplacementRequired: true,
    }, { merge: true }));
    addCount(counts, "activeLeadershipRecipientsRemoved");
  });
  const goals = await params.db.collection("employeeGoals").where("employeeId", "==", params.userId).get();
  goals.docs.filter((goal) => activePeriodIds.has(String(goal.get("periodId")))).forEach((goal) => {
    mainWrites.push((batch) => batch.set(goal.ref, {
      participantStatus: "terminated",
      participationEndedAt: effectiveDate,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    addCount(counts, "activeGoalsEnded");
  });

  // Patrimônio atual vira pendência de nova atribuição. Histórico baixado permanece intacto.
  const assets = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  const byUser = await params.db.collection("assets").where("responsibleUserId", "==", params.userId).get();
  byUser.docs.forEach((asset) => assets.set(asset.id, asset));
  if (userName !== params.userId) {
    const legacyByName = await params.db.collection("assets").where("responsibleName", "==", userName).get();
    legacyByName.docs.forEach((asset) => assets.set(asset.id, asset));
  }
  assets.forEach((asset) => {
    if (TERMINAL_ASSET_STATUSES.has(String(asset.get("status") ?? ""))) return;
    mainWrites.push((batch) => batch.update(asset.ref, {
      responsibleUserId: FieldValue.delete(),
      responsibleName: FieldValue.delete(),
      responsibilityStatus: "pending_assignment",
      previousResponsibleUserId: params.userId,
      previousResponsibleName: userName,
      responsibilityVacatedAt: appliedAt,
    }));
    addCount(counts, "activeAssetsVacated");
  });

  // Signatário da empresa é função operacional; documentos já assinados não são alterados.
  const signatoryEntities = await params.db.collection("entities").where("documentSignatoryUserId", "==", params.userId).get();
  signatoryEntities.docs.forEach((entity) => {
    mainWrites.push((batch) => batch.update(entity.ref, {
      documentSignatoryUserId: FieldValue.delete(),
      documentSignatoryName: FieldValue.delete(),
      documentSignatoryEmail: FieldValue.delete(),
      documentSignatoryStatus: "replacement_required",
      documentSignatoryVacatedAt: appliedAt,
    }));
    addCount(counts, "companySignatoriesVacated");
  });

  // Membros de projetos perdem o acesso operacional; created_by/histórico é preservado.
  const taskProjects = await params.db.collection("task_projects").get();
  taskProjects.docs.forEach((project) => {
    const members = Array.isArray(project.get("members")) ? project.get("members") : [];
    const filtered = members.filter((member: unknown) => {
      return !member || typeof member !== "object" || (member as Record<string, unknown>).user_id !== params.userId;
    });
    if (filtered.length === members.length) return;
    mainWrites.push((batch) => batch.update(project.ref, { members: filtered, updated_at: appliedAt }));
    addCount(counts, "taskProjectMembershipsRemoved");
  });

  const formProjects = await params.checklistDb.collection("form_projects").get();
  formProjects.docs.forEach((project) => {
    const members = Array.isArray(project.get("members")) ? project.get("members") : [];
    const filtered = members.filter((member: unknown) => {
      return !member || typeof member !== "object" || (member as Record<string, unknown>).user_id !== params.userId;
    });
    if (filtered.length === members.length) return;
    checklistWrites.push((batch) => batch.update(project.ref, { members: filtered, updated_at: appliedAt }));
    addCount(counts, "formProjectMembershipsRemoved");
  });

  // Execuções abertas voltam para a fila da unidade. Execuções concluídas preservam o executor.
  for (const collection of ["form_executions", "checklistExecutions"]) {
    const executions = await queryUnique(
      params.checklistDb,
      collection,
      ["assigned_user_id", "assignedUserId", "claimed_by_user_id", "claimedByUserId"],
      params.userId,
    );
    const collaboratorExecutions = await params.checklistDb.collection(collection)
      .where("collaborator_user_ids", "array-contains", params.userId)
      .get();
    const executionMap = new Map(executions.map((execution) => [execution.ref.path, execution]));
    collaboratorExecutions.docs.forEach((execution) => executionMap.set(execution.ref.path, execution));
    executionMap.forEach((execution) => {
      const status = stringValue(execution.get("status")) ?? "pending";
      if (TERMINAL_FORM_STATUSES.has(status)) return;
      const data = execution.data();
      const update: Record<string, unknown> = {
        requires_reassignment: true,
        termination_relinked_at: appliedAt,
        updated_at: appliedAt,
      };
      if (data.assigned_user_id === params.userId || data.assignedUserId === params.userId) {
        Object.assign(update, {
          assigned_user_id: "__unit_pool__",
          assigned_username: "Fila da unidade",
          assignedUserId: "__unit_pool__",
          assignedUsername: "Fila da unidade",
          previous_assigned_user_id: params.userId,
          previousAssignedUserId: params.userId,
        });
      }
      if (data.claimed_by_user_id === params.userId || data.claimedByUserId === params.userId) {
        Object.assign(update, {
          claimed_by_user_id: null,
          claimed_by_username: null,
          claimed_at: null,
          claimedByUserId: null,
          claimedByUsername: null,
          claimedAt: null,
          previous_claimed_by_user_id: params.userId,
        });
      }
      if (Array.isArray(data.collaborator_user_ids) && data.collaborator_user_ids.includes(params.userId)) {
        update.collaborator_user_ids = FieldValue.arrayRemove(params.userId);
      }
      checklistWrites.push((batch) => batch.set(execution.ref, update, { merge: true }));
      addCount(counts, "openFormExecutionsRelinked");
    });
  }

  // Sessões legadas de compra ainda abertas não podem continuar sob a conta inativa.
  const openPurchaseSessions = await params.db.collection("purchaseSessions")
    .where("userId", "==", params.userId)
    .where("status", "==", "open")
    .get();
  openPurchaseSessions.docs.forEach((session) => {
    mainWrites.push((batch) => batch.set(session.ref, {
      userId: "__unassigned__",
      previousUserId: params.userId,
      previousUserName: userName,
      requiresRelinkDecision: true,
      terminationRelinkedAt: appliedAt,
    }, { merge: true }));
    addCount(counts, "openPurchaseSessionsRelinked");
  });

  // Solicitações já enviadas para assinatura exigem decisão formal; não são canceladas silenciosamente.
  const signatureRequests = await params.hrDb.collection("hrSignatureRequests")
    .where("employeeId", "==", params.userId)
    .get();
  signatureRequests.docs.forEach((request) => {
    const status = String(request.get("status") ?? "");
    if (["signed", "archived", "rejected", "expired", "cancelled", "canceled"].includes(status)) return;
    hrWrites.push((batch) => batch.set(request.ref, {
      requiresTerminationDecision: true,
      terminationEffectiveDate: effectiveDate,
      terminationDecisionRequestedAt: appliedAt,
    }, { merge: true }));
    addCount(counts, "signatureRequestsAwaitingDecision");
  });

  // Uniformes em posse não são baixados automaticamente: exigem devolução registrada.
  const uniformAssignments = await params.db.collection("uniformAssignments")
    .where("collaboratorUserId", "==", params.userId)
    .get();
  const pendingUniformPieces = uniformAssignments.docs.reduce((sum, assignment) => {
    return sum + Math.max(0, Number(assignment.get("quantityInPossession") ?? 0));
  }, 0);
  if (pendingUniformPieces > 0) counts.pendingUniformPieces = pendingUniformPieces;

  await Promise.all([
    commitInChunks(params.db, mainWrites),
    commitInChunks(params.hrDb, hrWrites),
    commitInChunks(params.checklistDb, checklistWrites),
  ]);

  const pendingActions = [
    { type: "unit_responsibility", count: counts.unitResponsibilitiesVacated ?? 0, label: "Definir sucessor para responsabilidades de unidade/grupo." },
    { type: "asset_responsibility", count: counts.activeAssetsVacated ?? 0, label: "Atribuir os patrimônios ativos a outro responsável." },
    { type: "task_relink", count: (counts.openTasksRelinked ?? 0) + (counts.openApprovalsRelinked ?? 0), label: "Revisar tarefas e aprovações redirecionadas." },
    { type: "company_signatory", count: counts.companySignatoriesVacated ?? 0, label: "Definir novo signatário da empresa." },
    { type: "goal_leadership", count: counts.activeLeadershipRecipientsRemoved ?? 0, label: "Definir liderança substituta nas metas ativas." },
    { type: "purchase_session", count: counts.openPurchaseSessionsRelinked ?? 0, label: "Reatribuir as sessões de compra ainda abertas." },
    { type: "signature_decision", count: counts.signatureRequestsAwaitingDecision ?? 0, label: "Decidir formalmente sobre solicitações de assinatura em andamento." },
    { type: "uniform_return", count: pendingUniformPieces, label: "Registrar a devolução dos uniformes em posse." },
  ].filter((item) => item.count > 0);

  const report: TerminationEffectsReport = {
    version: 1,
    userId: params.userId,
    userName,
    employer,
    effectiveDate,
    appliedAt,
    counts,
    pendingActions,
  };

  await params.hrDb.collection("terminationImpactReports")
    .doc(`${params.userId}__${effectiveDate}`)
    .set({
      ...report,
      status: pendingActions.length ? "pending" : "complete",
      updated_at: appliedAt,
    }, { merge: true });

  return report;
}
