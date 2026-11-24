import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { canAccessUnit, getLinkedUnitIds, resolveUnitAccess } from '@/lib/unit-access';
import { AppError } from '@/lib/observability/app-error';
import { readRosterHistories, resolveRosterEmploymentOnDate } from '@/features/dp/employment-reference/service.server';
import type { EmploymentHistory } from '@/features/dp/employment-reference/resolve';
import { bankLinesWithMovements, TIME_BANK_ALGORITHM_VERSION, type BankManualMovement, type BankMonthRecord, type BankStatementLine } from '@/features/dp/time-bank/core';
import { readBankStatementForProvider, readPayrollReadiness, type BankMonthDocument } from '@/features/dp/time-bank/service.server';
import { payrollReviewReason } from '@/features/dp/time-bank/payroll-readiness';
import { assertClosureAccess } from '@/features/dp/time-adjustments/closure.server';
import { canReview, closureKey } from '@/features/dp/time-adjustments/service.server';
import { competenceRange, sha256, type ClosurePerson } from '@/features/dp/time-adjustments/closure-core';
import { MIRROR_RENDERER_VERSION, mirrorSnapshotHash, type MirrorSnapshot } from '@/features/dp/time-adjustments/mirror-core';
import type { PortalPrincipal, ProviderGrant, ProviderOffice, StoredProviderMember } from './types';
import type { ClosureAccessInput, ClosureReleaseDependencies, ClosureReleaseInput, ClosureReleaseSelection, ProviderClosureAccess, ProviderClosureContent, ProviderClosureRelease, ProviderClosureRow } from './closure-types';

