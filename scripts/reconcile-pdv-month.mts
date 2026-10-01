/** Preview by default. --apply re-fetches, backs up and verifies the selected month. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAccessToken, loadPdvSyncCatalog, syncDayAdmin } from '../functions/src/pdv-sync.js';

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const month = arg('month');
if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Informe --month=YYYY-MM');
const apply = process.argv.includes('--apply');
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Este CLI é exclusivo de manutenção de produção.');
if (arg('env')) process.loadEnvFile(arg('env')!);
const [year, monthNumber] = month.split('-').map(Number);
const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
const dates = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
const nextMonthFirstDay = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
if (dates.at(-1)! >= new Date().toISOString().slice(0, 10)) throw new Error('O mês precisa estar encerrado.');
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'smart-converter-752gf' }, 'pdv-month-maintenance'), 'coala');
const runId = `net-revenue-${month}-${randomUUID()}`;
const output = resolve('.ai-work/development-technology/2026-10-01-pdv-net-revenue', runId);
mkdirSync(output, { recursive: true, mode: 0o700 });
const log = console.log.bind(console);
console.log = () => {}; // The CLI emits summaries; no coupon payloads.
const save = (name: string, value: unknown) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
function encode(value: unknown): unknown {
  if (value instanceof Timestamp) return { $type: 'Timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) return { $type: 'Date', iso: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
const kioskSnapshot = await db.collection('kiosks').limit(51).get();
if (kioskSnapshot.size >= 51) throw new Error('Limite de unidades atingido.');
const excluded = kioskSnapshot.docs.filter(d => !d.data().pdvFilialId).map(d => ({ id: d.id, name: d.data().name }));
const kiosks = kioskSnapshot.docs.filter(d => d.data().pdvFilialId && (!arg('kiosk') || d.id === arg('kiosk')));
if (!kiosks.length) throw new Error('Nenhuma unidade integrada selecionada.');
const [token, catalog] = await Promise.all([getAccessToken(), loadPdvSyncCatalog(db)]);
const plan: { kioskId: string; name: string; filial: string; beforeCents: number; beforeCount: number; afterCents: number; afterCount: number; rows: { date: string; beforeCents: number; beforeCount: number; afterCents: number; afterCount: number; changed: boolean }[] }[] = [];
for (const kiosk of kiosks) {
  const stored = await db.getAll(...dates.map(date => db.collection('salesReports').doc(`sales_sync_${kiosk.id}_${date.replaceAll('-', '_')}`)));
  const unit: typeof plan[number] = { kioskId: kiosk.id, name: String(kiosk.data().name), filial: String(kiosk.data().pdvFilialId), beforeCents: 0, beforeCount: 0, afterCents: 0, afterCount: 0, rows: [] };
  for (const [i, date] of dates.entries()) {
    const result = await syncDayAdmin(date, kiosk.id, unit.filial, db, { accessToken: token, catalog, dryRun: true, mode: 'manual', runId });
    if (result.accounting?.sourceItemsFallbackCount) throw new Error(`Cupom sem total oficial em ${kiosk.id}/${date}`);
    const before = stored[i].data();
    const beforeCents = Number(before?.sourceRevenueCents ?? (before?.items ?? []).reduce((s: number, it: { quantity: number; unitPrice: number }) => s + cents(it.quantity * it.unitPrice), 0));
    const beforeCount = Number(before?.sourceCouponCount ?? Object.values(before?.hourlySales ?? {}).reduce((s: number, x) => s + Number(x), 0));
    const afterCents = result.metrics?.revenueCents ?? 0;
    const afterCount = result.metrics?.couponCount ?? 0;
    if (!afterCount && beforeCount) throw new Error(`Resposta vazia após vendas em ${kiosk.id}/${date}; nenhuma escrita realizada.`);
    unit.rows.push({ date, beforeCents, beforeCount, afterCents, afterCount, changed: beforeCents !== afterCents || beforeCount !== afterCount });
    unit.beforeCents += beforeCents; unit.beforeCount += beforeCount; unit.afterCents += afterCents; unit.afterCount += afterCount;
    log(JSON.stringify({ phase: 'preview', kiosk: kiosk.id, day: date, beforeCents, afterCents, beforeCount, afterCount }));
  }
  plan.push(unit);
}
save('plan.json', { runId, month, apply, excluded, units: plan });
log(JSON.stringify({ phase: 'plan', output, excluded, units: plan.map(({ rows, ...u }) => ({ ...u, changedDays: rows.filter(r => r.changed).length })) }));
if (apply) {
  // All units passed the monetary contract before the first business write.
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  const add = (ref: FirebaseFirestore.DocumentReference) => refs.set(ref.path, ref);
  for (const unit of plan) {
    for (const row of unit.rows.filter(r => r.changed)) {
      const key = `sync_${unit.kioskId}_${row.date.replaceAll('-', '_')}`;
      add(db.collection('salesReports').doc(`sales_${key}`));
      add(db.collection('consumptionReports').doc(`cons_${key}`));
      add(db.collection('pdvSyncReconciliationStates').doc(`${unit.kioskId}_${row.date}`));
    }
    const periods = await db.collection('goalPeriods').where('kioskId', '==', unit.kioskId).where('templateType', '==', 'revenue').where('startDate', '<=', new Date(`${month}-${days}T12:00:00Z`)).orderBy('startDate', 'desc').limit(4).get();
    for (const period of periods.docs) {
      add(period.ref);
      const goals = await db.collection('employeeGoals').where('periodId', '==', period.id).limit(201).get();
      if (goals.size >= 201) throw new Error('Limite de metas individuais atingido.');
      goals.docs.forEach(goal => add(goal.ref));
    }
  }
  const backups = refs.size ? await db.getAll(...refs.values()) : [];
  save('backup.json', { runId, createdAt: new Date().toISOString(), documents: backups.map(d => ({ path: d.ref.path, exists: d.exists, updateTime: d.updateTime?.toDate().toISOString(), data: encode(d.data()) })) });
  const hash = createHash('sha256').update(readFileSync(resolve(output, 'backup.json'))).digest('hex');
  save('backup-integrity.json', { sha256: hash, documents: backups.length });
  const applied = [];
  for (const unit of plan) for (const row of unit.rows.filter(r => r.changed)) {
    const options = { accessToken: token, catalog, mode: 'manual' as const, runId, revenueCorrection: true, expectedMetrics: { revenueCents: row.afterCents, couponCount: row.afterCount } };
    let result = await syncDayAdmin(row.date, unit.kioskId, unit.filial, db, options);
    if (result.persistence === 'held') result = await syncDayAdmin(row.date, unit.kioskId, unit.filial, db, options);
    if (!['applied', 'unchanged'].includes(result.persistence)) throw new Error(`Dia não aplicado: ${unit.kioskId}/${row.date}`);
    if (cents(result.dailyRevenue) !== row.afterCents || result.metrics?.couponCount !== row.afterCount) throw new Error(`Fonte mudou durante a aplicação: ${unit.kioskId}/${row.date}. Confira o registro.`);
    applied.push({ kioskId: unit.kioskId, date: row.date, persistence: result.persistence });
    save('applied.json', applied);
    log(JSON.stringify({ phase: 'apply', ...applied.at(-1) }));
  }
  for (const unit of plan) {
    const reports = await db.getAll(...dates.map(date => db.collection('salesReports').doc(`sales_sync_${unit.kioskId}_${date.replaceAll('-', '_')}`)));
    let total = 0, count = 0;
    for (const [i, report] of reports.entries()) {
      const d = report.data();
      const storedCents = Number(d?.sourceRevenueCents ?? 0);
      const itemCents = (d?.items ?? []).reduce((s: number, it: { quantity: number; unitPrice: number }) => s + cents(it.quantity * it.unitPrice), 0);
      if (storedCents !== unit.rows[i].afterCents || itemCents !== storedCents || Number(d?.sourceCouponCount ?? 0) !== unit.rows[i].afterCount) throw new Error(`Verificação do relatório falhou: ${unit.kioskId}/${dates[i]}`);
      total += storedCents; count += Number(d?.sourceCouponCount ?? 0);
    }
    const periods = await db.collection('goalPeriods').where('kioskId', '==', unit.kioskId).where('templateType', '==', 'revenue').limit(100).get();
    if (periods.size >= 100) throw new Error('Limite de períodos atingido na verificação.');
    const monthly = periods.docs.filter(d => d.data().startDate?.toDate?.().toISOString().slice(0, 7) === month && d.data().endDate?.toDate?.().toISOString().slice(0, 10) === nextMonthFirstDay);
    for (const period of monthly) {
      const progress = period.data().dailyProgress ?? {};
      for (const row of unit.rows) if (cents(progress[row.date]) !== row.afterCents) throw new Error(`Meta diverge do relatório: ${unit.kioskId}/${row.date}`);
    }
    log(JSON.stringify({ phase: 'verified', kiosk: unit.kioskId, totalCents: total, coupons: count, monthlyGoals: monthly.length }));
  }
  save('verified.json', { runId, completedAt: new Date().toISOString(), units: plan.map(({ rows, ...u }) => u) });
}
await db.terminate();
