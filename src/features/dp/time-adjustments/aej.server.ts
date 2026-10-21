import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import { readRepPEmployeeIdentity, readRepPForAej, REP_P_DEVELOPER_CNPJ, signPtrpDetached } from '@/features/dp/rep-p/service.server';
import { bankMonthForAej, bankMovementsForAej } from '@/features/dp/time-bank/service.server';
import { bankLinesWithMovements, overnightWorkDate, type BankManualMovement } from '@/features/dp/time-bank/core';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';

import { aejShiftOf, generateAej, type AejAbsence, type AejEmployee, type AejShift } from './aej';
import type { AejExportInput } from './schemas';
import { AEJ_EXPORTS, CLOSURES, closureKey, TREATMENTS } from './service.server';

/** Nome e versão do PTRP no registro 08; a versão acompanha o atestado técnico quando ele existir. */
export const PTRP_NAME = 'Coala One - Tratamento de Ponto';
export const PTRP_VERSION = '1.0.0';
const DEVELOPER_NAME = 'CT SORVETES LTDA';
const MAX_DAYS = 62;

type Dependencies = { mainDb: Firestore; hrDb: Firestore; developerEmail: string | undefined; readArp: typeof readRepPForAej; readIdentity: typeof readRepPEmployeeIdentity; sign: typeof signPtrpDetached;
  readBank?: (workspaceId: string, competence: string, uid: string, actorUid: string) => ReturnType<typeof bankMonthForAej>;
  readMovements?: (workspaceId: string, uid: string, competences: string[]) => Promise<BankManualMovement[]> };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, developerEmail: process.env.PTRP_DEVELOPER_EMAIL?.trim(), readArp: readRepPForAej, readIdentity: readRepPEmployeeIdentity, sign: signPtrpDetached };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
