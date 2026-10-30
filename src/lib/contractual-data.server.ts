import 'server-only';
import { Timestamp, FieldValue, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { CONTRACTUAL_FIELDS, contractualDiff } from './contractual-data';
import { AppError } from './observability/app-error';
import { operationalCivilDate } from './operational-unit-periods';
import { isCivilDate } from '@/features/dp/employment-reference/resolve';
import { previousCivilDate } from '@/features/dp/employment-reference/presentation';

export type ContractualPeriod = { validFrom: string; validTo?: string; changeId: string; fields: Record<string, unknown>;
  employer?: { unitId: string; unitName: string; cnpj: string; address: string; identityStatus: 'catalog_identifiers_consistent_unverified' } };
export type PreparedContractChange = { id: string; effectiveDate: string; reason: string; fields: Record<string, unknown>;
  changes: Record<string, { before: unknown; after: unknown }>; employer?: ContractualPeriod['employer']; actorId: string; actorName: string;
  observedEmploymentCycleVersion: number; profileWasDefaultAdmin?: boolean; activationStatus?: 'conflict' };

export function prepareContractChange(before: Record<string, unknown>, patch: Record<string, unknown>, input: {
  effectiveDate: unknown; reason: unknown; id: string; actorId: string; actorName: string; employer?: ContractualPeriod['employer']; today?: string;
}): PreparedContractChange | null {
  const changes = contractualDiff(before, patch);
  const fields = Object.fromEntries(CONTRACTUAL_FIELDS.filter((key) => key in changes).map((key) => [key, patch[key]]));
  // A full-user form must never put unchanged contractual values back over a concurrent edit.
  for (const key of CONTRACTUAL_FIELDS) delete patch[key];
  if (!Object.keys(changes).length) return null;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) throw new AppError({ code: 'CONTRACT_CHANGE_REASON_REQUIRED', kind: 'VALIDATION', safeMessage: 'Informe uma justificativa de 5 a 500 caracteres para a alteração contratual.' });
  if (!isCivilDate(input.effectiveDate) || input.effectiveDate < (input.today ?? operationalCivilDate())) {
    throw new AppError({ code: 'CONTRACT_CHANGE_DATE_INVALID', kind: 'VALIDATION', safeMessage: 'Informe hoje ou uma data futura para a alteração contratual.' });
  }
  if (before.scheduledContractChange) throw new AppError({ code: 'CONTRACT_CHANGE_ALREADY_SCHEDULED', kind: 'CONFLICT', safeMessage: 'Cancele o agendamento contratual pendente antes de criar outra alteração.' });
  if ((fields.jobRoleId !== undefined || fields.jobFunctionIds !== undefined) && patch.profileId !== undefined && patch.profileId !== before.profileId) {
    fields.profileId = patch.profileId; delete patch.profileId;
  }
  return { id: input.id, effectiveDate: input.effectiveDate, reason, fields, changes,
    observedEmploymentCycleVersion: Number(before.employmentCycleVersion) || 0,
    actorId: input.actorId, actorName: input.actorName, ...(input.employer ? { employer: input.employer } : {}) };
}

