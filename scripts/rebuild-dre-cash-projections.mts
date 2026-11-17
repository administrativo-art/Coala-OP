/** Rebuild only derived cash-difference fields. Default: dry-run; see flows/dre.md. */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { config } from "dotenv";
import { FieldPath } from "firebase-admin/firestore";
import { buildCashClosureOperators, withCashClosureOperatorAggregate } from "../src/features/financial/cash-closures/operators";
import { summarizeCashClosureDre } from "../src/features/financial/cash-closures/dre-contract";
import type { CashClosure, CashClosureLine, CashClosureOperator } from "../src/features/financial/cash-closures/types";

const args = process.argv.slice(2);
const option = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const projectId = option("project");
const databaseId = "coala-financeiro";
const workspaceId = option("workspace");
const kioskId = option("kiosk");
const period = option("period");
const apply = args.includes("--apply");
const verify = args.includes("--verify");
const plan = option("plan");
const backup = option("backup");
if (!projectId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)
  || !workspaceId || !kioskId || !period || !/^[\w-]{1,100}$/.test(workspaceId)
  || !/^[\w-]{1,100}$/.test(kioskId) || !/^20\d\d-(0[1-9]|1[0-2])$/.test(period)) {
  throw new Error("Informe --project=PROJECT_ID --workspace=ID --kiosk=ID --period=YYYY-MM.");
}
if (apply && verify || apply && (!plan || !/^[a-f0-9]{64}$/.test(plan) || !backup)
  || !apply && (plan || backup)) throw new Error("--apply exige --plan=SHA256 --backup=PATH e não aceita --verify.");
config({ path: ".env.local", quiet: true });
const { financialDbAdmin: db } = await import("../src/lib/firebase-financial-admin");
// Check the actual SDK destination before any reads, backup creation or writes.
if (db.projectId !== projectId || db.databaseId !== databaseId) {
  throw new Error(`Destino Firebase divergente: solicitado ${projectId}/${databaseId}; SDK ${db.projectId}/${db.databaseId}. Nenhuma escrita feita.`);
}
const [year, month] = period.split("-").map(Number);
const maximum = new Date(Date.UTC(year, month, 0)).getUTCDate();
const query = db.collection("cashClosures").where("workspaceId", "==", workspaceId)
  .where("kioskId", "==", kioskId).where("year", "==", year).where("month", "==", month)
  .orderBy(FieldPath.documentId()).limit(maximum + 1);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Snapshot = FirebaseFirestore.DocumentSnapshot;