function months(start: string, end: string) {
  const list: string[] = [];
  for (let cursor = start.slice(0, 7); cursor <= end.slice(0, 7);) {
    list.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  return list;
}
function mondayOf(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}
/** Falha do gerador (ex.: motivo vazio) vira erro público sem detalhe interno. */
function generateAejSafely(input: Parameters<typeof generateAej>[0]) {
  try { return generateAej(input); } catch { throw fail('PTRP_AEJ_INVALID_DATA', 'Há tratamento sem motivo ou dado incompatível com o leiaute; confira os ajustes do período.', 'CONFLICT'); }
}

/**
 * AEJ de um estabelecimento num período de meses já fechados: originais da ARP, desconsiderações e inclusões dos
 * ajustes aprovados (com o motivo de até 150 caracteres) e o horário contratual da escala. Assinado em CAdES
 * destacado pela desenvolvedora e auditado; quem pediu e quem decidiu ficam no fechamento (o leiaute não tem campo).
 */
export async function exportAej(context: ServerUserContext, input: AejExportInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  // Banco apurado nos mesmos bancos de dados do AEJ (o REP-P e o PTRP moram no coala-rh).
  const readBank = deps.readBank ?? ((workspaceId: string, competence: string, uid: string, actorUid: string) =>
    bankMonthForAej(workspaceId, competence, uid, actorUid, { mainDb: deps.mainDb, hrDb: deps.hrDb, repDb: deps.hrDb }));
  const readMovements = deps.readMovements ?? ((workspaceId: string, uid: string, competences: string[]) =>
    bankMovementsForAej(workspaceId, uid, competences, { mainDb: deps.mainDb, hrDb: deps.hrDb, repDb: deps.hrDb }));
  const days = (Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (days < 1 || days > MAX_DAYS) throw fail('PTRP_AEJ_RANGE_INVALID', `Escolha um período de 1 a ${MAX_DAYS} dias.`);
  if (!deps.developerEmail) throw fail('PTRP_AEJ_DEVELOPER_EMAIL_MISSING', 'Configure o e-mail da desenvolvedora do PTRP (PTRP_DEVELOPER_EMAIL) antes de gerar o AEJ.', 'CONFLICT');
  const competences = months(input.startDate, input.endDate);
  // Até seis dias anteriores preservam o teto semanal quando o período começa no meio da semana/competência.
  const bankCompetenceCandidates = months(mondayOf(input.startDate), input.endDate);
  const closures = await deps.hrDb.getAll(...competences.map((competence) => deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, `${competence}-01`))));
  const open = competences.filter((_, index) => closures[index].get('status') !== 'closed');
  if (open.length) throw fail('PTRP_AEJ_COMPETENCE_OPEN', `Feche antes a competência ${open.join(', ')}: o AEJ sai só do tratamento concluído.`, 'CONFLICT');
  const contextCompetences = bankCompetenceCandidates.filter((competence) => !competences.includes(competence));
  const contextClosures = contextCompetences.length ? await deps.hrDb.getAll(...contextCompetences
    .map((competence) => deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, `${competence}-01`)))) : [];
  const bankCompetences = [...contextCompetences.filter((_, index) => contextClosures[index].get('status') === 'closed'), ...competences];

  const arp = await deps.readArp(context.workspace_id, input.establishmentId, input.startDate, input.endDate);
  // O registro 08 usa a razão social fixa da desenvolvedora: só vale com o CNPJ dela no perfil fiscal.
  if (arp.profile.developerCnpj.replace(/\D/g, '') !== REP_P_DEVELOPER_CNPJ) throw fail('PTRP_AEJ_DEVELOPER_MISMATCH', 'O perfil fiscal aponta outra desenvolvedora; confira antes de gerar o AEJ.', 'CONFLICT');
  const people = new Map(arp.people.map((person) => [person.cpf, person]));
  const unmapped = [...new Set(arp.markings.map((item) => item.employeeCpf).filter((cpf) => !people.has(cpf)))];
  if (unmapped.length) throw fail('PTRP_AEJ_MARKING_WITHOUT_CATALOG', 'Há batida na ARP sem comprovante catalogado; o AEJ não pode divergir do AFD. Fale com o desenvolvimento.', 'CONFLICT');
  const treatments = await deps.hrDb.collection(TREATMENTS).where('workspaceId', '==', context.workspace_id).where('establishmentId', '==', input.establishmentId)
    .where('workDate', '>=', input.startDate).where('workDate', '<=', input.endDate).limit(5001).get();
  if (treatments.size > 5000) throw fail('PTRP_AEJ_RANGE_INVALID', 'O período tem tratamentos demais. Divida o intervalo de datas.');
  const active = treatments.docs.map((doc) => doc.data()).filter((item) => item.status === 'active');
  const discards = new Map(active.filter((item) => item.type === 'discard').map((item) => [String(item.originalReceiptId), String(item.motivo)]));
  // Quem só tem inclusão no período (esqueceu o dia inteiro) entra pelo CPF e nome oficiais do RH.
  const known = new Set(arp.people.map((person) => person.uid));
  for (const uid of [...new Set(active.filter((item) => item.type === 'inclusion').map((item) => String(item.employeeUid)))].filter((id) => !known.has(id))) {
    const identity = await deps.readIdentity(uid).catch(() => null);
    if (!identity) throw fail('PTRP_AEJ_IDENTITY_UNRESOLVED', 'Há inclusão aprovada para pessoa sem CPF e nome oficiais no RH; complete o cadastro antes de gerar.', 'CONFLICT');
    people.set(identity.cpf, { cpf: identity.cpf, uid, name: identity.name });
  }
  const persons = [...people.values()];

  const users = persons.length ? await deps.mainDb.getAll(...persons.map((person) => deps.mainDb.collection('users').doc(person.uid))) : [];
  const employees: AejEmployee[] = await Promise.all(persons.map(async (person, index) => {
    const ids = [person.uid, typeof users[index]?.get('hrEmployeeId') === 'string' ? String(users[index].get('hrEmployeeId')) : null];
    const months = await Promise.all(competences.map((competence) => readRepPMonthOfPerson(ids, competence, { db: deps.mainDb })));
    const shifts = months.flatMap((month) => month.shifts)
      .map(aejShiftOf).filter((shift): shift is AejShift => shift !== null && shift.date >= input.startDate && shift.date <= input.endDate);
    // Registro 07: folga sem trabalho como DSR, falta não justificada como "2" e, por dia, a soma dos créditos (inclusão) e dos
    // débitos (compensação) do banco apurado. Qual folga é o DSR da semana e a natureza do débito são pendências do plano.
    const [bank, movements] = await Promise.all([
      Promise.all(bankCompetences.map((competence) => readBank(context.workspace_id, competence, person.uid, context.decoded.uid))),
      readMovements(context.workspace_id, person.uid, bankCompetences),
    ]);
    const bankDays = bank.flatMap((month) => month.days);
    const bankLines = bankLinesWithMovements(bank, movements)
      .filter((item) => item.date >= input.startDate && item.date <= input.endDate);
    const bankDates = [...new Set(bankLines.map((item) => item.date))];
    const absences: AejAbsence[] = [
      ...bankDays.filter((day) => day.kind === 'rest_day' && !day.workedMinutes).map((day) => ({ date: day.date, kind: '1' as const })),
      ...bankDays.filter((day) => day.unjustifiedAbsence).map((day) => ({ date: day.date, kind: '2' as const })),
      ...bankDates.flatMap((date) => (['bank_credit', 'bank_debit'] as const).flatMap((nature) => {
        const minutes = bankLines.filter((item) => item.date === date && item.line.nature === nature)
          .reduce((total, item) => total + item.line.minutes, 0);
        return minutes ? [{ date, kind: '3' as const, minutes, movement: nature === 'bank_credit' ? '1' as const : '2' as const }] : [];
      })),
    ];
    return {
      cpf: person.cpf, name: person.name, shifts, absences, pendingDays: bankDays.filter((day) => day.issues.includes('MISSING_DAY')).map((day) => day.date),
      markings: arp.markings.filter((item) => item.employeeCpf === person.cpf)
        .map((item) => ({ workDate: overnightWorkDate(item.workDate, item.markedAt, shifts), markedAt: item.markedAt,
          nsr: item.nsr, discardReason: discards.get(item.receiptId) ?? null })),
      inclusions: active.filter((item) => item.type === 'inclusion' && item.employeeUid === person.uid && item.markedAt)
        .map((item) => ({ workDate: String(item.workDate), markedAt: String(item.markedAt), reason: String(item.motivo) })),
    };
  }));
  const cno = arp.profile.cnoCaepf?.replace(/\D/g, '') ?? '';
  const pkg = generateAejSafely({
    employer: { cnpj: arp.profile.employerCnpj, legalName: arp.profile.employerLegalName, caepf: cno.length === 14 ? cno : null, cno: cno.length === 12 ? cno : null },
    startDate: input.startDate, endDate: input.endDate, generatedAt: arp.generatedAt, rep: { inpiRegistration: arp.profile.inpiRegistration },
    ptrp: { name: PTRP_NAME, version: PTRP_VERSION, developerCnpj: arp.profile.developerCnpj, developerName: DEVELOPER_NAME, developerEmail: deps.developerEmail },
    employees,
  });
  const signed = await deps.sign(pkg.bytes);
  await deps.hrDb.collection(AEJ_EXPORTS).add({ schemaVersion: 1, workspaceId: context.workspace_id, establishmentId: input.establishmentId,
    startDate: input.startDate, endDate: input.endDate, generatedAt: arp.generatedAt, actorId: context.decoded.uid, layoutVersion: '002',
    filename: pkg.filename, sha256: pkg.sha256, certificateCnpj: signed.certificateCnpj, counts: pkg.counts, lineCount: pkg.lineCount,
    warnings: pkg.warnings.length, closureVersions: Object.fromEntries(competences.map((competence, index) => [competence, closures[index].get('version')])), createdAt: new Date().toISOString() });
  return { filename: pkg.filename, aejBase64: pkg.bytes.toString('base64'), sha256: pkg.sha256, signatureFilename: pkg.signatureFilename,
    signatureBase64: Buffer.from(signed.bytes).toString('base64'), certificateCnpj: signed.certificateCnpj, counts: pkg.counts, lineCount: pkg.lineCount, warnings: pkg.warnings };
}
