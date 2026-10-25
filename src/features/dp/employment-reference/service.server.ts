import 'server-only';

import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit, canAccessUserByUnit, type UnitAccessUser } from '@/lib/unit-access';

import { civilDate, publishEmploymentReferenceSchema, type EmploymentPeriodInput } from './schemas';
import { resolveEmploymentReference, validEmploymentHistory, type EmploymentHistory, type EmploymentPeriod } from './resolve';

const HEADS = 'dp_employmentReferenceHeads';
const HISTORIES = 'dp_employmentReferenceHistories';
const REQUESTS = 'dp_employmentReferenceRequests';
const MAX_HISTORY_BYTES = 450_000;

function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
function fail(code: string, safeMessage: string, kind: 'AUTHORIZATION' | 'VALIDATION' | 'CONFLICT' | 'DATA_INTEGRITY' | 'NOT_FOUND') {
  return new AppError({ code, kind, safeMessage });
}
function headId(workspaceId: string, userId: string) { return digest(JSON.stringify([workspaceId, userId])); }
function historyId(head: string, revision: number) { return `${head}_r${revision}`; }
function requestKey(head: string, requestId: string) { return digest(JSON.stringify([head, requestId])); }
function allPeriodUnitIds(periods: Array<Pick<EmploymentPeriodInput, 'employerUnitId' | 'unitId' | 'unitIds'>>) {
  return [...new Set(periods.flatMap((period) => [period.employerUnitId, period.unitId, ...period.unitIds]))];
}
function assertPersonScope(context: ServerUserContext, user: Record<string, unknown>) {
  if (!canAccessUserByUnit(context.userDoc, user as UnitAccessUser, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('DP_EMPLOYMENT_PERSON_SCOPE', 'Pessoa fora do escopo de unidades.', 'AUTHORIZATION');
  }
}
function assertUnitsScope(context: ServerUserContext, unitIds: string[]) {
  if (!unitIds.every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }))) {
    throw fail('DP_EMPLOYMENT_UNIT_SCOPE', 'Unidade fora do escopo.', 'AUTHORIZATION');
  }
}
function assertWrite(context: ServerUserContext) {
  if (context.permissions.dp.collaborators.ownProfileOnly === true && !context.isDefaultAdmin) {
    throw fail('DP_EMPLOYMENT_WRITE_FORBIDDEN', 'Sem permissão para publicar histórico de vínculo.', 'AUTHORIZATION');
  }
  if (!context.isDefaultAdmin && context.permissions.settings.manageUsers !== true
    && context.permissions.dp.collaborators.edit !== true) {
    throw fail('DP_EMPLOYMENT_WRITE_FORBIDDEN', 'Sem permissão para publicar histórico de vínculo.', 'AUTHORIZATION');
  }
}
function assertRead(context: ServerUserContext, userId: string) {
  if (!context.isDefaultAdmin && context.permissions.dp.collaborators.view !== true
    && context.permissions.settings.manageUsers !== true) {
    throw fail('DP_EMPLOYMENT_READ_FORBIDDEN', 'Sem permissão para consultar histórico de vínculo.', 'AUTHORIZATION');
  }
  if (!context.isDefaultAdmin && context.permissions.dp.collaborators.ownProfileOnly === true
    && context.decoded.uid !== userId) {
    throw fail('DP_EMPLOYMENT_READ_FORBIDDEN', 'Consulta limitada ao próprio perfil.', 'AUTHORIZATION');
  }
}

