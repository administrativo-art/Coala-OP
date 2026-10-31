import 'server-only';

import { FieldValue, Timestamp, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { resolveDPShiftAssignment, type DPShiftAssignment } from '@/lib/dp-external-coverage';
import { resolveDPJourney, type DPJourneyResolvedBy } from '@/lib/dp-journey-resolution';
import { buildDPShiftReference, buildShiftDefinitionReference, type DPShiftReference } from '@/lib/dp-shift-reference';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import type { DPJourney, DPShiftDefinition } from '@/types';
import { guardOccupancyWrite, operationalGuardRequested, shiftOccupancySlices } from '@/features/dp/absences/operational/occupancy-guard.server';
import { preparePublicationFenceAdvance } from '@/features/dp/schedules/publication-fence.server';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';

import type { BulkWorkShiftInput } from './schemas';

const OCCUPANCY_QUERY_LIMIT = 200;
const VACATION_QUERY_LIMIT = 75;
const JOURNEY_QUERY_LIMIT = 100;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function isScheduleShift(document: QueryDocumentSnapshot) {
  const segments = document.ref.path.split('/');
  return segments.length === 4 && segments[0] === 'dp_schedules' && segments[2] === 'shifts';
}

function scheduleIdFromShift(document: QueryDocumentSnapshot) {
  return document.ref.parent.parent?.id ?? '';
}

function assertEditPermission(context: ServerUserContext) {
  if (!context.isDefaultAdmin && !context.permissions.dp.schedules.edit) {
    throw new AppError({
      code: 'DP_SHIFT_BULK_EDIT_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para editar turnos em lote.',
    });
  }
}

export async function applyWorkShiftBulkChange(params: {
  context: ServerUserContext;
  scheduleId: string;
  input: BulkWorkShiftInput;
  requestId: string;
}) {
  const { context, scheduleId, input, requestId } = params;
  assertEditPermission(context);
  if (input.action === 'create') {
    return applyWorkShiftBulkCreate({ context, scheduleId, input, requestId });
  }
  const replacePatch = input.action === 'replace' ? input.patch : null;

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const shiftRefs = input.shiftIds.map((shiftId) => scheduleRef.collection('shifts').doc(shiftId));
  const targetUserId = replacePatch?.userId ?? null;
  const targetUserRef = targetUserId
    ? dbAdmin.collection('users').doc(targetUserId)
    : null;
  const targetShiftDefinitionRef = replacePatch?.shiftDefinitionId
    ? dbAdmin.collection('dp_shiftDefinitions').doc(replacePatch.shiftDefinitionId)
    : null;

  return dbAdmin.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    if (scheduleSnapshot.get('activeRevisionId')) throw new AppError({ code: 'DP_SHIFT_BULK_REVISION_NOT_READY', kind: 'CONFLICT', safeMessage: 'A edição em lote desta revisão oficial aguarda integração.' });
    const shiftSnapshots = await transaction.getAll(...shiftRefs);
    const targetUserSnapshot = targetUserRef ? await transaction.get(targetUserRef) : null;
    const targetShiftDefinitionSnapshot = targetShiftDefinitionRef
      ? await transaction.get(targetShiftDefinitionRef)
      : null;

    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (!hasPublishedScheduleVersion(scheduleSnapshot.data() ?? {})) {
      throw new AppError({ code: 'DP_SHIFT_DRAFT_NOT_OPERATIONAL', kind: 'CONFLICT', safeMessage: 'A escala precisa ser publicada antes de receber turnos operacionais.' });
    }

    const scheduleUnitId = scheduleSnapshot.get('unitId');
    if (typeof scheduleUnitId !== 'string' || !scheduleUnitId) {
      throw new AppError({
        code: 'DP_SHIFT_BULK_REQUIRES_UNIT_SCHEDULE',
        kind: 'VALIDATION',
        safeMessage: 'A edição em lote exige uma escala vinculada a uma unidade.',
      });
    }
    if (!canAccessUnit(context.userDoc, scheduleUnitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({
        code: 'DP_SHIFT_UNIT_FORBIDDEN',
        kind: 'AUTHORIZATION',
        safeMessage: 'Sem acesso à unidade desta escala.',
      });
    }
    const unitSnapshot = await transaction.get(dbAdmin.collection('dp_units').doc(scheduleUnitId));
    if (!unitSnapshot.exists || unitSnapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SHIFT_UNIT_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'A unidade da escala não existe ou está arquivada.' });
    }

    const scheduleMonth = Number(scheduleSnapshot.get('month'));
    const scheduleYear = Number(scheduleSnapshot.get('year'));
    const expectedPeriod = `${scheduleYear}-${String(scheduleMonth).padStart(2, '0')}`;
    if (!Number.isInteger(scheduleMonth) || !Number.isInteger(scheduleYear)) {
      throw new AppError({
        code: 'DP_SHIFT_BULK_SCHEDULE_PERIOD_INVALID',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'A competência da escala está inválida.',
      });
    }

    const selected = shiftSnapshots.map((snapshot) => {
      if (!snapshot.exists) {
        throw new AppError({
          code: 'DP_SHIFT_BULK_ITEM_NOT_FOUND',
          kind: 'NOT_FOUND',
          safeMessage: 'Um dos turnos selecionados não existe mais. Atualize a escala e tente novamente.',
        });
      }
      if (snapshot.get('type') === 'day_off') {
        throw new AppError({
          code: 'DP_SHIFT_BULK_DAY_OFF_FORBIDDEN',
          kind: 'CONFLICT',
          safeMessage: 'Folgas não podem ser alteradas por esta operação em lote.',
        });
      }
      const date = snapshot.get('date');
      const unitId = snapshot.get('unitId');
      if (typeof date !== 'string' || !date.startsWith(`${expectedPeriod}-`) || unitId !== scheduleUnitId) {
        throw new AppError({
          code: 'DP_SHIFT_BULK_ITEM_MISMATCH',
          kind: 'DATA_INTEGRITY',
          safeMessage: 'Um dos turnos não pertence à competência ou à unidade selecionada.',
        });
      }
      return { snapshot, date };
    });
    const previousReferenceIds = selected.flatMap(({ snapshot }) => {
      const id = snapshot.get('referenceRevisionId');
      return typeof id === 'string' && id ? [id] : [];
    });
    const previousReferences = new Map<string, DPShiftReference>();
    if (input.action === 'replace' && previousReferenceIds.length) {
      const documents = await transaction.getAll(...previousReferenceIds.map((id) => dbAdmin.collection('dp_shiftReferenceHistory').doc(id)));
      for (const document of documents) {
        const reference = document.get('reference') as DPShiftReference | undefined;
        const matchingShift = selected.find(({ snapshot }) => snapshot.get('referenceRevisionId') === document.id)?.snapshot;
        if (document.exists && matchingShift && document.get('shiftPath') === matchingShift.ref.path
          && document.get('userId') === matchingShift.get('userId') && reference?.schemaVersion === 1
          && reference.collaboratorId === matchingShift.get('userId')) {
          previousReferences.set(document.id, reference);
        }
      }
    }

    const replacementCrossesMidnight = Boolean(
      replacePatch?.startTime
      && replacePatch.endTime
      && replacePatch.endTime < replacePatch.startTime,
    );
    if (replacePatch?.shiftDefinitionId && !targetShiftDefinitionSnapshot?.exists) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'O turno configurado não existe mais.' });
    }
    if (replacePatch?.shiftDefinitionId && targetShiftDefinitionSnapshot?.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_ARCHIVED', kind: 'CONFLICT', safeMessage: 'O turno escolhido está arquivado. Selecione um turno ativo.' });
    }
    if (replacementCrossesMidnight && (
      !targetShiftDefinitionSnapshot?.exists
      || targetShiftDefinitionSnapshot.get('overnight') !== true
      || targetShiftDefinitionSnapshot.get('startTime') !== replacePatch?.startTime
      || targetShiftDefinitionSnapshot.get('endTime') !== replacePatch?.endTime
    )) {
      throw new AppError({
        code: 'DP_SHIFT_OVERNIGHT_DEFINITION_REQUIRED',
        kind: 'VALIDATION',
        safeMessage: 'Para atravessar a meia-noite, selecione um turno noturno com estes mesmos horários.',
      });
    }

    const effectiveShiftDefinitionIds = [...new Set(selected.flatMap(({ snapshot }) => {
      const shiftDefinitionId = replacePatch?.startTime && replacePatch.endTime
        ? replacePatch.shiftDefinitionId ?? null
        : typeof snapshot.get('shiftDefinitionId') === 'string' ? String(snapshot.get('shiftDefinitionId')) : null;
      return shiftDefinitionId ? [shiftDefinitionId] : [];
    }))];
    const shiftDefinitionsById = new Map<string, Record<string, unknown>>();
    if (targetShiftDefinitionSnapshot?.exists) {
      shiftDefinitionsById.set(targetShiftDefinitionSnapshot.id, targetShiftDefinitionSnapshot.data() ?? {});
    }
    const additionalDefinitionIds = effectiveShiftDefinitionIds.filter((id) => !shiftDefinitionsById.has(id));
    if (additionalDefinitionIds.length) {
      const definitionDocuments = await transaction.getAll(...additionalDefinitionIds.map((id) => (
        dbAdmin.collection('dp_shiftDefinitions').doc(id)
      )));
      for (const document of definitionDocuments) {
        if (!document.exists) {
          throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Um dos turnos configurados não existe mais.' });
        }
        shiftDefinitionsById.set(document.id, document.data() ?? {});
      }
    }

    let targetUserName: string | null = null;
    let targetAssignment: DPShiftAssignment | null = null;
    const targetAssignments = new Map<string, DPShiftAssignment>();
    const journeyResolutionByDate = new Map<string, { journey: DPJourney; resolvedBy: DPJourneyResolvedBy }>();
    let occupancyByDate = new Map<string, QueryDocumentSnapshot[]>();
    if (targetUserRef && targetUserSnapshot && targetUserId) {
      if (!targetUserSnapshot.exists || targetUserSnapshot.get('isActive') === false) {
        throw new AppError({
          code: 'DP_SHIFT_USER_UNAVAILABLE',
          kind: 'EXPECTED_BUSINESS',
          safeMessage: 'Colaboradora não encontrada ou inativa.',
        });
      }
      targetUserName = typeof targetUserSnapshot.get('username') === 'string'
        ? targetUserSnapshot.get('username')
        : null;
      for (const { date } of selected) {
      try {
        targetAssignment = resolveDPShiftAssignment({
          executionUnitId: scheduleUnitId,
          date,
          executionUnitExternalId: typeof unitSnapshot.get('externalId') === 'string' ? unitSnapshot.get('externalId') : undefined,
          user: targetUserSnapshot.data() ?? {},
        });
      } catch {
        throw new AppError({ code: 'DP_SHIFT_EXTERNAL_ORIGIN_REQUIRED', kind: 'DATA_INTEGRITY', safeMessage: 'A unidade de origem da colaboradora precisa estar definida antes da cobertura.' });
      }
      if (targetAssignment.assignmentKind === 'external_coverage') {
        if (!context.isDefaultAdmin && context.permissions.dp.schedules.assignExternal !== true) {
          throw new AppError({ code: 'DP_SHIFT_EXTERNAL_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para trazer colaboradoras de outra unidade.' });
        }
        if (!replacePatch?.exceptionReason) {
          throw new AppError({ code: 'DP_SHIFT_EXTERNAL_REASON_REQUIRED', kind: 'VALIDATION', safeMessage: 'Informe o motivo da cobertura em outra unidade.' });
        }
      }

      targetAssignments.set(date, targetAssignment);
      }

      const primaryUnitId = typeof targetUserSnapshot.get('unitId') === 'string' && targetUserSnapshot.get('unitId')
        ? String(targetUserSnapshot.get('unitId'))
        : scheduleUnitId;
      const primaryUnitSnapshot = primaryUnitId === scheduleUnitId
        ? unitSnapshot
        : await transaction.get(dbAdmin.collection('dp_units').doc(primaryUnitId));
      if (!primaryUnitSnapshot.exists || primaryUnitSnapshot.get('isArchived') === true) {
        throw new AppError({ code: 'DP_SHIFT_PRIMARY_UNIT_UNAVAILABLE', kind: 'DATA_INTEGRITY', safeMessage: 'A unidade principal da colaboradora não existe ou está arquivada.' });
      }
      const unitGroupId = typeof primaryUnitSnapshot.get('groupId') === 'string' ? String(primaryUnitSnapshot.get('groupId')) : undefined;
      const unitGroupSnapshot = unitGroupId
        ? await transaction.get(dbAdmin.collection('dp_unitGroups').doc(unitGroupId))
        : null;
      const unitOrganizationId = typeof primaryUnitSnapshot.get('organizationId') === 'string'
        ? String(primaryUnitSnapshot.get('organizationId'))
        : unitGroupSnapshot?.exists && typeof unitGroupSnapshot.get('organizationId') === 'string'
          ? String(unitGroupSnapshot.get('organizationId'))
          : undefined;
      const journeysSnapshot = await transaction.get(
        dbAdmin.collection('dp_journeys')
          .where('status', 'in', ['published', 'archived'])
          .limit(JOURNEY_QUERY_LIMIT + 1),
      );
      if (journeysSnapshot.size > JOURNEY_QUERY_LIMIT) {
        throw new AppError({ code: 'DP_SHIFT_JOURNEY_CATALOG_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'Há jornadas demais para resolver esta atribuição com segurança.' });
      }
      const journeys = journeysSnapshot.docs.map((document) => ({ id: document.id, ...document.data() } as DPJourney));
      selected.forEach(({ snapshot, date }) => {
        const resolution = resolveDPJourney({
          journeys,
          target: {
            collaboratorId: targetUserId,
            ...(typeof targetUserSnapshot.get('jobRoleId') === 'string' ? { jobRoleId: String(targetUserSnapshot.get('jobRoleId')) } : {}),
            jobFunctionIds: Array.isArray(targetUserSnapshot.get('jobFunctionIds')) ? targetUserSnapshot.get('jobFunctionIds') : [],
            unitId: primaryUnitId,
            ...(unitGroupId ? { unitGroupId } : {}),
            ...(unitOrganizationId ? { unitOrganizationId } : {}),
          },
          date,
        });
        if (resolution.status === 'none') {
          throw new AppError({ code: 'DP_SHIFT_JOURNEY_NOT_FOUND', kind: 'EXPECTED_BUSINESS', safeMessage: 'Nenhuma jornada vigente se aplica à colaboradora escolhida.' });
        }
        if (resolution.status === 'ambiguous') {
          throw new AppError({ code: 'DP_SHIFT_JOURNEY_AMBIGUOUS', kind: 'CONFLICT', safeMessage: 'Mais de uma jornada com a mesma prioridade se aplica à colaboradora escolhida.' });
        }
        const effectiveShiftDefinitionId = replacePatch?.startTime && replacePatch.endTime
          ? replacePatch.shiftDefinitionId ?? undefined
          : typeof snapshot.get('shiftDefinitionId') === 'string' ? String(snapshot.get('shiftDefinitionId')) : undefined;
        if (!isShiftDefinitionCompatibleWithJourney({
          journeyId: resolution.journey.id,
          journeyAllowedShiftDefinitionIds: resolution.journey.allowedShiftDefinitionIds,
          shiftDefinitionId: effectiveShiftDefinitionId,
          shiftJourneyIds: effectiveShiftDefinitionId
            ? shiftDefinitionsById.get(effectiveShiftDefinitionId)?.journeyIds
            : undefined,
        })) {
          throw new AppError({ code: 'DP_SHIFT_NOT_ALLOWED_BY_JOURNEY', kind: 'VALIDATION', safeMessage: 'Um dos turnos selecionados não é permitido pela jornada aplicável.' });
        }
        journeyResolutionByDate.set(date, { journey: resolution.journey, resolvedBy: resolution.resolvedBy });
      });

      const dates = selected.map(({ date }) => date).sort();
      const occupancyQuery = dbAdmin.collectionGroup('shifts')
        .where('userId', '==', targetUserId)
        .where('date', '>=', dates[0])
        .where('date', '<=', dates[dates.length - 1])
        .orderBy('date', 'asc')
        .limit(OCCUPANCY_QUERY_LIMIT);
      const vacationQuery = dbAdmin.collection('dp_vacations')
        .where('userId', '==', targetUserId)
        .limit(VACATION_QUERY_LIMIT);
      const occupancySnapshot = await transaction.get(occupancyQuery);
      const vacationSnapshot = await transaction.get(vacationQuery);

      if (occupancySnapshot.size === OCCUPANCY_QUERY_LIMIT || vacationSnapshot.size === VACATION_QUERY_LIMIT) {
        throw new AppError({
          code: 'DP_SHIFT_BULK_VALIDATION_LIMIT_REACHED',
          kind: 'DATA_INTEGRITY',
          safeMessage: 'Há registros demais para validar esta troca com segurança.',
        });
      }

      occupancyByDate = new Map();
      occupancySnapshot.docs.filter(isScheduleShift).forEach((document) => {
        const date = document.get('date');
        if (typeof date !== 'string') return;
        const documents = occupancyByDate.get(date) ?? [];
        documents.push(document);
        occupancyByDate.set(date, documents);
      });

      const selectedDates = new Set(dates);
      const approvedVacation = vacationSnapshot.docs.find((document) => {
        const startDate = document.get('startDate');
        const endDate = document.get('endDate');
        if (
          document.get('status') !== 'APPROVED'
          || document.get('recordType') !== 'gozo'
          || typeof startDate !== 'string'
          || typeof endDate !== 'string'
        ) return false;
        return [...selectedDates].some((date) => startDate <= date && endDate >= date);
      });
      if (approvedVacation) {
        throw new AppError({
          code: 'DP_SHIFT_BULK_VACATION_CONFLICT',
          kind: 'CONFLICT',
          safeMessage: 'A colaboradora escolhida está de férias em pelo menos uma das datas selecionadas.',
        });
      }

      const hasDayOff = [...selectedDates].some((date) => (
        (occupancyByDate.get(date) ?? []).some((document) => document.get('type') === 'day_off')
      ));
      if (hasDayOff) {
        throw new AppError({
          code: 'DP_SHIFT_BULK_DAY_OFF_CONFLICT',
          kind: 'CONFLICT',
          safeMessage: 'A colaboradora escolhida tem folga confirmada em pelo menos uma das datas selecionadas.',
        });
      }
    }

    const selectedPaths = new Set(selected.map(({ snapshot }) => snapshot.ref.path));
    const publicationFence = await preparePublicationFenceAdvance(transaction, context.workspace_id,
      selected.flatMap(({ snapshot }) => [String(snapshot.get('userId')),
        ...(input.action === 'delete' ? [] : [replacePatch?.userId ?? String(snapshot.get('userId'))])]));
    if (operationalGuardRequested()) {
      const slices = selected.flatMap(({ snapshot, date }) => [
        ...shiftOccupancySlices({ beneficiaryUid: String(snapshot.get('userId')), date,
          startTime: snapshot.get('startTime') as string, endTime: snapshot.get('endTime') as string,
          addsOccupancy: false }),
        ...(input.action === 'delete' ? [] : shiftOccupancySlices({
          beneficiaryUid: replacePatch?.userId ?? String(snapshot.get('userId')), date,
          startTime: replacePatch?.startTime ?? snapshot.get('startTime') as string,
          endTime: replacePatch?.endTime ?? snapshot.get('endTime') as string,
          addsOccupancy: true,
        })),
      ]);
      await guardOccupancyWrite(transaction, context.workspace_id, slices,
        (input.action === 'delete' ? selected.length : selected.length * 2) + 2);
    }
    publicationFence.apply();
    const now = Timestamp.now();
    selected.forEach(({ snapshot, date }) => {
      if (input.action === 'delete') {
        transaction.delete(snapshot.ref);
        return;
      }

      const update: Record<string, unknown> = { updatedAt: now };
      if (!replacePatch) return;
      const effectiveDefinitionId = replacePatch.startTime && replacePatch.endTime
        ? replacePatch.shiftDefinitionId ?? null
        : typeof snapshot.get('shiftDefinitionId') === 'string' ? String(snapshot.get('shiftDefinitionId')) : null;
      const definitionData = effectiveDefinitionId ? shiftDefinitionsById.get(effectiveDefinitionId) : null;
      const definition = definitionData && effectiveDefinitionId
        ? { id: effectiveDefinitionId, ...definitionData } as DPShiftDefinition : null;
      const resolvedJourney = journeyResolutionByDate.get(date);
      const previousRevisionId = typeof snapshot.get('referenceRevisionId') === 'string'
        ? String(snapshot.get('referenceRevisionId')) : null;
      const priorReference = previousRevisionId ? previousReferences.get(previousRevisionId) : null;
      const reference = replacePatch.userId && targetUserSnapshot?.exists && resolvedJourney
        ? buildDPShiftReference({
          collaboratorId: replacePatch.userId, user: targetUserSnapshot.data() ?? {}, journey: resolvedJourney.journey,
          resolvedBy: resolvedJourney.resolvedBy, definition,
          executionUnitId: scheduleUnitId, date,
          startTime: replacePatch.startTime ?? snapshot.get('startTime') as string,
          endTime: replacePatch.endTime ?? snapshot.get('endTime') as string,
          capturedAt: now.toDate().toISOString(),
        })
        : priorReference ? {
          ...priorReference,
          capturedAt: now.toDate().toISOString(),
          basisCapturedAt: priorReference.basisCapturedAt ?? priorReference.capturedAt,
          plannedStartTime: replacePatch.startTime ?? priorReference.plannedStartTime,
          plannedEndTime: replacePatch.endTime ?? priorReference.plannedEndTime,
          shiftDefinition: buildShiftDefinitionReference(definition),
        } : null;
      const referenceRef = dbAdmin.collection('dp_shiftReferenceHistory').doc();
      transaction.create(referenceRef, {
        workspaceId: context.workspace_id,
        scheduleId, shiftId: snapshot.id, shiftPath: snapshot.ref.path,
        userId: replacePatch.userId ?? String(snapshot.get('userId')),
        actorId: context.decoded.uid, requestId,
        event: 'revised', previousRevisionId,
        reference,
        referenceStatus: reference ? 'captured' : 'legacy_pending',
        capturedAt: now,
      });
      update.referenceRevisionId = referenceRef.id;
      if (replacePatch.userId) {
        update.userId = replacePatch.userId;
        update.userName = targetUserName;
        update.hasConflict = (occupancyByDate.get(date) ?? []).some((document) => (
          !selectedPaths.has(document.ref.path)
          && document.get('type') !== 'day_off'
          && scheduleIdFromShift(document) !== scheduleId
        ));
        const targetAssignment = targetAssignments.get(date);
        if (targetAssignment) {
          update.assignmentKind = targetAssignment.assignmentKind;
          update.countsTowardGoals = targetAssignment.countsTowardGoals;
          update.originUnitId = targetAssignment.assignmentKind === 'external_coverage'
            ? targetAssignment.originUnitId
            : FieldValue.delete();
          update.exceptionReason = targetAssignment.assignmentKind === 'external_coverage'
            ? replacePatch.exceptionReason
            : FieldValue.delete();
        }
        if (resolvedJourney) {
          update.journeyResolution = {
            journeyId: resolvedJourney.journey.id,
            lineageId: resolvedJourney.journey.lineageId,
            version: resolvedJourney.journey.version,
            name: resolvedJourney.journey.name,
            resolvedBy: resolvedJourney.resolvedBy,
            validationMode: resolvedJourney.journey.scaleValidation?.mode ?? 'consecutive_days',
            maxConsecutiveWorkDays: resolvedJourney.journey.weeklyRest?.maxConsecutiveWorkDays ?? 6,
            resolvedAt: now,
          };
        }
      }
      if (replacePatch.startTime && replacePatch.endTime) {
        update.startTime = replacePatch.startTime;
        update.endTime = replacePatch.endTime;
        update.overnight = replacementCrossesMidnight;
        update.shiftDefinitionId = replacePatch.shiftDefinitionId ?? FieldValue.delete();
      }
      transaction.update(snapshot.ref, update);
    });

    if (input.action === 'delete') {
      const currentShiftCount = Number(scheduleSnapshot.get('shiftCount'));
      transaction.update(scheduleRef, {
        shiftCount: Math.max(0, (Number.isFinite(currentShiftCount) ? currentShiftCount : selected.length) - selected.length),
        goalEligibilityVersion: FieldValue.increment(1),
        journeyValidationVersion: FieldValue.increment(1),
      });
    } else {
      transaction.update(scheduleRef, {
        goalEligibilityVersion: FieldValue.increment(1),
        journeyValidationVersion: FieldValue.increment(1),
      });
    }

    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'dp.schedules',
      action: input.action === 'delete' ? 'shifts_bulk_deleted' : 'shifts_bulk_updated',
      metadata: {
        request_id: requestId,
        schedule_id: scheduleId,
        shift_count: selected.length,
        shift_ids: input.shiftIds,
        target_user_id: input.action === 'replace' ? input.patch.userId ?? null : null,
        start_time: input.action === 'replace' ? input.patch.startTime ?? null : null,
        end_time: input.action === 'replace' ? input.patch.endTime ?? null : null,
        assignment_kind: targetAssignment?.assignmentKind ?? null,
        counts_toward_goals: targetAssignment?.countsTowardGoals ?? null,
        exception_reason: targetAssignment?.assignmentKind === 'external_coverage' ? replacePatch?.exceptionReason ?? null : null,
      },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });

    return { updated: selected.length, action: input.action };
  });
}