export function applyContractChange(transaction: Transaction, ref: DocumentReference, latest: DocumentSnapshot,
  before: Record<string, unknown>, change: PreparedContractChange | null, date = operationalCivilDate()) {
  if (!change) return {};
  const latestFields = Object.fromEntries(CONTRACTUAL_FIELDS.map((key) => [key, latest.get(key)]));
  if ((latest.get('contractualDataVersion') ?? 0) !== (before.contractualDataVersion ?? 0)
    || Object.keys(contractualDiff(before, latestFields)).length) {
    throw new AppError({ code: 'CONTRACT_CHANGE_CONFLICT', kind: 'CONFLICT', safeMessage: 'Os dados contratuais mudaram. Atualize a leitura antes de salvar.' });
  }
  const periods = (latest.get('contractualDataPeriods') ?? []) as ContractualPeriod[];
  const last = periods.at(-1);
  if (last && change.effectiveDate < last.validFrom) throw new AppError({ code: 'CONTRACT_CHANGE_PERIOD_CONFLICT', kind: 'CONFLICT', safeMessage: 'A data está antes da última alteração contratual. Confira o histórico antes de salvar.' });
  const next = periods.map((period) => ({ ...period }));
  if (last?.validFrom === change.effectiveDate) next.pop();
  else if (last && !last.validTo) next[next.length - 1].validTo = previousCivilDate(change.effectiveDate)!;
  const fields = Object.fromEntries(CONTRACTUAL_FIELDS.flatMap((key) => {
    const value = key in change.fields ? change.fields[key] : latest.get(key);
    return value === undefined ? [] : [[key, value]];
  }));
  next.push({ validFrom: change.effectiveDate, changeId: change.id, fields, ...(change.employer ? { employer: change.employer } : last?.employer ? { employer: last.employer } : {}) });
  const scheduled = change.effectiveDate > date;
  // Reasons, actors and before/after stay in the private audit, outside the user directory.
  const scheduledState = { id: change.id, effectiveDate: change.effectiveDate, fields: change.fields,
    observedEmploymentCycleVersion: change.observedEmploymentCycleVersion,
    ...(change.profileWasDefaultAdmin !== undefined ? { profileWasDefaultAdmin: change.profileWasDefaultAdmin } : {}) };
  transaction.create(ref.collection('contractualChanges').doc(change.id), { ...change, source: 'user_edit',
    status: scheduled ? 'scheduled' : 'applied', createdAt: Timestamp.now() });
  return { ...(scheduled ? {} : change.fields), contractualDataPeriods: next,
    contractualDataVersion: (Number(latest.get('contractualDataVersion')) || 0) + 1,
    ...(!scheduled ? { contractProjectionSyncPending: true } : {}),
    ...(!scheduled ? { contractualFieldOverrides: [...new Set([...(latest.get('contractualFieldOverrides') ?? []), ...Object.keys(change.fields)])] } : {}),
    ...(scheduled ? { scheduledContractChange: scheduledState, nextContractChangeDate: change.effectiveDate }
      : { scheduledContractChange: FieldValue.delete(), nextContractChangeDate: FieldValue.delete() }) };
}

export function cancelContractChange(transaction: Transaction, ref: DocumentReference, latest: DocumentSnapshot,
  before: Record<string, unknown>, input: { id: string; reason: unknown; actorId: string; actorName: string }, date = operationalCivilDate()) {
  const pending = latest.get('scheduledContractChange') as PreparedContractChange | undefined;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) throw new AppError({ code: 'CONTRACT_CANCEL_REASON_REQUIRED', kind: 'VALIDATION', safeMessage: 'Informe uma justificativa de 5 a 500 caracteres para cancelar.' });
  if (!pending || pending.id !== input.id || pending.effectiveDate <= date && pending.activationStatus !== 'conflict'
    || (latest.get('contractualDataVersion') ?? 0) !== (before.contractualDataVersion ?? 0)) {
    throw new AppError({ code: 'CONTRACT_CANCEL_CONFLICT', kind: 'CONFLICT', safeMessage: 'O agendamento mudou ou já entrou em vigor. Atualize a leitura.' });
  }
  const periods = (latest.get('contractualDataPeriods') ?? []) as ContractualPeriod[];
  const retained = periods.filter((period) => period.changeId !== pending.id);
  if (retained.length) {
    const { validTo: _end, ...open } = retained[retained.length - 1];
    retained[retained.length - 1] = open;
  }
  transaction.update(ref.collection('contractualChanges').doc(input.id), { status: 'cancelled',
    cancellation: { reason, actorId: input.actorId, actorName: input.actorName, createdAt: Timestamp.now() } });
  return { contractualDataPeriods: retained, contractualDataVersion: (Number(latest.get('contractualDataVersion')) || 0) + 1,
    scheduledContractChange: FieldValue.delete(), nextContractChangeDate: FieldValue.delete() };
}