async function readRoleCatalog(periods: EmploymentPeriodInput[]) {
  const roleIds = [...new Set(periods.flatMap((period) => period.jobRoleId ? [period.jobRoleId] : []))];
  const functionIds = [...new Set(periods.flatMap((period) => period.jobFunctionIds))];
  if (roleIds.length + functionIds.length > 100) {
    throw fail('DP_EMPLOYMENT_ROLE_LIMIT', 'Há cargos e funções demais para validar.', 'VALIDATION');
  }
  const [roles, functions] = await Promise.all([
    Promise.all(roleIds.map((id) => hrDbAdmin.collection('jobRoles').doc(id).get())),
    Promise.all(functionIds.map((id) => hrDbAdmin.collection('jobFunctions').doc(id).get())),
  ]);
  if (roles.some((doc) => !doc.exists) || functions.some((doc) => !doc.exists)) {
    throw fail('DP_EMPLOYMENT_ROLE_INVALID', 'Cargo ou função não encontrado no catálogo RH.', 'VALIDATION');
  }
  const roleNames = new Map(roles.map((doc) => [doc.id, String(doc.get('name') ?? doc.get('publicTitle') ?? doc.id)]));
  const functionNames = new Map(functions.map((doc) => [doc.id, String(doc.get('name') ?? doc.get('publicTitle') ?? doc.id)]));
  const compatibleRoles = new Map(functions.map((doc) => [doc.id,
    Array.isArray(doc.get('compatibleRoleIds')) ? doc.get('compatibleRoleIds') as string[] : []]));
  for (const period of periods) {
    for (const functionId of period.jobFunctionIds) {
      const allowed = compatibleRoles.get(functionId) ?? [];
      if (period.jobRoleId && allowed.length && !allowed.includes(period.jobRoleId)) {
        throw fail('DP_EMPLOYMENT_FUNCTION_ROLE_MISMATCH', 'Função incompatível com o cargo informado.', 'VALIDATION');
      }
    }
  }
  return { roleNames, functionNames };
}