type ReadSet = { closure: Snapshot; lines: FirebaseFirestore.QuerySnapshot; operators: FirebaseFirestore.QuerySnapshot };
const stamp = (value: Snapshot) => value.updateTime?.toDate().toISOString() + ":" + value.updateTime?.nanoseconds;
function project(read: ReadSet) {
  const closure = { ...read.closure.data(), id: read.closure.id } as CashClosure;
  if (closure.workspaceId !== workspaceId || closure.kioskId !== kioskId || closure.year !== year || closure.month !== month
    || !closure.date.startsWith(`${period}-`) || read.lines.size > 350 || read.operators.size > 50) throw new Error("Escopo/limite inválido.");
  const lines = read.lines.docs.map(row => ({ ...row.data(), id: row.id }) as CashClosureLine);
  const existing = read.operators.docs.map(row => ({ ...row.data(), id: row.id }) as CashClosureOperator);
  if (lines.some(line => line.closureId !== closure.id || line.workspaceId !== workspaceId || line.kioskId !== kioskId || line.date !== closure.date)
    || existing.some(operator => operator.closureId !== closure.id || operator.workspaceId !== workspaceId || operator.kioskId !== kioskId)) throw new Error("Subdocumento fora do escopo.");
  const rebuilt = buildCashClosureOperators({ closure, lines, existingOperators: existing, now: closure.updatedAt });
  if (rebuilt.deletedOperatorIds.length || rebuilt.operators.length !== existing.length
    || existing.some(operator => !rebuilt.operators.some(item => item.id === operator.id && item.operatorId === operator.operatorId))) {
    throw new Error("Cobertura de operadores divergente/legada; não criar, remover nem inferir status.");
  }
  // Preserve every operational field and the PDV source; replace only the derived Finance cash differences.
  const operators = existing.map(operator => ({ ...operator,
    cashDifferences: rebuilt.operators.find(item => item.id === operator.id)!.cashDifferences }));
  const aggregate = withCashClosureOperatorAggregate(closure, operators, closure.updatedAt);
  const patch = { finalizedCashDifferences: aggregate.finalizedCashDifferences,
    dreSelectedCashDifferences: aggregate.dreSelectedCashDifferences,
    drePdvFallbackOperatorCount: aggregate.drePdvFallbackOperatorCount };
  const oldPatch = { finalizedCashDifferences: closure.finalizedCashDifferences,
    dreSelectedCashDifferences: closure.dreSelectedCashDifferences,
    drePdvFallbackOperatorCount: closure.drePdvFallbackOperatorCount };
  const operatorPatches = operators.filter(operator => !isDeepStrictEqual(operator.cashDifferences,
    existing.find(item => item.id === operator.id)!.cashDifferences))
    .map(operator => ({ id: operator.id, cashDifferences: operator.cashDifferences }));
  const changed = operatorPatches.length > 0 || !isDeepStrictEqual(patch, oldPatch);
  return { id: closure.id, date: closure.date, changed, patch, oldPatch, operatorPatches,
    projected: { ...closure, ...patch },
    revisions: { closure: stamp(read.closure), lines: read.lines.docs.map(row => [row.id, stamp(row)]), operators: read.operators.docs.map(row => [row.id, stamp(row)]) },
    previousOperators: existing.map(operator => ({ id: operator.id, cashDifferences: operator.cashDifferences })) };
}
async function read(ref: FirebaseFirestore.DocumentReference, transaction?: FirebaseFirestore.Transaction): Promise<ReadSet> {
  const lines = ref.collection("lines").orderBy(FieldPath.documentId()).limit(351);
  const operators = ref.collection("cashClosureOperators").orderBy(FieldPath.documentId()).limit(51);
  if (transaction) return { closure: await transaction.get(ref), lines: await transaction.get(lines), operators: await transaction.get(operators) };
  const [closure, lineRows, operatorRows] = await Promise.all([ref.get(), lines.get(), operators.get()]);
  return { closure, lines: lineRows, operators: operatorRows };
}
const found = await query.get();
if (found.empty || found.size > maximum) throw new Error("Quantidade de dias inválida.");
const projections = [];
for (const row of found.docs) projections.push(project(await read(row.ref)));
if (new Set(projections.map(row => row.date)).size !== projections.length) throw new Error("Data duplicada.");
const digest = hash({ projectId, databaseId, workspaceId, kioskId, period, rows: projections });
const expected = summarizeCashClosureDre(projections.map(row => row.projected));
const report = { projectId, databaseId, workspaceId, kioskId, period, plan: digest, days: projections.length,
  changedDays: projections.filter(row => row.changed).length, expected };
if (verify) {
  const snapshot = await db.collection("cashClosureMonthlySummaries").doc(`${workspaceId}_${kioskId}_${year}_${String(month).padStart(2, "0")}`).get();
  const actual = snapshot.data();
  const matches = projections.every(row => !row.changed) && actual
    && Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual[key], value));
  console.log(JSON.stringify({ mode: "VERIFY", matches: !!matches, ...report }, null, 2));
  if (!matches) process.exitCode = 2;
} else if (!apply) {
  console.log(JSON.stringify({ mode: "DRY_RUN", ...report }, null, 2));
} else {
  if (plan !== digest) throw new Error("Plano mudou; nenhuma escrita feita.");
  const previous = projections.map(({ id, date, oldPatch, previousOperators, revisions }) => ({ id, date, oldPatch, previousOperators, revisions }));
  await writeFile(backup!, JSON.stringify({ ...report, rows: previous }, null, 2), { flag: "wx", mode: 0o600 });
  for (const projected of projections.filter(row => row.changed)) {
    const ref = db.collection("cashClosures").doc(projected.id);
    await db.runTransaction(async transaction => {
      const fresh = project(await read(ref, transaction));
      if (!isDeepStrictEqual(fresh, projected)) throw new Error("Fonte alterada; interrompido, refaça dry-run. Dias anteriores podem ter sido atualizados.");
      for (const operator of fresh.operatorPatches) transaction.update(ref.collection("cashClosureOperators").doc(operator.id), { cashDifferences: operator.cashDifferences! });
      transaction.update(ref, { ...fresh.patch, dreCashProjectionRebuiltAt: new Date().toISOString() });
    });
  }
  console.log(JSON.stringify({ mode: "APPLIED_TRIGGER_PENDING", ...report }, null, 2));
}