const defaults: ClosureReleaseDependencies = {
  mainDb: dbAdmin, hrDb: hrDbAdmin, now: () => new Date(), randomId: randomUUID,
  readStatement: (workspaceId, uid, competence, tx) => readBankStatementForProvider(workspaceId, uid, competence, tx),
  readReadiness: (context, competence) => readPayrollReadiness(context, competence),
};
const CLOSURE_COLLECTION = 'ptrp_competenceClosures';
const VERSION_COLLECTION = 'versions';
const PEOPLE_COLLECTION = 'people';
const MIRROR_COLLECTION = 'mirrors';
const BANK_COLLECTION = 'timeBank';
const MOVEMENT_COLLECTION = 'timeBankMovements';
const PACKAGE_COLLECTION = 'packages';
function closureRecords(db: Firestore) { return db.collection(CLOSURE_COLLECTION); }
function closureVersions(ref: DocumentReference) { return ref.collection(VERSION_COLLECTION); }
function closurePeople(ref: DocumentReference) { return ref.collection(PEOPLE_COLLECTION); }
function closureMirrors(ref: DocumentReference) { return ref.collection(MIRROR_COLLECTION); }
function closureBanks(ref: DocumentReference) { return ref.collection(BANK_COLLECTION); }
function closureMovements(ref: DocumentReference) { return ref.collection(MOVEMENT_COLLECTION); }
function closurePackages(ref: DocumentReference) { return ref.collection(PACKAGE_COLLECTION); }
const MAX_PEOPLE = 450;
const MAX_MOVEMENTS = 500;
const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const digits = (value: unknown) => typeof value === 'string' ? value.replace(/\D/g, '') : '';
function fail(message: string, kind: 'CONFLICT' | 'AUTHORIZATION' | 'NOT_FOUND' = 'CONFLICT') {
  return new AppError({ code: 'PROVIDER_CLOSURE_UNAVAILABLE', kind, safeMessage: message });
}
function manager(context: ServerUserContext, employerUnitId?: string) {
  assertClosureAccess(context, 'close');
  if (!canReview(context) || employerUnitId && !canAccessUnit(context.userDoc, employerUnitId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('Sem permissão para liberar esta entrega.', 'AUTHORIZATION');
  }
}
async function grantFor(deps: ClosureReleaseDependencies, workspaceId: string, grantId: string, principal?: PortalPrincipal) {
  return deps.mainDb.runTransaction(async (tx) => {
    const grant = (await tx.get(deps.mainDb.collection('providerPortalGrants').doc(grantId))).data() as ProviderGrant | undefined;
    if (!grant || grant.id !== grantId || grant.workspaceId !== workspaceId || grant.revokedAt || grant.expiresAt <= deps.now().toISOString()) throw fail('Autorização indisponível.', 'AUTHORIZATION');
    if (principal && (grant.memberId !== principal.memberId || grant.officeId !== principal.officeId || grant.workspaceId !== principal.workspaceId)) throw fail('Autorização indisponível.', 'AUTHORIZATION');
    const [memberDoc, officeDoc, employer] = await Promise.all([
      tx.get(deps.mainDb.collection('providerMembers').doc(grant.memberId)),
      tx.get(deps.mainDb.collection('providerOffices').doc(grant.officeId)),
      tx.get(deps.mainDb.collection('dp_units').doc(grant.employerUnitId)),
    ]);
    const member = memberDoc.data() as StoredProviderMember | undefined;
    const office = officeDoc.data() as ProviderOffice | undefined;
    if (!member?.active || member.status !== 'active' || member.profile !== 'accounting' || member.accountType !== 'service_provider'
      || !office?.active || member.officeId !== grant.officeId || member.workspaceId !== workspaceId || office.workspaceId !== workspaceId) throw fail('Autorização indisponível.', 'AUTHORIZATION');
    const cnpj = digits(employer.get('cnpj'));
    if (!employer.exists || !CnpjValidator.validate(cnpj).valid) throw fail('Confira a identificação fiscal do empregador.');
    return { grant, employerCnpj: cnpj };
  });
}
export function providerEmploymentProofHash(history: EmploymentHistory, user: Record<string, unknown>) {
  return sha256({ historyId: history.historyId, revision: history.revision,
    hrEmployeeId: typeof user.hrEmployeeId === 'string' ? user.hrEmployeeId.trim() || null : null,
    contractualDataPeriods: user.contractualDataPeriods ?? null, scheduledContractChange: user.scheduledContractChange ?? null,
    operationalUnitPeriods: user.operationalUnitPeriods ?? null, operationalUnitCutoverDate: user.operationalUnitCutoverDate ?? null });
}
async function employmentProof(deps: ClosureReleaseDependencies, workspaceId: string, uid: string) {
  const [userDoc, histories] = await Promise.all([
    deps.mainDb.collection('users').doc(uid).get(), readRosterHistories(deps.mainDb, workspaceId, [uid]),
  ]);
  const history = histories.get(uid);
  if (!userDoc.exists || !history) throw fail('Confira o histórico de vínculo do colaborador.');
  const user = userDoc.data()!;
  return { user, history, hash: providerEmploymentProofHash(history, user) };
}
type MirrorRecord = { snapshot: MirrorSnapshot; snapshotHash: string; rendererVersion: string };
type HrSources = {
  closureVersion: number; manifestHash: string; person: ClosurePerson; mirror: MirrorRecord;
  month: BankMonthDocument; previous?: BankMonthDocument; movements: BankManualMovement[];
  statement: { lines: BankStatementLine[]; policy: unknown; missing: string[]; expiration: { days: number | null; destination: string } | null };
  package: DocumentData | null; payslipEmployee: DocumentData | null; payslipDoc: DocumentData | null; payslipId: string | null;
};
function assertBank(month: BankMonthDocument | undefined, uid: string, competence: string, version: number) {
  if (!month || month.uid !== uid || month.competence !== competence || month.closureVersion !== version
    || month.algorithmVersion !== TIME_BANK_ALGORITHM_VERSION || !Array.isArray(month.days) || month.days.length > 31) throw fail('A apuração precisa ser conferida para esta versão.');
  return month;
}
async function hrSources(deps: ClosureReleaseDependencies, tx: Transaction, workspaceId: string, competence: string, uid: string, includePayslip: boolean): Promise<HrSources> {
  const closure = closureRecords(deps.hrDb).doc(closureKey(workspaceId, competence));
  const current = await tx.get(closure);
  const version = Number(current.get('version'));
  if (current.get('status') !== 'closed' || !Number.isSafeInteger(version) || version < 1) throw fail('A competência precisa estar fechada.');
  const frozen = closureVersions(closure).doc(String(version));
  const [manifest, personDoc, mirrorDoc, monthDoc, packageDoc] = await Promise.all([
    tx.get(frozen), tx.get(closurePeople(frozen).doc(uid)), tx.get(closureMirrors(frozen).doc(uid)),
    tx.get(closureBanks(frozen).doc(uid)), includePayslip ? tx.get(closurePackages(frozen).doc(uid)) : Promise.resolve(null),
  ]);
  const manifestHash = current.get('manifestHash');
  if (typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifestHash)) throw fail('O fechamento não tem um manifesto válido.');
  const person = personDoc.data() as ClosurePerson | undefined;
  const mirror = mirrorDoc.data() as MirrorRecord | undefined;
  if (current.get('workspaceId') !== workspaceId || current.get('competence') !== competence || !manifest.exists || manifest.get('manifestHash') !== manifestHash
    || !person || person.uid !== uid || !mirror || mirror.rendererVersion !== MIRROR_RENDERER_VERSION) throw fail('O fechamento ou o espelho desta pessoa está incompleto.');
  const snapshot = mirror.snapshot;
  if (snapshot?.schemaVersion !== 1 || snapshot.workspaceId !== workspaceId || snapshot.employee.uid !== uid
    || snapshot.competence !== competence || snapshot.closureVersion !== version || snapshot.manifestHash !== manifestHash
    || snapshot.truncated || mirror.snapshotHash !== mirrorSnapshotHash(snapshot)) throw fail('O espelho falhou na conferência de integridade.');
  const month = assertBank(monthDoc.data() as BankMonthDocument | undefined, uid, competence, version);
  if (Array.isArray(personDoc.get('breakReviewDates')) && personDoc.get('breakReviewDates').length) throw fail('Há intervalo aguardando conferência para a folha.');
  const prior = new Date(competence + '-01T00:00:00Z'); prior.setUTCDate(0);
  const priorCompetence = prior.toISOString().slice(0, 7);
  const first = new Date(competence + '-01T00:00:00Z');
  const initialWeekDays = (8 - (first.getUTCDay() || 7)) % 7;
  const crossesWeek = month.days.some((day) => Number(day.date.slice(-2)) <= initialWeekDays
    && day.policy?.weeklyOvertimeLimitMinutes && day.lines.some((line) => line.categoryId
      && ['worked_more', 'rest_day_work', 'sunday_work', 'holiday_work', 'unplanned_work', 'pending_approval'].includes(line.reason)));
  let previous: BankMonthDocument | undefined;
  if (crossesWeek) {
    const priorClosure = await tx.get(closureRecords(deps.hrDb).doc(closureKey(workspaceId, priorCompetence)));
    if (priorClosure.get('status') === 'closed') {
      const priorVersion = Number(priorClosure.get('version'));
      const bank = await tx.get(closureBanks(closureVersions(priorClosure.ref).doc(String(priorVersion))).doc(uid));
      if (bank.exists) previous = assertBank(bank.data() as BankMonthDocument, uid, priorCompetence, priorVersion);
    }
  }
  const movementMonths = crossesWeek ? [competence, priorCompetence] : [competence];
  const movementDocs = await Promise.all(movementMonths.map((monthKey) => tx.get(closureMovements(closureRecords(deps.hrDb).doc(closureKey(workspaceId, monthKey))).where('uid', '==', uid).limit(MAX_MOVEMENTS + 1))));
  if (movementDocs.some((docs) => docs.size > MAX_MOVEMENTS)) throw fail('O volume de movimentos exige conferência.');
  const movements = movementDocs.flatMap((docs) => docs.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as BankManualMovement))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (movements.some((movement) => movement.uid !== uid || ![competence, priorCompetence].includes(movement.competence))) throw fail('O movimento não corresponde à pessoa ou à competência.');
  if (payrollReviewReason(month, movements, previous)) throw fail('Há pendências de apuração para esta pessoa.');
  let payslipDoc: DocumentData | null = null;
  let payslipId: string | null = null;
  const rawPack = packageDoc?.data();
  const pack = rawPack ? { uid: rawPack.uid, employeeId: rawPack.employeeId, competence: rawPack.competence, closureVersion: rawPack.closureVersion, mirrorHash: rawPack.mirrorHash, payslip: rawPack.payslip ? { documentId: rawPack.payslip.documentId, sha256: rawPack.payslip.sha256 } : null } : null;
  let payslipEmployee: DocumentData | null = null;
  if (includePayslip) {
    if (!pack || pack.uid !== uid || pack.competence !== competence || pack.closureVersion !== version || pack.mirrorHash !== mirror.snapshotHash || typeof pack.payslip?.documentId !== 'string') throw fail('O contracheque não está vinculado à versão deste fechamento.');
    payslipId = pack.payslip.documentId;
    const document = (await tx.get(deps.hrDb.collection('employeeDocuments').doc(payslipId!))).data();
    payslipDoc = document ? Object.fromEntries(['employeeId', 'documentTypeCode', 'caseId', 'deletedAt', 'status', 'storagePath', 'contentHash', 'version'].map((key) => [key, document[key] ?? null])) : null;
    if (!payslipDoc || payslipDoc.documentTypeCode !== 'PAYSLIP' || payslipDoc.caseId !== 'month-' + competence
      || payslipDoc.deletedAt || ['rejected', 'archived'].includes(payslipDoc.status)
      || typeof payslipDoc.storagePath !== 'string' || !Number.isSafeInteger(payslipDoc.version) || payslipDoc.version < 1
      || payslipDoc.contentHash !== pack.payslip.sha256 || typeof pack.employeeId !== 'string') throw fail('Confira o documento de contracheque relacionado.');
    const employee = await tx.get(deps.hrDb.collection('employees').doc(pack.employeeId));
    payslipEmployee = employee.exists ? { id: employee.id, auth_uid: employee.get('auth_uid') ?? null, source_user_id: employee.get('source_user_id') ?? null } : null;
  }
  const statement = await deps.readStatement(workspaceId, uid, competence, tx);
  if (!statement.statement || statement.closures[competence] !== version) throw fail('O extrato contábil não confirma esta versão do fechamento.');
  const policy = statement.policy ? { id: statement.policy.id, version: statement.policy.version, enabled: statement.policy.enabled, cycle: statement.policy.cycle } : null;
  const financial = { lines: statement.statement.lines.filter((line) => line.competence === competence), policy, expiration: statement.expiration,
    missing: statement.statement.missing.filter((month) => month <= competence) };
  return { closureVersion: version, manifestHash, person, mirror, month, previous, movements, statement: financial, package: pack, payslipEmployee, payslipDoc, payslipId };
}