export async function publishEmploymentReference(context: ServerUserContext, rawInput: unknown) {
  assertWrite(context);
  const parsed = publishEmploymentReferenceSchema.safeParse(rawInput);
  if (!parsed.success) throw fail('DP_EMPLOYMENT_INPUT_INVALID', parsed.error.issues[0]?.message ?? 'Histórico inválido.', 'VALIDATION');
  const input = parsed.data;
  const workspaceId = context.workspace_id;
  const head = headId(workspaceId, input.userId);
  const contentHash = digest(JSON.stringify(input.periods));
  const unitIds = allPeriodUnitIds(input.periods);
  if (unitIds.length > 100) throw fail('DP_EMPLOYMENT_UNIT_LIMIT', 'Há unidades demais para validar.', 'VALIDATION');
  assertUnitsScope(context, unitIds);
  const headRef = dbAdmin.collection(HEADS).doc(head);
  const requestRef = dbAdmin.collection(REQUESTS).doc(requestKey(head, input.requestId));
  const userRef = dbAdmin.collection('users').doc(input.userId);
  const userBefore = await userRef.get();
  if (!userBefore.exists) throw fail('DP_EMPLOYMENT_PERSON_MISSING', 'Pessoa não encontrada.', 'NOT_FOUND');
  assertPersonScope(context, userBefore.data() ?? {});
  const catalog = (await requestRef.get()).exists ? null : await readRoleCatalog(input.periods);

  return dbAdmin.runTransaction(async (transaction) => {
    const [user, currentHead, previousRequest, ...units] = await transaction.getAll(
      userRef, headRef, requestRef, ...unitIds.map((id) => dbAdmin.collection('dp_units').doc(id)));
    if (!user.exists) throw fail('DP_EMPLOYMENT_PERSON_MISSING', 'Pessoa não encontrada.', 'NOT_FOUND');
    assertPersonScope(context, user.data() ?? {});
    if (user.get('absenceDocumentDeletionFence')) {
      throw fail('DP_EMPLOYMENT_FENCE_ACTIVE', 'Vínculo temporariamente bloqueado por exclusão documental.', 'CONFLICT');
    }
    if (previousRequest.exists) {
      if (previousRequest.get('contentHash') !== contentHash || previousRequest.get('userId') !== input.userId
        || previousRequest.get('workspaceId') !== workspaceId) {
        throw fail('DP_EMPLOYMENT_REQUEST_REUSED', 'Identificador de solicitação reutilizado com conteúdo diferente.', 'CONFLICT');
      }
      const replayId = previousRequest.get('historyId');
      const replayRevision = previousRequest.get('revision');
      if (!Number.isSafeInteger(replayRevision) || replayRevision < 1 || replayId !== historyId(head, replayRevision)) {
        throw fail('DP_EMPLOYMENT_REQUEST_STATE', 'Estado da solicitação inconsistente.', 'DATA_INTEGRITY');
      }
      const replayDocument = await transaction.get(dbAdmin.collection(HISTORIES).doc(replayId));
      const replayHistory = replayDocument.data() as EmploymentHistory | undefined;
      if (!replayDocument.exists || !replayHistory || replayHistory.workspaceId !== workspaceId
        || replayHistory.userId !== input.userId || replayHistory.revision !== replayRevision
        || !validEmploymentHistory(replayHistory)) {
        throw fail('DP_EMPLOYMENT_REQUEST_STATE', 'Estado da solicitação inconsistente.', 'DATA_INTEGRITY');
      }
      assertUnitsScope(context, allPeriodUnitIds(replayHistory.periods));
      return { historyId: replayId as string, revision: replayRevision as number, replayed: true };
    }
    if (!catalog) throw fail('DP_EMPLOYMENT_REQUEST_STATE', 'Estado da solicitação inconsistente.', 'DATA_INTEGRITY');
    const revision = currentHead.exists ? Number(currentHead.get('revision')) : 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision !== input.expectedRevision) {
      throw fail('DP_EMPLOYMENT_REVISION_CONFLICT', 'Histórico alterado desde a leitura. Atualize e tente novamente.', 'CONFLICT');
    }
    if (currentHead.exists) {
      const previousId = historyId(head, revision);
      if (revision < 1 || currentHead.get('historyId') !== previousId) {
        throw fail('DP_EMPLOYMENT_HEAD_INCONSISTENT', 'Cabeçalho do histórico inconsistente.', 'DATA_INTEGRITY');
      }
      const previousDocument = await transaction.get(dbAdmin.collection(HISTORIES).doc(previousId));
      const previousHistory = previousDocument.data() as EmploymentHistory | undefined;
      if (!previousDocument.exists || !previousHistory || previousHistory.workspaceId !== workspaceId
        || previousHistory.userId !== input.userId || previousHistory.revision !== revision
        || previousHistory.historyId !== previousId || !validEmploymentHistory(previousHistory)) {
        throw fail('DP_EMPLOYMENT_HISTORY_INCONSISTENT', 'Revisão anterior inconsistente.', 'DATA_INTEGRITY');
      }
      assertUnitsScope(context, allPeriodUnitIds(previousHistory.periods));
    }
    const unitsById = new Map(units.map((doc) => [doc.id, doc]));
    if (units.some((doc) => !doc.exists)) {
      throw fail('DP_EMPLOYMENT_UNIT_MISSING', 'Unidade do histórico não encontrada.', 'VALIDATION');
    }
    const periods: EmploymentPeriod[] = input.periods.map((period) => {
      const employer = unitsById.get(period.employerUnitId)!;
      const name = typeof employer.get('name') === 'string' ? employer.get('name').trim() : '';
      const address = typeof employer.get('address') === 'string' ? employer.get('address').trim() : '';
      const cnpj = CnpjValidator.validate(String(employer.get('cnpj') ?? ''));
      if (!name || !address || !cnpj.valid) {
        throw fail('DP_EMPLOYMENT_FISCAL_PENDING', 'A unidade empregadora precisa de nome, endereço e CNPJ consistentes antes da publicação.', 'VALIDATION');
      }
      return {
        ...period,
        employer: { unitId: period.employerUnitId, unitName: name, address, cnpj: cnpj.clean,
          identityStatus: 'catalog_identifiers_consistent_unverified' },
        jobRoleName: period.jobRoleId ? catalog.roleNames.get(period.jobRoleId) ?? null : null,
        jobFunctionNames: period.jobFunctionIds.map((id) => catalog.functionNames.get(id) ?? id),
      };
    });
    const nextRevision = revision + 1;
    const id = historyId(head, nextRevision);
    const payload: EmploymentHistory = { workspaceId, userId: input.userId, revision: nextRevision, historyId: id, periods };
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_HISTORY_BYTES) {
      throw fail('DP_EMPLOYMENT_HISTORY_TOO_LARGE', 'Histórico excede o tamanho permitido.', 'VALIDATION');
    }
    const now = Timestamp.now();
    transaction.create(dbAdmin.collection(HISTORIES).doc(id), {
      ...payload, contentHash, requestId: input.requestId, actorId: context.decoded.uid,
      observedEmploymentCycleVersion: Number.isSafeInteger(user.get('employmentCycleVersion'))
        ? user.get('employmentCycleVersion') : null,
      sourceValidation: 'unit_identifiers_consistent_not_legal_proof',
      createdAt: now,
    });
    transaction.set(headRef, { revision: nextRevision, historyId: id });
    transaction.create(requestRef, { workspaceId, userId: input.userId, contentHash, historyId: id, revision: nextRevision, createdAt: now });
    return { historyId: id, revision: nextRevision, replayed: false };
  });
}

