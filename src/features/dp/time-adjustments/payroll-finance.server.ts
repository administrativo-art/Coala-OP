import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { financialDbAdmin } from '@/lib/firebase-financial-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { financialExpenseCompetenceMonth } from '@/features/financial/lib/expense-accounting-contract';
import { personAllocationsAreValid, type ExpensePersonAllocation } from '@/features/financial/lib/expense-person-allocations';
import { readStaffClosureRelease } from '@/features/service-portal/closure-server';
import { readRosterHistories, resolveRosterEmploymentOnDate } from '@/features/dp/employment-reference/service.server';
import { assertCurrentPayslipReconciliation, assertPayslipReconciliationManager, type PayslipReconciliationDependencies } from './payslip-reconciliation.server';
import { sha256, competenceRange } from './closure-core';
import { payrollFinanceQuerySchema, payrollFinanceOptionsSchema, payrollFinancePreviewSchema, payrollFinanceSubmitSchema, strictMoneyCents, comparePayrollMoney,
  type PayrollFinanceQuery, type PayrollFinancePreviewInput, type PayrollFinanceSubmitInput, type PayrollFinanceComparison } from './payroll-finance';

type Row = Record<string, unknown>;
type Dependencies = { mainDb: Firestore; hrDb: Firestore; financialDb: Firestore; now: () => Date; randomId: () => string;
  readStorage: (path: string) => Promise<Buffer>; reconciliation?: Partial<PayslipReconciliationDependencies> };