function activityDates(source: HrSources) {
  return [...new Set([
    ...source.mirror.snapshot.days.filter((day) => day.shift !== null || day.punches.length || day.absences.length).map((day) => day.date),
    ...source.month.days.filter((day) => day.kind !== 'no_schedule' || day.workedMinutes || day.absences.length || day.lines.length).map((day) => day.date),
    ...source.statement.lines.map((line) => line.date),
  ])].sort();
}
function employerFor(source: HrSources, history: EmploymentHistory, user: Record<string, unknown>, grant: ProviderGrant, expectedCnpj: string, requireMonthlyEmployer = false) {
  if (digits(source.mirror.snapshot.employer.cnpj) !== expectedCnpj) throw fail('O empregador do espelho precisa de nova conferência do RH.');
  if (source.statement.expiration?.days && source.statement.missing.some((month) => {
    const range = competenceRange(month);
    return history.periods.some((period) => period.validFrom <= range.end && (!period.validTo || period.validTo >= range.start));
  })) throw fail('A expiração de créditos depende de uma competência anterior ainda sem apuração.');
  const dates = activityDates(source);
  if (source.payslipDoc || requireMonthlyEmployer) {
    for (const date of datesOfMonth(grant.competence)) {
      if (history.periods.some((period) => period.validFrom <= date && (!period.validTo || period.validTo >= date))) dates.push(date);
    }
  }
  if (!dates.length) throw fail('Não há dias com vínculo e atividade demonstrados para esta entrega.');
  let name: string | undefined;
  for (const date of new Set(dates)) {
    const resolved = resolveRosterEmploymentOnDate(history, user, date);
    if (resolved.status !== 'matched' || resolved.period.employerUnitId !== grant.employerUnitId || digits(resolved.period.employer.cnpj) !== expectedCnpj) {
      throw fail('O mês envolve outro empregador ou um vínculo incompleto. Confira o histórico antes de liberar.');
    }
    name ??= resolved.period.employer.unitName;
  }
  if (!name) throw fail('Confira a identificação do empregador.');
  return { unitId: grant.employerUnitId, name, cnpj: expectedCnpj };
}
const ABSENCE_EFFECTS = new Set(['excused_absence', 'unexcused_absence', 'worked_credit', 'time_bank_debit']);
function minutes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail('Há uma quantidade de minutos inválida na apuração.');
  return value;
}
/** Only allowlisted accounting effects and mirror clock values leave the HR snapshot. */
export function buildProviderClosureContent(input: {
  mirror: MirrorSnapshot; month: BankMonthRecord; previous?: BankMonthRecord; movements: BankManualMovement[];
  employer: ProviderClosureContent['employer']; effectiveLines?: BankStatementLine[]; payslip?: ProviderClosureContent['documents'][number];
}): ProviderClosureContent {
  const { mirror, month } = input;
  const { start, end } = competenceRange(month.competence);
  const validDates = (dates: string[]) => dates.length === Number(end.slice(-2)) && new Set(dates).size === dates.length
    && dates.every((date, index) => date >= start && date <= end && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!index || dates[index - 1] < date));
  if (!validDates(mirror.days.map((day) => day.date)) || !validDates(month.days.map((day) => day.date))) throw fail('O espelho ou a apuração não cobre todos os dias do mês.');
  const effective = (input.effectiveLines ?? bankLinesWithMovements(input.previous ? [input.previous, month] : [month], input.movements))
    .filter((item) => item.competence === month.competence);
  if (effective.some((item) => item.line.nature === 'review')) throw fail('Existem lançamentos aguardando conferência.');
  const overtime = new Map<string, ProviderClosureContent['payroll']['overtime'][number]>();
  let creditMinutes = 0; let debitMinutes = 0; let discountMinutes = 0; let expiredCreditMinutes = 0; let bankPayrollMinutes = 0; let payrollOvertimeMinutes = 0;
  for (const { date, line } of effective) {
    if (!['bank_credit', 'bank_debit', 'payroll_overtime', 'payroll_discount'].includes(line.nature)) throw fail('Há um lançamento com natureza não reconhecida.');
    if (date < start || date > end) throw fail('Um lançamento aponta para uma data fora do mês.');
    const amount = minutes(line.minutes);
    if (line.nature === 'bank_credit') creditMinutes += amount;
    if (line.nature === 'bank_debit') debitMinutes += amount;
    if (line.nature === 'payroll_discount') discountMinutes += amount;
    if (line.nature === 'payroll_overtime') payrollOvertimeMinutes += amount;
    if (line.nature === 'payroll_overtime' && line.reason === 'credit_expired') { expiredCreditMinutes += amount; continue; }
    if (line.nature === 'payroll_overtime' && line.reason === 'payroll_settlement' && line.ratePercent === undefined) { bankPayrollMinutes += amount; continue; }
    if (line.nature === 'payroll_overtime' || line.nature === 'bank_credit' && line.ratePercent !== undefined) {
      if (typeof line.ratePercent !== 'number' || !Number.isFinite(line.ratePercent) || line.ratePercent < 0) throw fail('Confira o percentual das horas extras.');
      const destination = line.nature === 'payroll_overtime' ? 'payroll' as const : 'time_bank' as const;
      const creditFactor = destination === 'time_bank' ? line.factor ?? 1 : null;
      if (creditFactor !== null && (!Number.isFinite(creditFactor) || creditFactor <= 0)) throw fail('Confira o fator do crédito no banco.');
      const key = JSON.stringify([line.ratePercent, destination, creditFactor]);
      const current = overtime.get(key) ?? { ratePercent: line.ratePercent, destination, minutes: 0, creditFactor };
      current.minutes += amount; overtime.set(key, current);
    }
  }
  const effects = new Map<string, { date: string; effect: string }>();
  for (const day of month.days) for (const absence of day.absences) {
    if (!ABSENCE_EFFECTS.has(absence.effect)) throw fail('Confira o efeito da ausência antes de liberar.');
    effects.set(day.date + ':' + absence.effect, { date: day.date, effect: absence.effect });
  }
  const cpf = digits(mirror.employee.cpf);
  return {
    schemaVersion: 1, employee: { uid: mirror.employee.uid, name: mirror.employee.name,
      ...(cpf.length === 11 ? { cpfMasked: '***.***.' + cpf.slice(6, 9) + '-' + cpf.slice(9) } : {}) }, employer: input.employer,
    competence: month.competence, closureVersion: month.closureVersion,
    mirror: { days: mirror.days.map((day) => ({ date: day.date, pairedMinutes: day.pairedMinutes === null ? null : minutes(day.pairedMinutes),
      punches: day.punches.map((punch) => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(punch.time) || !['original', 'discarded', 'included'].includes(punch.mark)) throw fail('Confira as marcações do espelho.');
        return { time: punch.time, state: punch.mark };
      }) })) },
    payroll: { overtime: [...overtime.values()].sort((left, right) => left.destination.localeCompare(right.destination) || left.ratePercent - right.ratePercent),
      absenceEffects: [...effects.values()], unjustifiedAbsenceDates: month.days.filter((day) => day.unjustifiedAbsence).map((day) => day.date),
      scheduledDays: month.days.filter((day) => day.kind === 'workday').length, workedDays: month.days.filter((day) => day.workedMinutes > 0).length,
      creditMinutes, debitMinutes, monthBalanceMinutes: creditMinutes - debitMinutes, discountMinutes, expiredCreditMinutes, bankPayrollMinutes, payrollOvertimeMinutes,
      nightMinutes: month.days.reduce((total, day) => total + minutes(day.nightMinutes), 0) },
    documents: input.payslip ? [input.payslip] : [],
  };
}
async function selectedPayslip(deps: ClosureReleaseDependencies, source: HrSources, user: Record<string, unknown>, uid: string) {
  if (!source.payslipDoc || !source.payslipId || !source.package) return null;
  const employeeId = user.hrEmployeeId;
  if (typeof employeeId !== 'string' || !employeeId || source.payslipDoc.employeeId !== employeeId || source.package.employeeId !== employeeId) throw fail('Confira o vínculo entre a conta e o cadastro RH.');
  const employee = source.payslipEmployee;
  const links = [employee?.auth_uid, employee?.source_user_id].filter((value) => typeof value === 'string' && value);
  if (!employee || !links.length || links.some((value) => value !== uid)) throw fail('O cadastro RH não confirma o titular do contracheque.');
  if (!deps.readStorage) throw fail('A leitura protegida dos documentos ainda não está configurada.');
  const bytes = await deps.readStorage(source.payslipDoc.storagePath);
  if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw fail('O contracheque precisa ser um PDF de até 20 MiB.');
  if (bytesHash(bytes) !== source.payslipDoc.contentHash) throw fail('O contracheque falhou na conferência de integridade.');
  return { documentId: source.payslipId, employeeId, version: source.payslipDoc.version as number,
    storagePath: source.payslipDoc.storagePath as string, sha256: source.payslipDoc.contentHash as string };
}
function sourceHash(source: HrSources) {
  const materialBank = (bank: BankMonthDocument | undefined) => bank ? {
    uid: bank.uid, competence: bank.competence, closureVersion: bank.closureVersion, algorithmVersion: bank.algorithmVersion, days: bank.days,
  } : null;
  return sha256({ closureVersion: source.closureVersion, manifestHash: source.manifestHash,
    mirror: { snapshotHash: source.mirror.snapshotHash, rendererVersion: source.mirror.rendererVersion },
    month: materialBank(source.month), previous: materialBank(source.previous),
    movements: source.movements.map((item) => ({ id: item.id, uid: item.uid, date: item.date, competence: item.competence,
      status: item.status, kind: item.kind, createdAt: item.createdAt, categoryId: item.categoryId ?? null,
      replacesMinutes: item.replacesMinutes ?? null, sourceClosureVersion: item.sourceClosureVersion ?? null, line: item.line, counterLine: item.counterLine ?? null })),
    statement: { lines: source.statement.lines, policy: source.statement.policy, expiration: source.statement.expiration }, package: source.package, payslip: source.payslipDoc, payslipEmployee: source.payslipEmployee });
}
function accessId(grantId: string, uid: string) { return sha256([grantId, uid]); }
async function ready(deps: ClosureReleaseDependencies, context: ServerUserContext, competence: string, version: number, uid: string) {
  const readiness = await deps.readReadiness(context, competence);
  if (readiness.version !== version || readiness.people.find((person) => person.uid === uid)?.status !== 'ready') throw fail('Conclua a apuração e a conferência desta pessoa antes de liberar.');
}
function dependencies(injected: Partial<ClosureReleaseDependencies>) {
  const deps = { ...defaults, ...injected };
  if (!injected.readStatement) deps.readStatement = (workspaceId, uid, competence, tx) => readBankStatementForProvider(workspaceId, uid, competence, tx, { mainDb: deps.mainDb, hrDb: deps.hrDb, now: deps.now });
  if (!injected.readReadiness) deps.readReadiness = (context, competence) => readPayrollReadiness(context, competence, { mainDb: deps.mainDb, hrDb: deps.hrDb, now: deps.now });
  return deps;
}
function datesOfMonth(competence: string) {
  const { end } = competenceRange(competence);
  return Array.from({ length: Number(end.slice(-2)) }, (_, index) => competence + '-' + String(index + 1).padStart(2, '0'));
}
function candidateEmployment(context: ServerUserContext, grant: ProviderGrant, cnpj: string, history: EmploymentHistory, user: Record<string, unknown>) {
  const relevantUnits = new Set(getLinkedUnitIds(user));
  let matchesEmployer = false;
  let hasOtherEmployer = false;
  for (const date of datesOfMonth(grant.competence)) {
    if (!history.periods.some((period) => period.validFrom <= date && (!period.validTo || period.validTo >= date))) continue;
    const resolved = resolveRosterEmploymentOnDate(history, user, date);
    if (resolved.status !== 'matched') return null;
    for (const unit of [...resolved.period.unitIds, resolved.period.unitId, resolved.period.employerUnitId]) relevantUnits.add(unit);
    if (resolved.period.employerUnitId === grant.employerUnitId && digits(resolved.period.employer.cnpj) === cnpj) matchesEmployer = true;
    else hasOtherEmployer = true;
  }
  if (!matchesEmployer || [...relevantUnits].some((unit) => !canAccessUnit(context.userDoc, unit, { isDefaultAdmin: context.isDefaultAdmin }))) return null;
  if (hasOtherEmployer && !resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin }).allUnits) return null;
  return { hasOtherEmployer };
}
export async function listClosureReleaseCandidates(context: ServerUserContext, grantId: string, injected: Partial<ClosureReleaseDependencies> = {}) {
  const deps = dependencies(injected);
  manager(context);
  const { grant, employerCnpj } = await grantFor(deps, context.workspace_id, grantId);
  manager(context, grant.employerUnitId);
  const frozen = await deps.hrDb.runTransaction(async (tx) => {
    const closure = closureRecords(deps.hrDb).doc(closureKey(grant.workspaceId, grant.competence));
    const current = await tx.get(closure);
    if (current.get('status') !== 'closed') throw fail('Feche a competência antes de preparar as entregas.');
    const version = Number(current.get('version'));
    const [people, pointers] = await Promise.all([
      tx.get(closurePeople(closureVersions(closure).doc(String(version))).limit(MAX_PEOPLE + 1)),
      tx.get(deps.hrDb.collection('providerClosureAccess').where('grantId', '==', grant.id).where('workspaceId', '==', grant.workspaceId).limit(MAX_PEOPLE + 1)),
    ]);
    if (people.size > MAX_PEOPLE || pointers.size > MAX_PEOPLE || people.size !== current.get('peopleCount')) throw fail('A lista de colaboradores precisa ser conferida.');
    return { version, people: people.docs.map((doc) => ({ uid: doc.id, name: typeof doc.get('name') === 'string' ? doc.get('name') as string : 'Colaborador' })),
      pointers: pointers.docs.map((doc) => doc.data() as ProviderClosureAccess) };
  });
  const result: Array<{ uid: string; name: string; releaseId: string | null; hasOtherEmployer?: boolean }> = [];
  const released = new Map(frozen.pointers.map((pointer) => [pointer.employeeUid, pointer.releaseId]));
  for (let offset = 0; offset < frozen.people.length; offset += 50) {
    const people = frozen.people.slice(offset, offset + 50);
    const uids = people.map((person) => person.uid);
    const [users, histories] = await Promise.all([
      deps.mainDb.getAll(...uids.map((uid) => deps.mainDb.collection('users').doc(uid))),
      readRosterHistories(deps.mainDb, grant.workspaceId, uids),
    ]);
    people.forEach((person, index) => {
      const history = histories.get(person.uid);
      if (!users[index].exists || !history) return;
      const eligibility = candidateEmployment(context, grant, employerCnpj, history, users[index].data()!);
      if (!eligibility) return;
      result.push({ ...person, releaseId: released.get(person.uid) ?? null, ...(eligibility.hasOtherEmployer ? { hasOtherEmployer: true } : {}) });
    });
  }
  return { competence: grant.competence, closureVersion: frozen.version, people: result };
}
export async function previewClosureRelease(context: ServerUserContext, input: ClosureReleaseSelection, injected: Partial<ClosureReleaseDependencies> = {}) {
  const deps = dependencies(injected);
  manager(context);
  const { grant, employerCnpj } = await grantFor(deps, context.workspace_id, input.grantId);
  manager(context, grant.employerUnitId);
  const proof = await employmentProof(deps, grant.workspaceId, input.employeeUid);
  if (!candidateEmployment(context, grant, employerCnpj, proof.history, proof.user)) throw fail('Colaborador fora do seu escopo de unidades nesta competência.', 'AUTHORIZATION');
  const source = await deps.hrDb.runTransaction((tx) => hrSources(deps, tx, grant.workspaceId, grant.competence, input.employeeUid, input.includePayslip));
  await ready(deps, context, grant.competence, source.closureVersion, input.employeeUid);
  const payslip = await selectedPayslip(deps, source, proof.user, input.employeeUid);
  const employer = employerFor(source, proof.history, proof.user, grant, employerCnpj);
  const content = buildProviderClosureContent({ mirror: source.mirror.snapshot, month: source.month, previous: source.previous,
    movements: source.movements, effectiveLines: source.statement.lines, employer, payslip: payslip ? { kind: 'payslip', filename: 'contracheque-' + grant.competence + '.pdf', sha256: payslip.sha256 } : undefined });
  return { content, sourceHash: sourceHash(source), employmentProofHash: proof.hash };
}
export async function releaseClosureToProvider(context: ServerUserContext, input: ClosureReleaseInput, injected: Partial<ClosureReleaseDependencies> = {}) {
  const deps = dependencies(injected);
  manager(context);
  const { grant, employerCnpj } = await grantFor(deps, context.workspace_id, input.grantId);
  manager(context, grant.employerUnitId);
  const proof = await employmentProof(deps, grant.workspaceId, input.employeeUid);
  if (!candidateEmployment(context, grant, employerCnpj, proof.history, proof.user)) throw fail('Colaborador fora do seu escopo de unidades nesta competência.', 'AUTHORIZATION');
  if (proof.hash !== input.expectedEmploymentProofHash) throw fail('O vínculo mudou. Confira uma nova prévia.');
  const previewSource = await deps.hrDb.runTransaction((tx) => hrSources(deps, tx, grant.workspaceId, grant.competence, input.employeeUid, input.includePayslip));
  await ready(deps, context, grant.competence, previewSource.closureVersion, input.employeeUid);
  const payslip = await selectedPayslip(deps, previewSource, proof.user, input.employeeUid);
  return deps.hrDb.runTransaction(async (tx) => {
    const ref = deps.hrDb.collection('providerClosureReleases').doc(input.requestId);
    const existing = (await tx.get(ref)).data() as ProviderClosureRelease | undefined;
    if (existing) {
      if (existing.workspaceId !== grant.workspaceId || existing.grantId !== input.grantId || existing.employeeUid !== input.employeeUid
        || existing.createdBy !== context.decoded.uid || existing.sourceHash !== input.expectedSourceHash
        || existing.employmentProofHash !== input.expectedEmploymentProofHash || Boolean(existing.payslip) !== input.includePayslip) throw fail('A tentativa já foi usada em outra entrega.');
      return { releaseId: existing.id, content: existing.content };
    }
    const source = await hrSources(deps, tx, grant.workspaceId, grant.competence, input.employeeUid, input.includePayslip);
    if (sourceHash(source) !== input.expectedSourceHash || sourceHash(previewSource) !== input.expectedSourceHash) throw fail('O fechamento mudou. Confira uma nova prévia.');
    const employer = employerFor(source, proof.history, proof.user, grant, employerCnpj);
    const content = buildProviderClosureContent({ mirror: source.mirror.snapshot, month: source.month, previous: source.previous, movements: source.movements, effectiveLines: source.statement.lines, employer,
      payslip: payslip ? { kind: 'payslip', filename: 'contracheque-' + grant.competence + '.pdf', sha256: payslip.sha256 } : undefined });
    const at = deps.now().toISOString();
    const release: ProviderClosureRelease = { id: ref.id, workspaceId: grant.workspaceId, memberId: grant.memberId, officeId: grant.officeId,
      grantId: grant.id, employeeUid: input.employeeUid, employerUnitId: grant.employerUnitId, competence: grant.competence, closureVersion: source.closureVersion,
      content, contentHash: sha256(content), sourceHash: input.expectedSourceHash, employmentProofHash: proof.hash,
      historyId: proof.history.historyId, historyRevision: proof.history.revision, createdAt: at, createdBy: context.decoded.uid, requestId: input.requestId, payslip };
    const pointer: ProviderClosureAccess = { id: accessId(grant.id, input.employeeUid), workspaceId: grant.workspaceId, memberId: grant.memberId, officeId: grant.officeId,
      grantId: grant.id, employeeUid: input.employeeUid, releaseId: ref.id, closureVersion: source.closureVersion, updatedAt: at, updatedBy: context.decoded.uid };
    tx.create(ref, release);
    tx.set(deps.hrDb.collection('providerClosureAccess').doc(pointer.id), pointer);
    return { releaseId: ref.id, content };
  });
}