export async function readEmploymentHistory(context: ServerUserContext, params: {
  userId: string; revision?: number;
}) {
  assertRead(context, params.userId);
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(params.userId)
    || params.revision !== undefined && (!Number.isSafeInteger(params.revision) || params.revision < 1)) {
    throw fail('DP_EMPLOYMENT_READ_INPUT_INVALID', 'Consulta inválida.', 'VALIDATION');
  }
  const head = headId(context.workspace_id, params.userId);
  return dbAdmin.runTransaction(async (transaction) => {
    const [user, currentHead] = await transaction.getAll(
      dbAdmin.collection('users').doc(params.userId), dbAdmin.collection(HEADS).doc(head));
    if (!user.exists) throw fail('DP_EMPLOYMENT_PERSON_MISSING', 'Pessoa não encontrada.', 'NOT_FOUND');
    assertPersonScope(context, user.data() ?? {});
    if (!currentHead.exists) return { status: 'missing' as const };
    const latestRevision = currentHead.get('revision');
    if (!Number.isSafeInteger(latestRevision) || latestRevision < 1
      || typeof currentHead.get('historyId') !== 'string') return { status: 'inconsistent' as const };
    const revision = params.revision ?? latestRevision;
    if (revision > latestRevision) return { status: 'missing' as const };
    const id = historyId(head, revision);
    if (params.revision === undefined && currentHead.get('historyId') !== id) return { status: 'inconsistent' as const };
    const document = await transaction.get(dbAdmin.collection(HISTORIES).doc(id));
    if (!document.exists || document.get('workspaceId') !== context.workspace_id
      || document.get('userId') !== params.userId || document.get('revision') !== revision
      || document.get('historyId') !== id) return { status: 'inconsistent' as const, historyId: id, revision };
    const history = document.data() as EmploymentHistory;
    if (!validEmploymentHistory(history)) return { status: 'inconsistent' as const, historyId: id, revision };
    assertUnitsScope(context, allPeriodUnitIds(history.periods));
    return { status: 'found' as const, historyId: id, revision, periods: history.periods };
  });
}

export async function readEmploymentReference(context: ServerUserContext, params: {
  userId: string; date: string; revision?: number;
}) {
  if (!civilDate.safeParse(params.date).success) {
    throw fail('DP_EMPLOYMENT_READ_INPUT_INVALID', 'Consulta inválida.', 'VALIDATION');
  }
  const result = await readEmploymentHistory(context, { userId: params.userId, revision: params.revision });
  if (result.status !== 'found') return result;
  return resolveEmploymentReference({
    workspaceId: context.workspace_id,
    userId: params.userId,
    historyId: result.historyId,
    revision: result.revision,
    periods: result.periods,
  }, params.date);
}

/** Resolução interna sem autorização de UI; destinada a serviços server-only que já autenticaram o titular. */
export async function resolveEmploymentReferenceForSystem(params: {
  workspaceId: string; userId: string; date: string; database?: FirebaseFirestore.Firestore;
}) {
  if (!civilDate.safeParse(params.date).success || !/^[A-Za-z0-9_-]{1,180}$/.test(params.userId)
    || !params.workspaceId.trim()) return { status: 'inconsistent' as const };
  const database = params.database ?? dbAdmin;
  const head = headId(params.workspaceId, params.userId);
  return database.runTransaction(async (transaction) => {
    const currentHead = await transaction.get(database.collection(HEADS).doc(head));
    if (!currentHead.exists) return { status: 'missing' as const };
    const revision = currentHead.get('revision');
    const id = Number.isSafeInteger(revision) && revision >= 1 ? historyId(head, revision) : '';
    if (!id || currentHead.get('historyId') !== id) return { status: 'inconsistent' as const };
    const document = await transaction.get(database.collection(HISTORIES).doc(id));
    const history = document.data() as EmploymentHistory | undefined;
    if (!document.exists || !history || history.workspaceId !== params.workspaceId || history.userId !== params.userId
      || history.historyId !== id || history.revision !== revision || !validEmploymentHistory(history)) {
      return { status: 'inconsistent' as const, historyId: id, revision };
    }
    return resolveEmploymentReference(history, params.date);
  });
}