function dependencies(injected: Partial<Dependencies>) {
  return { mainDb: dbAdmin, hrDb: hrDbAdmin, financialDb: financialDbAdmin, now: () => new Date(), randomId: randomUUID,
    readStorage: async (path: string) => (await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download())[0], ...injected };
}
function fail(message: string, kind: 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' = 'CONFLICT') { return new AppError({ code: 'PAYROLL_FINANCE_REVIEW', kind, safeMessage: message }); }
export function assertPayrollFinanceAccess(context: ServerUserContext, write = false) {
  assertPayslipReconciliationManager(context);
  const finance = context.permissions.financial;
  if (!context.isDefaultAdmin && (!finance?.view || !finance.expenses?.view || !finance.personnelCosts?.view || write && !finance.expenses.edit)) throw fail('A conferência exige acesso ao Financeiro e às despesas, além da revisão do RH.', 'AUTHORIZATION');
}
const digits = (value: unknown) => typeof value === 'string' ? value.replace(/\D/g, '') : '';
function stateId(workspaceId: string, query: PayrollFinanceQuery) { return sha256(query.mode === 'salary' ? [workspaceId, query.mode, query.competence, query.employeeUid] : [workspaceId, query.mode, query.expenseId]); }
function scalar(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(scalar);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scalar(item)]));
  return value;
}
function expenseFingerprint(row: Row) {
  return sha256(scalar(Object.fromEntries(['workspaceId', 'status', 'deletedAt', 'provisionType', 'provisionCompetence', 'competenceMonth', 'competenceDate', 'payrollEarningType', 'employeeId', 'employeeUserId', 'payrollIdentityKey', 'beneficiaryReference', 'employerUnitId', 'employerCnpj', 'totalValue', 'netPayableValue', 'hasPersonAllocations', 'personAllocations', 'hasAccountAllocations', 'accountAllocations', 'accountId', 'accountPlan', 'fiscalIdentity'].map((key) => [key, key === 'status' && ['pending', 'paid', 'partially_paid'].includes(String(row[key])) ? 'active' : row[key] ?? null]))));
}
async function hrProof(deps: ReturnType<typeof dependencies>, context: ServerUserContext, query: PayrollFinanceQuery) {
  const injected = { mainDb: deps.mainDb, hrDb: deps.hrDb, now: deps.now, readStorage: deps.readStorage, ...deps.reconciliation };
  const proof = await assertCurrentPayslipReconciliation(context, { ...query, closureVersion: await closureVersion(deps, context, query.competence) }, injected);
  const release = await readStaffClosureRelease(context, proof.stamp.releaseId, { mainDb: deps.mainDb, hrDb: deps.hrDb, now: deps.now, readStorage: deps.readStorage, ...deps.reconciliation?.releaseDependencies });
  return { proof, release };
}
const FINANCE_CLOSURES = 'ptrp_competenceClosures';
const FINANCE_PEOPLE = 'people';
function financeClosures(db: Firestore) { return db.collection(FINANCE_CLOSURES); }
function financePeople(ref: DocumentReference) { return ref.collection(FINANCE_PEOPLE); }
async function closureVersion(deps: ReturnType<typeof dependencies>, context: ServerUserContext, competence: string) {
  // Exact workspace/month record; source proof below validates the immutable version and participant.
  const record = await financeClosures(deps.hrDb).doc(context.workspace_id + '_' + competence).get();
  if (record.get('workspaceId') !== context.workspace_id || record.get('status') !== 'closed' || !Number.isSafeInteger(record.get('version'))) throw fail('Feche e confira esta competência antes da conciliação.');
  return record.get('version') as number;
}
async function expenseSource(deps: ReturnType<typeof dependencies>, context: ServerUserContext, query: PayrollFinanceQuery, tx?: Transaction) {
  const ref = deps.financialDb.collection('expenses').doc(query.expenseId);
  const doc = await (tx ? tx.get(ref) : ref.get()); const row = doc.data();
  if (!row || row.workspaceId !== context.workspace_id) throw fail('Título não encontrado neste workspace.', 'NOT_FOUND');
  if (row.deletedAt || ['draft', 'provisioned', 'cancelled', 'reconciled', 'archived'].includes(row.status) || row.provisionType === 'forecast'
    || !['pending', 'paid', 'partially_paid'].includes(row.status)) throw fail('Selecione um título efetivo, ativo e da competência informada.');
  if (financialExpenseCompetenceMonth(row) !== query.competence || row.provisionCompetence && row.provisionCompetence !== query.competence) throw fail('A competência do título não corresponde à folha.');
  let nominalCents: number, payableCents: number;
  try { nominalCents = strictMoneyCents(row.totalValue); payableCents = row.netPayableValue === null || row.netPayableValue === undefined ? nominalCents : strictMoneyCents(row.netPayableValue); }
  catch { throw fail('O título precisa ter valor nominal e valor a pagar válidos.'); }
  return { doc, row, nominalCents, payableCents, fingerprint: expenseFingerprint(row) };
}
async function salaryIdentity(deps: ReturnType<typeof dependencies>, context: ServerUserContext, query: PayrollFinanceQuery, source: Awaited<ReturnType<typeof expenseSource>>, hr: Awaited<ReturnType<typeof hrProof>>, tx?: Transaction) {
  const employeeId = hr.proof.document.employeeId;
  const aliases = [query.employeeUid, employeeId]; const row = source.row;
  if (row.provisionType !== 'actual' || row.payrollEarningType !== 'salary' || !aliases.includes(row.employeeId)
    || row.employeeUserId && row.employeeUserId !== query.employeeUid || row.provisionCompetence !== query.competence
    || row.employerUnitId && row.employerUnitId !== hr.release.employerUnitId || row.employerCnpj && digits(row.employerCnpj) !== hr.release.content.employer.cnpj) throw fail('O título salarial não comprova esta pessoa, competência e empregador.');
  if (row.payrollIdentityKey && row.payrollIdentityKey !== `payroll:salary:${query.competence}:${row.employeeId}`) throw fail('A identidade da despesa salarial está inconsistente.');
  const beneficiary = row.beneficiaryReference;
  if (beneficiary && (beneficiary.sourceType !== 'employee' || beneficiary.sourceId !== employeeId)) throw fail('O favorecido do título não corresponde ao cadastro RH.');
  if (!row.employeeUserId && !beneficiary) {
    const rawId = String(row.employeeId);
    const [asUser, asEmployee] = await Promise.all([deps.mainDb.collection('users').doc(rawId).get(), deps.hrDb.collection('employees').doc(rawId).get()]);
    if (asUser.exists && asUser.id !== query.employeeUid || asEmployee.exists && asEmployee.id !== employeeId) throw fail('O identificador legado do título está ambíguo entre usuários e RH. Confirme o vínculo no cadastro financeiro.');
  }
  const lookup = deps.financialDb.collection('expenses').where('workspaceId', '==', context.workspace_id).where('employeeId', 'in', [...new Set(aliases)])
    .where('provisionCompetence', '==', query.competence).where('payrollEarningType', '==', 'salary').limit(11);
  const candidates = await (tx ? tx.get(lookup) : lookup.get());
  if (candidates.size > 10 || candidates.docs.filter((doc) => !doc.get('deletedAt') && doc.get('provisionType') === 'actual' && ['pending', 'paid', 'partially_paid'].includes(doc.get('status'))).length !== 1) throw fail('Há títulos salariais ausentes ou duplicados para esta pessoa e competência. Resolva a duplicidade no financeiro.');
}
type GuideDocument = { guideIdentity: string; messageId: string; attachmentId: string; sha256: string; name: string; storagePath: string; size: number };
async function guideDocuments(deps: ReturnType<typeof dependencies>, context: ServerUserContext, query: PayrollFinanceQuery, employerCnpj: string, titleIdentity: { documentKind?: unknown; documentNumber?: unknown }, tx?: Transaction) {
  const lookup = deps.financialDb.collection('financialInboxMessages').where('workspaceId', '==', context.workspace_id).where('linkedExpenseId', '==', query.expenseId).limit(21);
  const messages = await (tx ? tx.get(lookup) : lookup.get()); if (messages.size > 20) throw fail('O título tem mais documentos vinculados que a consulta comporta.');
  if (!context.isDefaultAdmin && !context.permissions.financial?.inbox?.view) throw fail('A consulta da guia exige acesso à caixa financeira.', 'AUTHORIZATION');
  const titleKind = titleIdentity.documentKind;
  const titleNumber = String(titleIdentity.documentNumber ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!['fgts', 'darf'].includes(String(titleKind)) || !/^[A-Z0-9]{3,100}$/.test(titleNumber)) throw fail('Confirme o tipo e o número da guia no título financeiro antes da conferência.');
  const result: GuideDocument[] = [];
  for (const message of messages.docs) {
    const classification = message.get('classification');
    if (!['fgts', 'inss_darf'].includes(classification?.documentType) || classification?.competence !== query.competence
      || digits(classification?.fiscalIdentity?.taxpayerTaxId) !== employerCnpj || !message.get('reviewedAt')) continue;
    const reference = String(classification.fiscalIdentity.documentNumber ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!/^[A-Z0-9]{3,100}$/.test(reference)) continue;
    const kind = classification.fiscalIdentity.documentKind;
    if (kind !== titleKind || reference !== titleNumber || (kind === 'fgts' ? classification.documentType !== 'fgts' : classification.documentType !== 'inss_darf')) continue;
    const guideIdentity = [kind, employerCnpj, query.competence, reference].join(':');
    const attachments = message.get('attachments'); if (!Array.isArray(attachments) || attachments.length > 100) continue;
    // A message-level classification cannot identify one of several PDFs. Require a
    // single stored PDF plus a human transcription tied to its exact ID/hash below.
    const pdfs = attachments.filter((file) => file.contentType === 'application/pdf');
    if (pdfs.length !== 1) continue;
    for (const file of pdfs) if (file.archiveStatus === 'stored' && file.contentType === 'application/pdf' && typeof file.storagePath === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)
      && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 20 * 1024 * 1024) result.push({ guideIdentity, messageId: message.id, attachmentId: file.id, sha256: file.sha256, name: file.documentNaming?.downloadName || file.filename || 'Guia', storagePath: file.storagePath, size: file.size });
  }
  return result;
}
function guideAccountsValid(row: Row) {
  if (row.hasAccountAllocations !== true) return true;
  if (!Array.isArray(row.accountAllocations) || row.accountAllocations.length < 2) return false;
  const ids = row.accountAllocations.map((item) => item?.accountPlanId);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  try { return row.accountAllocations.reduce((sum, item) => sum + strictMoneyCents(item.amount), 0) === strictMoneyCents(row.totalValue); } catch { return false; }
}
async function guidePeople(deps: ReturnType<typeof dependencies>, context: ServerUserContext, query: PayrollFinanceQuery, row: Row, employerId: string, employerCnpj: string) {
  if (row.hasPersonAllocations !== true || !Array.isArray(row.personAllocations) || !row.personAllocations.length || row.personAllocations.length > 1500) throw fail('A guia exige individualização por colaborador antes da conferência.');
  const lines = row.personAllocations as ExpensePersonAllocation[];
  if (lines.some((line) => !line.employeeId || !['employer_cost', 'employee_deduction', 'informational'].includes(line.analysisType))) throw fail('A individualização tem identidade ou natureza analítica incompleta.');
  const ids = [...new Set(lines.map((line) => line.employeeId))]; if (ids.length > 450) throw fail('A guia excede 450 pessoas.');
  // An explicit source ID may be a UID or an RH ID. Only reciprocal links establish equivalence.
  const main = await deps.mainDb.getAll(...ids.map((id) => deps.mainDb.collection('users').doc(id)));
  const functional = await deps.hrDb.getAll(...ids.map((id) => deps.hrDb.collection('employees').doc(id)));
  const links = new Map<string, { uid: string; employeeId: string }>();
  for (let index = 0; index < ids.length; index++) {
    if (main[index].exists && functional[index].exists && (main[index].get('hrEmployeeId') !== ids[index] || [functional[index].get('auth_uid'), functional[index].get('source_user_id')].filter(Boolean).some((uid) => uid !== ids[index]))) throw fail('Um identificador da individualização está ambíguo entre usuários e RH.');
    if (main[index].exists && typeof main[index].get('hrEmployeeId') === 'string') links.set(ids[index], { uid: ids[index], employeeId: main[index].get('hrEmployeeId') });
    else if (functional[index].exists) {
      const candidates = [...new Set([functional[index].get('auth_uid'), functional[index].get('source_user_id')].filter((value) => typeof value === 'string' && Boolean(value)))];
      if (candidates.length !== 1) throw fail('Há identidade ambígua na individualização da guia.');
      links.set(ids[index], { uid: candidates[0], employeeId: ids[index] });
    } else throw fail('Uma pessoa individualizada não tem vínculo canônico com o RH.');
  }
  const resolved = [...links.values()];
  const functionalByUid = new Map<string, string>();
  const userByFunctional = new Map<string, string>();
  for (const person of resolved) {
    if (functionalByUid.has(person.uid) && functionalByUid.get(person.uid) !== person.employeeId || userByFunctional.has(person.employeeId) && userByFunctional.get(person.employeeId) !== person.uid) throw fail('A individualização associa cadastros RH diferentes à mesma pessoa. Confirme cada vínculo antes de conferir.');
    functionalByUid.set(person.uid, person.employeeId); userByFunctional.set(person.employeeId, person.uid);
  }
  const unique = [...new Map(resolved.map((person) => [person.uid, person])).values()];
  if (unique.length > 450) throw fail('A guia excede o limite de participantes.');
  const users = await deps.mainDb.getAll(...unique.map((person) => deps.mainDb.collection('users').doc(person.uid)));
  const employees = await deps.hrDb.getAll(...unique.map((person) => deps.hrDb.collection('employees').doc(person.employeeId)));
  const histories = await readRosterHistories(deps.mainDb, context.workspace_id, unique.map((person) => person.uid));
  const { end } = competenceRange(query.competence);
  for (let index = 0; index < unique.length; index++) {
    const person = unique[index], user = users[index], employee = employees[index], history = histories.get(person.uid);
    const reciprocal = [employee.get('auth_uid'), employee.get('source_user_id')].filter(Boolean);
    if (!user.exists || user.get('hrEmployeeId') !== person.employeeId || !employee.exists || !reciprocal.length || reciprocal.some((uid) => uid !== person.uid) || !history) throw fail('A individualização não tem vínculo RH recíproco e histórico publicado.');
    let matched = false;
    for (let day = 1; day <= Number(end.slice(-2)); day++) {
      const date = query.competence + '-' + String(day).padStart(2, '0');
      if (!history.periods.some((period) => period.validFrom <= date && (!period.validTo || period.validTo >= date))) continue;
      const employment = resolveRosterEmploymentOnDate(history, user.data()!, date);
      if (employment.status !== 'matched' || employment.period.employerUnitId !== employerId || digits(employment.period.employer.cnpj) !== employerCnpj) throw fail('Uma pessoa da guia tem empregador diferente ou histórico incompleto na competência.');
      matched = true;
    }
    if (!matched) throw fail('Uma pessoa da guia não tem vínculo demonstrado na competência.');
  }
  const version = await closureVersion(deps, context, query.competence);
  const frozen = financeClosures(deps.hrDb).doc(context.workspace_id + '_' + query.competence).collection('versions').doc(String(version));
  const roster = await deps.hrDb.getAll(...unique.map((person) => financePeople(frozen).doc(person.uid)));
  if (roster.some((doc, index) => !doc.exists || doc.get('uid') !== unique[index].uid)) throw fail('Uma pessoa individualizada não pertence à equipe congelada desta versão.');
  let allocationCents = 0;
  try { for (const line of lines) allocationCents += strictMoneyCents(line.amount); }
  catch { throw fail('A individualização tem valor monetário ausente ou inválido.'); }
  return { employeeUids: unique.map((person) => person.uid), employeeIds: unique.map((person) => person.employeeId), allocationCents,
    allocationsValid: personAllocationsAreValid(row) && guideAccountsValid(row), lines: lines.map((line) => ({ employeeUid: links.get(line.employeeId)!.uid, employeeId: links.get(line.employeeId)!.employeeId, employeeName: String(users.find((doc) => doc.id === links.get(line.employeeId)!.uid)?.get('username') ?? 'Colaborador'), accountName: line.accountPlanName || 'Conta contábil', accountId: line.accountPlanId, analysisType: line.analysisType, amountCents: strictMoneyCents(line.amount) })),
    proofHash: sha256(unique.map((person, index) => ({ person, history: histories.get(person.uid), user: scalar({ hrEmployeeId: users[index].get('hrEmployeeId'), contractualDataPeriods: users[index].get('contractualDataPeriods') ?? null, operationalUnitPeriods: users[index].get('operationalUnitPeriods') ?? null, operationalUnitCutoverDate: users[index].get('operationalUnitCutoverDate') ?? null, scheduledContractChange: users[index].get('scheduledContractChange') ?? null }) }))) };
}
async function sources(deps: ReturnType<typeof dependencies>, context: ServerUserContext, query: PayrollFinanceQuery) {
  const hr = await hrProof(deps, context, query); const expense = await expenseSource(deps, context, query);
  const employer = hr.release.content.employer;
  if (query.mode === 'salary') await salaryIdentity(deps, context, query, expense, hr);
  else if (digits(expense.row.fiscalIdentity?.taxpayerTaxId) !== employer.cnpj) throw fail('O contribuinte da guia não corresponde ao empregador da folha.');
  const guide = query.mode === 'guide' ? await guidePeople(deps, context, query, expense.row, employer.unitId, employer.cnpj) : null;
  const documents = query.mode === 'guide' ? await guideDocuments(deps, context, query, employer.cnpj, expense.row.fiscalIdentity) : [];
  return { hr, expense, guide, documents, employer };
}
async function preview(context: ServerUserContext, input: PayrollFinancePreviewInput, deps: ReturnType<typeof dependencies>) {
  const source = await sources(deps, context, input);
  const file = input.mode === 'guide' ? source.documents.find((doc) => doc.messageId === input.document?.messageId && doc.attachmentId === input.document?.attachmentId && doc.sha256 === input.document?.sha256) : null;
  if (input.mode === 'guide' && !file) throw fail('Selecione uma guia PDF vinculada, revisada e com identidade fiscal confirmada.');
  if (file && input.document) {
    const transcribedNumber = input.document.documentNumber.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const transcribedIdentity = [input.document.documentKind, digits(input.document.taxpayerCnpj), input.document.competence, transcribedNumber].join(':');
    if (transcribedIdentity !== file.guideIdentity) throw fail('Tipo, número, contribuinte ou competência lidos no PDF diferem da guia vinculada ao título.');
    const bytes = await deps.readStorage(file.storagePath);
    if (bytes.length !== file.size || bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw fail('O PDF da guia falhou na conferência de integridade.');
  }
  const comparison = comparePayrollMoney({ mode: input.mode, documentCents: input.amountCents, nominalCents: source.expense.nominalCents, payableCents: source.expense.payableCents,
    allocationCents: source.guide?.allocationCents, allocationsValid: source.guide?.allocationsValid });
  const evidence = { stamp: source.hr.proof.stamp, releaseSourceHash: source.hr.release.sourceHash, releaseEmploymentProofHash: source.hr.release.employmentProofHash,
    employer: source.employer, expenseHash: source.expense.fingerprint, guideHash: source.guide?.proofHash ?? null,
    document: file ? { messageId: file.messageId, attachmentId: file.attachmentId, sha256: file.sha256, guideIdentity: file.guideIdentity } : { documentId: source.hr.proof.document.id, sha256: source.hr.proof.document.sha256, version: source.hr.proof.document.version } };
  return { source, file, comparison, sourceHash: sha256(evidence), evidence };
}
export async function previewPayrollFinance(context: ServerUserContext, raw: PayrollFinancePreviewInput, injected: Partial<Dependencies> = {}) {
  assertPayrollFinanceAccess(context); const input = payrollFinancePreviewSchema.parse(raw); const result = await preview(context, input, dependencies(injected));
  return { comparison: result.comparison, sourceHash: result.sourceHash, employer: result.source.employer, lines: result.source.guide?.lines ?? [],
    expense: { id: input.expenseId, description: String(result.source.expense.row.description ?? 'Título financeiro'), paymentStatus: String(result.source.expense.row.status) }, documentName: result.file?.name ?? result.source.hr.proof.document.name };
}
type Revision = { referenceEmployeeUid: string; referenceEmployeeId: string; lines: Array<{ employeeUid: string; employeeId: string; accountId: string; analysisType: string; amountCents: number }>; subjectKeys: string[]; id: string; stateId: string; workspaceId: string; employeeUids: string[]; employeeIds: string[]; competence: string; employerUnitId: string; mode: 'salary' | 'guide'; expenseId: string; input: PayrollFinancePreviewInput; inputHash: string; sourceHash: string; comparison: PayrollFinanceComparison; evidence: Row; createdAt: string; createdBy: string; requestId: string; previousRevisionId: string | null };
export async function submitPayrollFinance(context: ServerUserContext, raw: PayrollFinanceSubmitInput, injected: Partial<Dependencies> = {}) {
  assertPayrollFinanceAccess(context, true); const input = payrollFinanceSubmitSchema.parse(raw); const deps = dependencies(injected);
  const { requestId, expectedVersion, expectedSourceHash, ...transcription } = input;
  const inputHash = sha256({ actor: context.decoded.uid, workspaceId: context.workspace_id, input });
  const result = await preview(context, transcription, deps);
  if (result.sourceHash !== expectedSourceHash) throw fail('Uma fonte mudou. Confira uma nova prévia.');
  const key = stateId(context.workspace_id, input);
  const ref = deps.financialDb.collection('payrollFinancialReviews').doc(requestId);
  return deps.financialDb.runTransaction(async (tx) => {
    const stateRef = deps.financialDb.collection('payrollFinancialReviewState').doc(key);
    const [existing, state, expense] = await Promise.all([tx.get(ref), tx.get(stateRef), expenseSource(deps, context, input, tx)]);
    if (existing.exists) { if (existing.get('inputHash') !== inputHash || existing.get('workspaceId') !== context.workspace_id) throw fail('A tentativa já foi usada para outra conferência.'); return { id: existing.id, comparison: existing.get('comparison') as PayrollFinanceComparison }; }
    if ((state.get('version') ?? 0) !== expectedVersion) throw fail('A conferência financeira mudou. Atualize a tela.');
    if (expense.fingerprint !== result.source.expense.fingerprint) throw fail('O título financeiro mudou durante a conferência.');
    if (input.mode === 'salary') await salaryIdentity(deps, context, input, expense, result.source.hr, tx);
    else {
      const documents = await guideDocuments(deps, context, input, result.source.employer.cnpj, expense.row.fiscalIdentity, tx);
      if (!documents.some((doc) => doc.messageId === input.document!.messageId && doc.attachmentId === input.document!.attachmentId && doc.sha256 === input.document!.sha256 && doc.storagePath === result.file!.storagePath && doc.size === result.file!.size && doc.guideIdentity === result.file!.guideIdentity)) throw fail('O documento da guia mudou durante a conferência.');
    }
    const documentIdentity = input.mode === 'salary' ? [result.source.hr.proof.document.employeeId, result.source.hr.proof.document.id] : [context.workspace_id, input.document!.sha256];
    const claims = [sha256([context.workspace_id, 'title', input.expenseId]), sha256([context.workspace_id, 'document', ...documentIdentity]), ...(result.file ? [sha256([context.workspace_id, 'guide-identity', result.file.guideIdentity])] : [])];
    const claimDocs = await Promise.all(claims.map((id) => tx.get(deps.financialDb.collection('payrollFinancialReviewClaims').doc(id))));
    if (claimDocs.some((doc) => doc.exists && (doc.get('stateId') !== key || doc.get('workspaceId') !== context.workspace_id))) throw fail('Este título ou documento já foi usado em outra conferência. Confira a duplicidade.');
    const at = deps.now().toISOString(), employeeUids = result.source.guide?.employeeUids ?? [input.employeeUid], employeeIds = result.source.guide?.employeeIds ?? [result.source.hr.proof.document.employeeId];
    const subjectKeys = [...employeeUids.map((uid) => 'main.users:' + uid), ...employeeIds.map((id) => 'hr.employees:' + id)];
    const reference = { referenceEmployeeUid: input.employeeUid, referenceEmployeeId: result.source.hr.proof.document.employeeId };
    const record: Revision = { ...reference, lines: result.source.guide?.lines ?? [], subjectKeys, id: ref.id, stateId: key, workspaceId: context.workspace_id, employeeUids, employeeIds, competence: input.competence, employerUnitId: result.source.employer.unitId, mode: input.mode,
      expenseId: input.expenseId, input: transcription, inputHash, sourceHash: result.sourceHash, comparison: result.comparison, evidence: result.evidence, createdAt: at, createdBy: context.decoded.uid, requestId, previousRevisionId: state.get('currentRevisionId') ?? null };
    tx.create(ref, record);
    tx.set(stateRef, { ...reference, subjectKeys, id: key, workspaceId: context.workspace_id, employeeUids, employeeIds, competence: input.competence, mode: input.mode, employerUnitId: result.source.employer.unitId, expenseId: input.expenseId,
      version: (state.get('version') ?? 0) + 1, currentRevisionId: ref.id, updatedAt: at, updatedBy: context.decoded.uid });
    for (const claim of claimDocs) tx.set(claim.ref, { ...reference, subjectKeys, workspaceId: context.workspace_id, stateId: key, employeeUids, employeeIds, updatedBy: context.decoded.uid, revisionId: ref.id, updatedAt: at });
    return { id: ref.id, comparison: record.comparison };
  });
}
export async function readPayrollFinance(context: ServerUserContext, raw: PayrollFinanceQuery, injected: Partial<Dependencies> = {}) {
  assertPayrollFinanceAccess(context); const query = payrollFinanceQuerySchema.parse(raw); const deps = dependencies(injected);
  const source = await sources(deps, context, query);
  const state = await deps.financialDb.collection('payrollFinancialReviewState').doc(stateId(context.workspace_id, query)).get();
  let current: { id: string; status: 'match' | 'divergent' | 'stale'; comparison: PayrollFinanceComparison; createdAt: string } | null = null;
  if (state.get('currentRevisionId')) {
    const record = (await deps.financialDb.collection('payrollFinancialReviews').doc(state.get('currentRevisionId')).get()).data() as Revision | undefined;
    if (!record || record.workspaceId !== context.workspace_id || record.stateId !== state.id) throw fail('A conferência financeira atual está incompleta.');
    let status: 'match' | 'divergent' | 'stale' = record.comparison.status;
    try { const fresh = await preview(context, record.input, deps); if (fresh.sourceHash !== record.sourceHash) status = 'stale'; }
    catch (cause) { if (!(cause instanceof AppError) || !['CONFLICT', 'AUTHORIZATION', 'NOT_FOUND'].includes(cause.kind)) throw cause; status = 'stale'; }
    current = { id: record.id, status, comparison: record.comparison, createdAt: record.createdAt };
  }
  return { version: state.get('version') ?? 0, canWrite: context.isDefaultAdmin || context.permissions.financial?.expenses?.edit === true, current, employer: source.employer,
    expense: { id: query.expenseId, description: String(source.expense.row.description ?? 'Título financeiro'), nominalCents: source.expense.nominalCents, payableCents: source.expense.payableCents, fiscalDocumentKind: source.expense.row.fiscalIdentity?.documentKind ?? null, fiscalDocumentNumber: source.expense.row.fiscalIdentity?.documentNumber ?? null, paymentStatus: String(source.expense.row.status) },
    documents: source.documents.map(({ messageId, attachmentId, sha256: hash, name }) => ({ messageId, attachmentId, sha256: hash, name })),
    payslip: { id: source.hr.proof.document.id, name: source.hr.proof.document.name, version: source.hr.proof.document.version, sha256: source.hr.proof.document.sha256 },
    lines: source.guide?.lines ?? [], allocationsValid: source.guide?.allocationsValid ?? null };
}


export async function listPayrollFinanceTitles(context: ServerUserContext, raw: {mode:'salary'|'guide';competence:string;employeeUid:string}, injected: Partial<Dependencies> = {}) {
  assertPayrollFinanceAccess(context);const input=payrollFinanceOptionsSchema.parse(raw),deps=dependencies(injected);
  const hr=await hrProof(deps,context,{...input,expenseId:'discovery'});
  const employer=hr.release.content.employer;
  if(input.mode==='guide' && !context.isDefaultAdmin && !context.permissions.financial?.inbox?.view)throw fail('A consulta da guia exige acesso à caixa financeira.','AUTHORIZATION');
  const formatted=employer.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
  const query=input.mode==='salary'
    ? deps.financialDb.collection('expenses').where('workspaceId','==',context.workspace_id).where('employeeId','in',[...new Set([input.employeeUid,hr.proof.document.employeeId])]).where('provisionCompetence','==',input.competence).where('payrollEarningType','==','salary').limit(11)
    : deps.financialDb.collection('expenses').where('workspaceId','==',context.workspace_id).where('fiscalIdentity.taxpayerTaxId','in',[...new Set([employer.cnpj,formatted])]).where('competenceMonth','==',input.competence).limit(51);
  const docs=await query.get();if(docs.size>(input.mode==='salary'?10:50))throw fail('A consulta de títulos excedeu o limite. Revise a competência no financeiro.');
  const titles=docs.docs.filter((doc)=>!doc.get('deletedAt')&&doc.get('provisionType')!=='forecast'&&['pending','paid','partially_paid'].includes(doc.get('status')))
    .map((doc)=>({id:doc.id,description:String(doc.get('description')||'Título financeiro'),amountCents:strictMoneyCents(doc.get('totalValue')),paymentStatus:String(doc.get('status'))}));
  return {employer,titles};
}
