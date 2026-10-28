import 'server-only';

import { FieldValue, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { resolveDPShiftAssignment } from '@/lib/dp-external-coverage';
import { resolveDPJourney } from '@/lib/dp-journey-resolution';
import { buildDPShiftReference } from '@/lib/dp-shift-reference';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import type { DPJourney, DPShiftDefinition } from '@/types';
import { guardOccupancyWrite, operationalGuardRequested, shiftOccupancySlices } from '@/features/dp/absences/operational/occupancy-guard.server';

import { assertPersonAgendaUnchanged, personAgendaClockRef, personAgendaVersion } from './agenda-clock.server';
import type { SaveWorkShiftInput } from './schemas';

const OCCUPANCY_QUERY_LIMIT = 21;
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
      code: 'DP_SHIFT_EDIT_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para alterar turnos.',
    });
  }
}

export async function saveWorkShift(params: {
  context: ServerUserContext;
  scheduleId: string;
  shiftId: string;
  input: SaveWorkShiftInput;
  mode: 'create' | 'update';
  requestId: string;
  /** Versão da agenda da pessoa lida antes de uma conferência feita fora desta transação (cobertura de turno). */
  expectedAgendaVersion?: number;
}) {
  const { context, scheduleId, shiftId, input, mode, requestId, expectedAgendaVersion } = params;
  assertEditPermission(context);

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const shiftRef = scheduleRef.collection('shifts').doc(shiftId);
  const userRef = dbAdmin.collection('users').doc(input.userId);
  const unitRef = dbAdmin.collection('dp_units').doc(input.unitId);
  const shiftDefinitionRef = input.shiftDefinitionId
    ? dbAdmin.collection('dp_shiftDefinitions').doc(input.shiftDefinitionId)
    : null;
  const occupancyQuery = dbAdmin.collectionGroup('shifts')
    .where('userId', '==', input.userId)
    .where('date', '==', input.date)
    .limit(OCCUPANCY_QUERY_LIMIT);
  const agendaClockRef = personAgendaClockRef(context.workspace_id, input.userId);

  return dbAdmin.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    const shiftSnapshot = await transaction.get(shiftRef);
    const userSnapshot = await transaction.get(userRef);
    const unitSnapshot = await transaction.get(unitRef);
    const shiftDefinitionSnapshot = shiftDefinitionRef ? await transaction.get(shiftDefinitionRef) : null;
    const occupancySnapshot = await transaction.get(occupancyQuery);
    const agendaVersion = personAgendaVersion(await transaction.get(agendaClockRef));
    assertPersonAgendaUnchanged(agendaVersion, expectedAgendaVersion);
    // Turno que troca de pessoa também muda a agenda de quem saiu.
    const previousUserId = shiftSnapshot.exists ? shiftSnapshot.get('userId') : undefined;
    const previousAgendaClockRef = typeof previousUserId === 'string' && previousUserId && previousUserId !== input.userId
      ? personAgendaClockRef(context.workspace_id, previousUserId) : null;
    const previousAgendaVersion = previousAgendaClockRef ? personAgendaVersion(await transaction.get(previousAgendaClockRef)) : null;

    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (scheduleSnapshot.get('locked') === true) {
      throw new AppError({ code: 'DP_SHIFT_SCHEDULE_LOCKED', kind: 'CONFLICT', safeMessage: 'A escala está trancada.' });
    }
    if (!userSnapshot.exists || userSnapshot.get('isActive') === false) {
      throw new AppError({ code: 'DP_SHIFT_USER_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Colaboradora não encontrada ou inativa.' });
    }
    if (!unitSnapshot.exists || unitSnapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SHIFT_UNIT_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Unidade não encontrada ou arquivada.' });
    }
    if (!canAccessUnit(context.userDoc, input.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SHIFT_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade do turno.' });
    }

    const primaryUnitId = typeof userSnapshot.get('unitId') === 'string' && userSnapshot.get('unitId')
      ? String(userSnapshot.get('unitId'))
      : input.unitId;
    const primaryUnitSnapshot = primaryUnitId === input.unitId
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
    const journeySnapshot = await transaction.get(
      dbAdmin.collection('dp_journeys')
        .where('status', 'in', ['published', 'archived'])
        .limit(JOURNEY_QUERY_LIMIT + 1),
    );
    if (journeySnapshot.size > JOURNEY_QUERY_LIMIT) {
      throw new AppError({ code: 'DP_SHIFT_JOURNEY_CATALOG_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'Há jornadas demais para resolver esta atribuição com segurança.' });
    }
    const journeyResolution = resolveDPJourney({
      journeys: journeySnapshot.docs.map((document) => ({ id: document.id, ...document.data() } as DPJourney)),
      target: {
        collaboratorId: input.userId,
        ...(typeof userSnapshot.get('jobRoleId') === 'string' ? { jobRoleId: String(userSnapshot.get('jobRoleId')) } : {}),
        jobFunctionIds: Array.isArray(userSnapshot.get('jobFunctionIds')) ? userSnapshot.get('jobFunctionIds') : [],
        unitId: primaryUnitId,
        ...(unitGroupId ? { unitGroupId } : {}),
        ...(unitOrganizationId ? { unitOrganizationId } : {}),
      },
      date: input.date,
    });
    if (journeyResolution.status === 'none') {
      throw new AppError({ code: 'DP_SHIFT_JOURNEY_NOT_FOUND', kind: 'EXPECTED_BUSINESS', safeMessage: 'Nenhuma jornada vigente se aplica a esta colaboradora. Configure a abrangência antes de incluí-la na escala.' });
    }
    if (journeyResolution.status === 'ambiguous') {
      throw new AppError({ code: 'DP_SHIFT_JOURNEY_AMBIGUOUS', kind: 'CONFLICT', safeMessage: 'Mais de uma jornada com a mesma prioridade se aplica a esta colaboradora. Corrija a abrangência antes de continuar.' });
    }
    if (!isShiftDefinitionCompatibleWithJourney({
      journeyId: journeyResolution.journey.id,
      journeyAllowedShiftDefinitionIds: journeyResolution.journey.allowedShiftDefinitionIds,
      shiftDefinitionId: input.shiftDefinitionId,
      shiftJourneyIds: shiftDefinitionSnapshot?.get('journeyIds'),
    })) {
      throw new AppError({ code: 'DP_SHIFT_NOT_ALLOWED_BY_JOURNEY', kind: 'VALIDATION', safeMessage: 'O turno escolhido não está permitido na jornada aplicável.' });
    }

    const scheduleMonth = Number(scheduleSnapshot.get('month'));
    const scheduleYear = Number(scheduleSnapshot.get('year'));
    const expectedPeriod = `${scheduleYear}-${String(scheduleMonth).padStart(2, '0')}`;
    if (!Number.isInteger(scheduleMonth) || !Number.isInteger(scheduleYear) || !input.date.startsWith(`${expectedPeriod}-`)) {
      throw new AppError({ code: 'DP_SHIFT_OUTSIDE_SCHEDULE_PERIOD', kind: 'VALIDATION', safeMessage: 'A data não pertence à competência desta escala.' });
    }
    const scheduleUnitId = scheduleSnapshot.get('unitId');
    if (typeof scheduleUnitId === 'string' && scheduleUnitId && scheduleUnitId !== input.unitId) {
      throw new AppError({ code: 'DP_SHIFT_SCHEDULE_UNIT_MISMATCH', kind: 'VALIDATION', safeMessage: 'A unidade não corresponde à escala selecionada.' });
    }
    if (mode === 'create' && shiftSnapshot.exists) {
      throw new AppError({ code: 'DP_SHIFT_ID_COLLISION', kind: 'CONFLICT', safeMessage: 'O turno já existe. Atualize a escala e tente novamente.' });
    }
    if (mode === 'update' && !shiftSnapshot.exists) {
      throw new AppError({ code: 'DP_SHIFT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Turno não encontrado.' });
    }
    if (shiftSnapshot.exists && shiftSnapshot.get('type') === 'day_off') {
      throw new AppError({ code: 'DP_SHIFT_DAY_OFF_IMMUTABLE', kind: 'CONFLICT', safeMessage: 'Uma folga não pode ser convertida diretamente em turno.' });
    }
    const crossesMidnight = input.endTime < input.startTime;
    if (input.shiftDefinitionId && !shiftDefinitionSnapshot?.exists) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'O turno configurado não existe mais.' });
    }
    const preservesArchivedDefinition = mode === 'update'
      && shiftSnapshot.exists
      && shiftSnapshot.get('shiftDefinitionId') === input.shiftDefinitionId;
    if (shiftDefinitionSnapshot?.get('isArchived') === true && !preservesArchivedDefinition) {
      throw new AppError({ code: 'DP_SHIFT_DEFINITION_ARCHIVED', kind: 'CONFLICT', safeMessage: 'O turno escolhido está arquivado. Selecione um turno ativo.' });
    }
    if (crossesMidnight && (
      !shiftDefinitionSnapshot?.exists
      || shiftDefinitionSnapshot.get('overnight') !== true
      || shiftDefinitionSnapshot.get('startTime') !== input.startTime
      || shiftDefinitionSnapshot.get('endTime') !== input.endTime
    )) {
      throw new AppError({
        code: 'DP_SHIFT_OVERNIGHT_DEFINITION_REQUIRED',
        kind: 'VALIDATION',
        safeMessage: 'Para atravessar a meia-noite, selecione um turno noturno com estes mesmos horários.',
      });
    }
    if (occupancySnapshot.size === OCCUPANCY_QUERY_LIMIT) {
      throw new AppError({
        code: 'DP_SHIFT_VALIDATION_LIMIT_REACHED',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'Há registros demais para validar o turno com segurança.',
      });
    }

    const relevantOccupancies = occupancySnapshot.docs.filter(isScheduleShift);
    const dayOff = relevantOccupancies.find((document) => document.get('type') === 'day_off');
    if (dayOff) {
      throw new AppError({
        code: 'DP_SHIFT_DAY_OFF_CONFLICT',
        kind: 'CONFLICT',
        safeMessage: 'Existe uma folga confirmada nesta data. Remova a folga antes de atribuir o turno.',
      });
    }

    const hasCrossUnitConflict = relevantOccupancies.some((document) => (
      document.id !== shiftId
      && document.get('type') !== 'day_off'
      && scheduleIdFromShift(document) !== scheduleId
    ));
    let assignment;
    try {
      assignment = resolveDPShiftAssignment({
        executionUnitId: input.unitId,
        executionUnitExternalId: typeof unitSnapshot.get('externalId') === 'string' ? unitSnapshot.get('externalId') : undefined,
        user: userSnapshot.data() ?? {},
      });
    } catch {
      throw new AppError({
        code: 'DP_SHIFT_EXTERNAL_ORIGIN_REQUIRED',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'A unidade de origem da colaboradora precisa estar definida antes da cobertura.',
      });
    }
    const existingReason = shiftSnapshot.exists && typeof shiftSnapshot.get('exceptionReason') === 'string'
      ? shiftSnapshot.get('exceptionReason') as string
      : undefined;
    const exceptionReason = input.exceptionReason ?? existingReason;
    if (assignment.assignmentKind === 'external_coverage') {
      if (!context.isDefaultAdmin && context.permissions.dp.schedules.assignExternal !== true) {
        throw new AppError({ code: 'DP_SHIFT_EXTERNAL_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para trazer colaboradoras de outra unidade.' });
      }
      if (!exceptionReason) {
        throw new AppError({ code: 'DP_SHIFT_EXTERNAL_REASON_REQUIRED', kind: 'VALIDATION', safeMessage: 'Informe o motivo da cobertura em outra unidade.' });
      }
    }
    const now = Timestamp.now();
    const journey = journeyResolution.journey;
    const referenceRef = dbAdmin.collection('dp_shiftReferenceHistory').doc();
    const reference = buildDPShiftReference({
      collaboratorId: input.userId, user: userSnapshot.data() ?? {}, journey, resolvedBy: journeyResolution.resolvedBy,
      definition: shiftDefinitionSnapshot?.exists
        ? { id: shiftDefinitionSnapshot.id, ...shiftDefinitionSnapshot.data() } as DPShiftDefinition
        : null,
      executionUnitId: input.unitId, date: input.date,
      startTime: input.startTime, endTime: input.endTime, capturedAt: now.toDate().toISOString(),
    });
    const basePayload = {
      scheduleId,
      unitId: input.unitId,
      userId: input.userId,
      userName: input.userName ?? userSnapshot.get('username') ?? null,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      overnight: crossesMidnight,
      type: 'work',
      hasConflict: hasCrossUnitConflict,
      assignmentKind: assignment.assignmentKind,
      countsTowardGoals: assignment.countsTowardGoals,
      journeyResolution: {
        journeyId: journey.id,
        lineageId: journey.lineageId,
        version: journey.version,
        name: journey.name,
        resolvedBy: journeyResolution.resolvedBy,
        validationMode: journey.scaleValidation?.mode ?? 'consecutive_days',
        maxConsecutiveWorkDays: journey.weeklyRest?.maxConsecutiveWorkDays ?? 6,
        resolvedAt: now,
      },
      referenceRevisionId: referenceRef.id,
      updatedAt: now,
    };

    const assignmentPayload = assignment.assignmentKind === 'external_coverage'
      ? { originUnitId: assignment.originUnitId, exceptionReason }
      : mode === 'update'
        ? { originUnitId: FieldValue.delete(), exceptionReason: FieldValue.delete() }
        : {};

    if (operationalGuardRequested()) {
      const oldSlices = shiftSnapshot.exists ? shiftOccupancySlices({
        beneficiaryUid: String(shiftSnapshot.get('userId')), date: String(shiftSnapshot.get('date')),
        startTime: shiftSnapshot.get('startTime') as string, endTime: shiftSnapshot.get('endTime') as string,
        addsOccupancy: false,
      }) : [];
      await guardOccupancyWrite(transaction, context.workspace_id, [
        ...oldSlices,
        ...shiftOccupancySlices({ beneficiaryUid: input.userId, date: input.date,
          startTime: input.startTime, endTime: input.endTime, addsOccupancy: true }),
      ], 4);
    }

    if (mode === 'create') {
      transaction.create(shiftRef, {
        ...basePayload,
        ...assignmentPayload,
        ...(input.shiftDefinitionId ? { shiftDefinitionId: input.shiftDefinitionId } : {}),
        createdAt: now,
      });
      transaction.update(scheduleRef, {
        shiftCount: FieldValue.increment(1),
        goalEligibilityVersion: FieldValue.increment(1),
        journeyValidationVersion: FieldValue.increment(1),
      });
    } else {
      transaction.update(shiftRef, {
        ...basePayload,
        ...assignmentPayload,
        shiftDefinitionId: input.shiftDefinitionId ?? FieldValue.delete(),
      });
      transaction.update(scheduleRef, {
        goalEligibilityVersion: FieldValue.increment(1),
        journeyValidationVersion: FieldValue.increment(1),
      });
    }
    transaction.set(agendaClockRef, { workspaceId: context.workspace_id, userId: input.userId,
      version: agendaVersion + 1, updatedAt: now });
    if (previousAgendaClockRef && previousAgendaVersion !== null) {
      transaction.set(previousAgendaClockRef, { workspaceId: context.workspace_id, userId: previousUserId,
        version: previousAgendaVersion + 1, updatedAt: now });
    }
    transaction.create(referenceRef, {
      workspaceId: context.workspace_id,
      scheduleId, shiftId, shiftPath: shiftRef.path, userId: input.userId,
      actorId: context.decoded.uid, requestId,
      event: mode === 'create' ? 'created' : 'revised',
      previousRevisionId: shiftSnapshot.get('referenceRevisionId') ?? null,
      reference,
      capturedAt: now,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'dp.schedules',
      action: mode === 'create' ? 'shift_created' : 'shift_updated',
      metadata: {
        request_id: requestId,
        schedule_id: scheduleId,
        shift_id: shiftId,
        user_id: input.userId,
        unit_id: input.unitId,
        date: input.date,
        has_cross_unit_conflict: hasCrossUnitConflict,
        assignment_kind: assignment.assignmentKind,
        origin_unit_id: assignment.assignmentKind === 'external_coverage' ? assignment.originUnitId : null,
        counts_toward_goals: assignment.countsTowardGoals,
        journey_id: journey.id,
        journey_version: journey.version,
        journey_resolved_by: journeyResolution.resolvedBy,
        exception_reason: assignment.assignmentKind === 'external_coverage' ? exceptionReason : null,
      },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });

    return { shiftId, hasConflict: hasCrossUnitConflict };
  });
}