async function releaseFor(deps: ClosureReleaseDependencies, principal: PortalPrincipal, grantId: string, releaseId: string, transaction?: Transaction, requireMonthlyEmployer = false) {
  const { grant, employerCnpj } = await grantFor(deps, principal.workspaceId, grantId, principal);
  const releaseRef = deps.hrDb.collection('providerClosureReleases').doc(releaseId);
  const initial = (await (transaction ? transaction.get(releaseRef) : releaseRef.get())).data() as ProviderClosureRelease | undefined;
  if (!initial || initial.grantId !== grant.id || initial.workspaceId !== grant.workspaceId || initial.memberId !== principal.memberId
    || initial.officeId !== principal.officeId || initial.employerUnitId !== grant.employerUnitId || initial.competence !== grant.competence) throw fail('Entrega não encontrada.', 'NOT_FOUND');
  const proof = await employmentProof(deps, grant.workspaceId, initial.employeeUid);
  if (proof.hash !== initial.employmentProofHash) throw fail('O vínculo foi atualizado. Aguarde uma nova liberação do RH.');
  const read = async (tx: Transaction) => {
    const [releaseDoc, pointerDoc] = await Promise.all([
      tx.get(deps.hrDb.collection('providerClosureReleases').doc(releaseId)),
      tx.get(deps.hrDb.collection('providerClosureAccess').doc(accessId(grant.id, initial.employeeUid))),
    ]);
    const current = releaseDoc.data() as ProviderClosureRelease | undefined;
    const pointer = pointerDoc.data() as ProviderClosureAccess | undefined;
    if (!current || sha256(current) !== sha256(initial) || pointer?.releaseId !== releaseId || pointer.workspaceId !== grant.workspaceId
      || pointer.memberId !== principal.memberId || pointer.officeId !== principal.officeId || pointer.employeeUid !== initial.employeeUid) throw fail('A entrega foi substituída. Atualize a página.');
    const source = await hrSources(deps, tx, grant.workspaceId, grant.competence, current.employeeUid, Boolean(current.payslip));
    if (source.closureVersion !== current.closureVersion || sourceHash(source) !== current.sourceHash || sha256(current.content) !== current.contentHash
      || current.content.employer.cnpj !== employerCnpj) throw fail('O fechamento mudou. Aguarde uma nova liberação do RH.');
    employerFor(source, proof.history, proof.user, grant, employerCnpj, requireMonthlyEmployer);
    if (current.payslip && proof.user.hrEmployeeId !== current.payslip.employeeId) throw fail('O vínculo do documento precisa de nova conferência do RH.');
    return current;
  };
  return transaction ? read(transaction) : deps.hrDb.runTransaction(read);
}
export async function listReleasedClosures(principal: PortalPrincipal, grantId: string, injected: Partial<ClosureReleaseDependencies> = {}): Promise<ProviderClosureRow[]> {
  const deps = dependencies(injected);
  const { grant, employerCnpj } = await grantFor(deps, principal.workspaceId, grantId, principal);
  const pointers = await deps.hrDb.collection('providerClosureAccess').where('grantId', '==', grant.id).where('workspaceId', '==', grant.workspaceId).limit(MAX_PEOPLE + 1).get();
  if (pointers.size > MAX_PEOPLE) throw fail('A lista de entregas excedeu o limite.');
  const closure = await closureRecords(deps.hrDb).doc(closureKey(grant.workspaceId, grant.competence)).get();
  const result: ProviderClosureRow[] = [];
  for (let offset = 0; offset < pointers.size; offset += 8) {
    const group = pointers.docs.slice(offset, offset + 8);
    const rows = await Promise.all(group.map(async (doc): Promise<ProviderClosureRow> => {
      const pointer = doc.data() as ProviderClosureAccess;
      if (pointer.memberId !== principal.memberId || pointer.officeId !== principal.officeId) throw fail('Entrega indisponível.', 'AUTHORIZATION');
      const release = (await deps.hrDb.collection('providerClosureReleases').doc(pointer.releaseId).get()).data() as ProviderClosureRelease | undefined;
      if (!release || release.employeeUid !== pointer.employeeUid || release.workspaceId !== grant.workspaceId || release.grantId !== grant.id
        || release.memberId !== principal.memberId || release.officeId !== principal.officeId || sha256(release.content) !== release.contentHash) throw fail('Entrega indisponível.');
      let status: ProviderClosureRow['status'] = closure.get('status') !== 'closed' ? 'reopened'
        : closure.get('version') !== release.closureVersion ? 'outdated' : 'available';
      if (status === 'available') {
        try {
          const currentProof = await employmentProof(deps, grant.workspaceId, release.employeeUid);
          if (currentProof.hash !== release.employmentProofHash) status = 'employment_changed';
          else {
            try {
              const fresh = await deps.hrDb.runTransaction((tx) => hrSources(deps, tx, grant.workspaceId, grant.competence, release.employeeUid, Boolean(release.payslip)));
              employerFor(fresh, currentProof.history, currentProof.user, grant, employerCnpj);
              if (sourceHash(fresh) !== release.sourceHash) status = 'outdated';
            } catch (cause) {
              if (!(cause instanceof AppError)) throw cause;
              status = 'outdated';
            }
          }
        }
        catch (cause) {
          if (!(cause instanceof AppError)) throw cause;
          status = 'employment_changed';
        }
      }
      return { releaseId: release.id, employeeUid: release.employeeUid, employeeName: release.content.employee.name, ...(release.content.employee.cpfMasked ? { cpfMasked: release.content.employee.cpfMasked } : {}), closureVersion: release.closureVersion, status, releasedAt: release.createdAt };
    }));
    result.push(...rows);
  }
  return result.sort((left, right) => left.employeeName.localeCompare(right.employeeName));
}
export async function readReleasedClosure(principal: PortalPrincipal, grantId: string, releaseId: string, injected: Partial<ClosureReleaseDependencies> = {}) {
  return (await releaseFor(dependencies(injected), principal, grantId, releaseId)).content;
}
export async function recordClosureAccess(principal: PortalPrincipal, input: ClosureAccessInput, injected: Partial<ClosureReleaseDependencies> = {}) {
  const deps = dependencies(injected);
  const release = await releaseFor(deps, principal, input.grantId, input.releaseId);
  if (input.action === 'download_payslip' && !release.payslip) throw fail('Não há contracheque liberado nesta entrega.', 'NOT_FOUND');
  await grantFor(deps, principal.workspaceId, input.grantId, principal);
  await deps.mainDb.collection('providerPortalAudit').doc(deps.randomId()).create({
    workspaceId: principal.workspaceId, officeId: principal.officeId, memberId: principal.memberId, actorMemberId: principal.memberId,
    actorUid: null, employeeUid: release.employeeUid, event: 'closure_' + input.action, releaseId: release.id,
    employerUnitId: release.employerUnitId, competence: release.competence, closureVersion: release.closureVersion, at: deps.now().toISOString(),
  });
  return release.content;
}
export async function readReleasedPayslip(principal: PortalPrincipal, grantId: string, releaseId: string, injected: Partial<ClosureReleaseDependencies> = {}) {
  const deps = dependencies(injected);
  const release = await releaseFor(deps, principal, grantId, releaseId);
  if (!release.payslip || !deps.readStorage) throw fail('Não há contracheque disponível nesta entrega.', 'NOT_FOUND');
  const bytes = await deps.readStorage(release.payslip.storagePath);
  if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw fail('O contracheque precisa ser um PDF de até 20 MiB.');
  if (bytesHash(bytes) !== release.payslip.sha256) throw fail('O documento falhou na conferência de integridade.');
  await releaseFor(deps, principal, grantId, releaseId);
  return { bytes, filename: 'contracheque-' + release.competence + '.pdf' };
}


/** Internal RH entry point, with the same current release proof used by the external portal. */
export async function readStaffClosureRelease(context: ServerUserContext, releaseId: string, injected: Partial<ClosureReleaseDependencies> = {}, transaction?: Transaction) {
  manager(context);
  if (context.viewAs || !resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin }).allUnits) throw fail('A conferência exige acesso integral do RH.', 'AUTHORIZATION');
  const deps = dependencies(injected);
  const ref = deps.hrDb.collection('providerClosureReleases').doc(releaseId);
  const record = (await (transaction ? transaction.get(ref) : ref.get())).data() as ProviderClosureRelease | undefined;
  if (!record || record.workspaceId !== context.workspace_id) throw fail('Entrega não encontrada.', 'NOT_FOUND');
  return releaseFor(deps, { memberId: record.memberId, officeId: record.officeId, workspaceId: record.workspaceId,
    name: '', email: '', accountType: 'service_provider', profile: 'accounting' }, record.grantId, releaseId, transaction, true);
}