type BulkCreateInput = Extract<BulkWorkShiftInput, { action: 'create' }>;

type BulkCreateSkipped = {
  userId: string;
  date: string;
  reason: 'already_filled' | 'day_off' | 'vacation';
};

async function applyWorkShiftBulkCreate(params: {
  context: ServerUserContext;
  scheduleId: string;
  input: BulkCreateInput;
  requestId: string;
}) {
  const { context, scheduleId, input, requestId } = params;
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const definitionRef = dbAdmin.collection('dp_shiftDefinitions').doc(input.shiftDefinitionId);

  return dbAdmin.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    if (scheduleSnapshot.get('activeRevisionId')) throw new AppError({ code: 'DP_SHIFT_BULK_REVISION_NOT_READY', kind: 'CONFLICT', safeMessage: 'A edição em lote desta revisão oficial aguarda integração.' });
    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (!hasPublishedScheduleVersion(scheduleSnapshot.data() ?? {})) {
      throw new AppError({ code: 'DP_SHIFT_DRAFT_NOT_OPERATIONAL', kind: 'CONFLICT', safeMessage: 'A escala precisa ser publicada antes de receber turnos operacionais.' });
    }

    const scheduleUnitId = scheduleSnapshot.get('unitId');
    if (typeof scheduleUnitId !== 'string' || !scheduleUnitId) {
      throw new AppError({
        code: 'DP_SHIFT_BULK_REQUIRES_UNIT_SCHEDULE',
        kind: 'VALIDATION',
        safeMessage: 'O preenchimento em lote exige uma escala vinculada a uma unidade.',
      });
    }
    if (!canAccessUnit(context.userDoc, scheduleUnitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({
        code: 'DP_SHIFT_UNIT_FORBIDDEN',
        kind: 'AUTHORIZATION',
        safeMessage: 'Sem acesso à unidade desta escala.',
      });
    }

    const unitSnapshot = await transaction.get(dbAdmin.collection('dp_units').doc(scheduleUnitId));
    if (!unitSnapshot.exists || unitSnapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SHIFT_UNIT_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'A unidade da escala não existe ou está arquivada.' });
    }

    const scheduleMonth = Number(scheduleSnapshot.get('month'));
    const scheduleYear = Number(scheduleSnapshot.get('year'));
    const expectedPeriod = `${scheduleYear}-${String(scheduleMonth).padStart(2, '0')}`;
    if (!Number.isInteger(scheduleMonth) || !Number.isInteger(scheduleYear)) {
      throw new AppError({
        code: 'DP_SHIFT_BULK_SCHEDULE_PERIOD_INVALID',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'A competência da escala está inválida.',
      });
    }
    if (input.entries.some((entry) => !entry.date.startsWith(`${expectedPeriod}-`))) {
      throw new AppError({
        code: 'DP_SHIFT_OUTSIDE_SCHEDULE_PERIOD',
        kind: 'VALIDATION',
        safeMessage: 'Uma das datas não pertence à competência desta escala.',
      });
    }

    const definitionSnapshot = await transaction.get(definitionRef);
    if (!definitionSnapshot.exists) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'O turno escolhido não existe mais.' });
    }
    if (definitionSnapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_ARCHIVED', kind: 'CONFLICT', safeMessage: 'O turno escolhido está arquivado. Selecione um turno ativo.' });
    }
    if (definitionSnapshot.get('startTime') !== input.startTime || definitionSnapshot.get('endTime') !== input.endTime) {
      throw new AppError({
        code: 'DP_SHIFT_DEFINITION_TIME_MISMATCH',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'Os horários não correspondem ao turno escolhido. Atualize a tela e tente novamente.',
      });
    }
    const crossesMidnight = input.endTime < input.startTime;
    if (crossesMidnight && definitionSnapshot.get('overnight') !== true) {
      throw new AppError({
        code: 'DP_SHIFT_OVERNIGHT_DEFINITION_REQUIRED',
        kind: 'VALIDATION',
        safeMessage: 'Para atravessar a meia-noite, selecione um turno noturno.',
      });
    }

    const userIds = [...new Set(input.entries.map((entry) => entry.userId))];
    const userSnapshots = await transaction.getAll(...userIds.map((userId) => dbAdmin.collection('users').doc(userId)));
    const usersById = new Map(userSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    userSnapshots.forEach((snapshot) => {
      if (!snapshot.exists || snapshot.get('isActive') === false) {
        throw new AppError({ code: 'DP_SHIFT_USER_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Uma colaboradora escolhida não existe ou está inativa.' });
      }
    });

    const primaryUnitIds = [...new Set(userSnapshots.map((snapshot) => {
      const userUnitId = snapshot.get('unitId');
      return typeof userUnitId === 'string' && userUnitId ? userUnitId : scheduleUnitId;
    }))];
    const primaryUnitSnapshots = await transaction.getAll(...primaryUnitIds.map((unitId) => dbAdmin.collection('dp_units').doc(unitId)));
    const primaryUnitsById = new Map(primaryUnitSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    primaryUnitSnapshots.forEach((snapshot) => {
      if (!snapshot.exists || snapshot.get('isArchived') === true) {
        throw new AppError({ code: 'DP_SHIFT_PRIMARY_UNIT_UNAVAILABLE', kind: 'DATA_INTEGRITY', safeMessage: 'A unidade principal de uma colaboradora não existe ou está arquivada.' });
      }
    });
    const groupIds = [...new Set(primaryUnitSnapshots
      .map((snapshot) => snapshot.get('groupId'))
      .filter((value): value is string => typeof value === 'string' && value.length > 0))];
    const groupSnapshots = groupIds.length > 0
      ? await transaction.getAll(...groupIds.map((groupId) => dbAdmin.collection('dp_unitGroups').doc(groupId)))
      : [];
    const groupsById = new Map(groupSnapshots.map((snapshot) => [snapshot.id, snapshot]));

    const journeysSnapshot = await transaction.get(
      dbAdmin.collection('dp_journeys')
        .where('status', 'in', ['published', 'archived'])
        .limit(JOURNEY_QUERY_LIMIT + 1),
    );
    if (journeysSnapshot.size > JOURNEY_QUERY_LIMIT) {
      throw new AppError({ code: 'DP_SHIFT_JOURNEY_CATALOG_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'Há jornadas demais para resolver esta atribuição com segurança.' });
    }
    const journeys = journeysSnapshot.docs.map((document) => ({ id: document.id, ...document.data() } as DPJourney));

    const occupancyByUser = new Map<string, QueryDocumentSnapshot[]>();
    const vacationsByUser = new Map<string, QueryDocumentSnapshot[]>();
    for (const userId of userIds) {
      const dates = input.entries.filter((entry) => entry.userId === userId).map((entry) => entry.date).sort();
      const occupancySnapshot = await transaction.get(
        dbAdmin.collectionGroup('shifts')
          .where('userId', '==', userId)
          .where('date', '>=', dates[0])
          .where('date', '<=', dates[dates.length - 1])
          .limit(OCCUPANCY_QUERY_LIMIT),
      );
      const vacationSnapshot = await transaction.get(
        dbAdmin.collection('dp_vacations').where('userId', '==', userId).limit(VACATION_QUERY_LIMIT),
      );
      if (occupancySnapshot.size === OCCUPANCY_QUERY_LIMIT || vacationSnapshot.size === VACATION_QUERY_LIMIT) {
        throw new AppError({
          code: 'DP_SHIFT_BULK_VALIDATION_LIMIT_REACHED',
          kind: 'DATA_INTEGRITY',
          safeMessage: 'Há registros demais para validar o preenchimento em lote com segurança.',
        });
      }
      occupancyByUser.set(userId, occupancySnapshot.docs.filter(isScheduleShift));
      vacationsByUser.set(userId, vacationSnapshot.docs);
    }

    const skipped: BulkCreateSkipped[] = [];
    const candidates = input.entries.filter((entry) => {
      const occupancy = occupancyByUser.get(entry.userId) ?? [];
      const sameDate = occupancy.filter((document) => document.get('date') === entry.date);
      const hasDayOff = sameDate.some((document) => document.get('type') === 'day_off');
      const hasCurrentScheduleOccupancy = sameDate.some((document) => scheduleIdFromShift(document) === scheduleId);
      if (hasDayOff || hasCurrentScheduleOccupancy) {
        skipped.push({ userId: entry.userId, date: entry.date, reason: hasDayOff ? 'day_off' : 'already_filled' });
        return false;
      }
      const approvedVacation = (vacationsByUser.get(entry.userId) ?? []).some((document) => (
        document.get('status') === 'APPROVED'
        && document.get('recordType') === 'gozo'
        && typeof document.get('startDate') === 'string'
        && typeof document.get('endDate') === 'string'
        && document.get('startDate') <= entry.date
        && document.get('endDate') >= entry.date
      ));
      if (approvedVacation) {
        skipped.push({ userId: entry.userId, date: entry.date, reason: 'vacation' });
        return false;
      }
      return true;
    });

    const now = Timestamp.now();
    const definition = { id: definitionSnapshot.id, ...definitionSnapshot.data() } as DPShiftDefinition;
    const plannedWrites: Array<{
      shiftRef: DocumentReference;
      referenceRef: DocumentReference;
      userId: string;
      date: string;
      payload: Record<string, unknown>;
      reference: DPShiftReference;
      hasConflict: boolean;
    }> = [];

    for (const entry of candidates) {
      const userSnapshot = usersById.get(entry.userId);
      if (!userSnapshot) throw new AppError({ code: 'DP_SHIFT_USER_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Uma colaboradora escolhida não existe ou está inativa.' });
      const primaryUnitId = typeof userSnapshot.get('unitId') === 'string' && userSnapshot.get('unitId')
        ? String(userSnapshot.get('unitId')) : scheduleUnitId;
      const primaryUnitSnapshot = primaryUnitsById.get(primaryUnitId);
      if (!primaryUnitSnapshot) throw new AppError({ code: 'DP_SHIFT_PRIMARY_UNIT_UNAVAILABLE', kind: 'DATA_INTEGRITY', safeMessage: 'A unidade principal da colaboradora não existe ou está arquivada.' });
      const unitGroupId = typeof primaryUnitSnapshot.get('groupId') === 'string' ? String(primaryUnitSnapshot.get('groupId')) : undefined;
      const unitGroupSnapshot = unitGroupId ? groupsById.get(unitGroupId) : undefined;
      const unitOrganizationId = typeof primaryUnitSnapshot.get('organizationId') === 'string'
        ? String(primaryUnitSnapshot.get('organizationId'))
        : unitGroupSnapshot?.exists && typeof unitGroupSnapshot.get('organizationId') === 'string'
          ? String(unitGroupSnapshot.get('organizationId')) : undefined;
      const journeyResolution = resolveDPJourney({
        journeys,
        target: {
          collaboratorId: entry.userId,
          ...(typeof userSnapshot.get('jobRoleId') === 'string' ? { jobRoleId: String(userSnapshot.get('jobRoleId')) } : {}),
          jobFunctionIds: Array.isArray(userSnapshot.get('jobFunctionIds')) ? userSnapshot.get('jobFunctionIds') : [],
          unitId: primaryUnitId,
          ...(unitGroupId ? { unitGroupId } : {}),
          ...(unitOrganizationId ? { unitOrganizationId } : {}),
        },
        date: entry.date,
      });
      if (journeyResolution.status === 'none') {
        throw new AppError({ code: 'DP_SHIFT_JOURNEY_NOT_FOUND', kind: 'EXPECTED_BUSINESS', safeMessage: 'Nenhuma jornada vigente se aplica a uma colaboradora escolhida.' });
      }
      if (journeyResolution.status === 'ambiguous') {
        throw new AppError({ code: 'DP_SHIFT_JOURNEY_AMBIGUOUS', kind: 'CONFLICT', safeMessage: 'Mais de uma jornada com a mesma prioridade se aplica a uma colaboradora escolhida.' });
      }
      if (!isShiftDefinitionCompatibleWithJourney({
        journeyId: journeyResolution.journey.id,
        journeyAllowedShiftDefinitionIds: journeyResolution.journey.allowedShiftDefinitionIds,
        shiftDefinitionId: input.shiftDefinitionId,
        shiftJourneyIds: definitionSnapshot.get('journeyIds'),
      })) {
        throw new AppError({ code: 'DP_SHIFT_NOT_ALLOWED_BY_JOURNEY', kind: 'VALIDATION', safeMessage: 'O turno escolhido não é permitido pela jornada de uma das colaboradoras.' });
      }

      let assignment: DPShiftAssignment;
      try {
        assignment = resolveDPShiftAssignment({
          executionUnitId: scheduleUnitId,
          date: entry.date,
          executionUnitExternalId: typeof unitSnapshot.get('externalId') === 'string' ? unitSnapshot.get('externalId') : undefined,
          user: userSnapshot.data() ?? {},
        });
      } catch {
        throw new AppError({ code: 'DP_SHIFT_EXTERNAL_ORIGIN_REQUIRED', kind: 'DATA_INTEGRITY', safeMessage: 'A unidade de origem de uma colaboradora precisa estar definida antes da cobertura.' });
      }
      if (assignment.assignmentKind === 'external_coverage') {
        throw new AppError({ code: 'DP_SHIFT_EXTERNAL_REASON_REQUIRED', kind: 'VALIDATION', safeMessage: 'Coberturas externas devem ser lançadas individualmente, com o motivo registrado.' });
      }
      const occupancy = occupancyByUser.get(entry.userId) ?? [];
      const hasCrossConflict = occupancy.some((document) => (
        document.get('date') === entry.date
        && document.get('type') !== 'day_off'
        && scheduleIdFromShift(document) !== scheduleId
      ));
      const shiftRef = scheduleRef.collection('shifts').doc();
      const referenceRef = dbAdmin.collection('dp_shiftReferenceHistory').doc();
      const reference = buildDPShiftReference({
        collaboratorId: entry.userId,
        user: userSnapshot.data() ?? {},
        journey: journeyResolution.journey,
        resolvedBy: journeyResolution.resolvedBy,
        definition,
        executionUnitId: scheduleUnitId,
        date: entry.date,
        startTime: input.startTime,
        endTime: input.endTime,
        capturedAt: now.toDate().toISOString(),
      });
      plannedWrites.push({
        shiftRef,
        referenceRef,
        userId: entry.userId,
        date: entry.date,
        hasConflict: hasCrossConflict,
        reference,
        payload: {
          scheduleId,
          unitId: scheduleUnitId,
          userId: entry.userId,
          userName: userSnapshot.get('username') ?? null,
          date: entry.date,
          startTime: input.startTime,
          endTime: input.endTime,
          overnight: crossesMidnight,
          type: 'work',
          hasConflict: hasCrossConflict,
          assignmentKind: assignment.assignmentKind,
          countsTowardGoals: assignment.countsTowardGoals,
          journeyResolution: {
            journeyId: journeyResolution.journey.id,
            lineageId: journeyResolution.journey.lineageId,
            version: journeyResolution.journey.version,
            name: journeyResolution.journey.name,
            resolvedBy: journeyResolution.resolvedBy,
            validationMode: journeyResolution.journey.scaleValidation?.mode ?? 'consecutive_days',
            maxConsecutiveWorkDays: journeyResolution.journey.weeklyRest?.maxConsecutiveWorkDays ?? 6,
            resolvedAt: now,
          },
          referenceRevisionId: referenceRef.id,
          updatedAt: now,
          createdAt: now,
          shiftDefinitionId: input.shiftDefinitionId,
        },
      });
    }

    const publicationFence = plannedWrites.length > 0
      ? await preparePublicationFenceAdvance(transaction, context.workspace_id, plannedWrites.map(({ userId }) => userId)) : null;
    if (plannedWrites.length > 0 && operationalGuardRequested()) {
      const slices = plannedWrites.flatMap(({ userId, date }) => shiftOccupancySlices({
        beneficiaryUid: userId,
        date,
        startTime: input.startTime,
        endTime: input.endTime,
        addsOccupancy: true,
      }));
      await guardOccupancyWrite(transaction, context.workspace_id, slices, plannedWrites.length * 2 + 2);
    }
    publicationFence?.apply();

    plannedWrites.forEach(({ shiftRef, referenceRef, payload, userId, reference }) => {
      transaction.create(shiftRef, payload);
      transaction.create(referenceRef, {
        workspaceId: context.workspace_id,
        scheduleId,
        shiftId: shiftRef.id,
        shiftPath: shiftRef.path,
        userId,
        actorId: context.decoded.uid,
        requestId,
        event: 'created',
        previousRevisionId: null,
        reference,
        capturedAt: now,
      });
    });
    if (plannedWrites.length > 0) {
      transaction.update(scheduleRef, {
        shiftCount: FieldValue.increment(plannedWrites.length),
        goalEligibilityVersion: FieldValue.increment(1),
        journeyValidationVersion: FieldValue.increment(1),
      });
    }
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'dp.schedules',
      action: 'shifts_bulk_created',
      metadata: {
        request_id: requestId,
        schedule_id: scheduleId,
        shift_count: plannedWrites.length,
        skipped_count: skipped.length,
        selected_count: input.entries.length,
        shift_definition_id: input.shiftDefinitionId,
        dates: [...new Set(input.entries.map((entry) => entry.date))],
        user_ids: userIds,
      },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });

    return { created: plannedWrites.length, skipped, action: 'create' as const };
  });
}
