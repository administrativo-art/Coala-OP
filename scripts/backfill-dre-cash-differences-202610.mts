/**
 * Rebuilds only the DRE cash-difference projection for one October 2026 unit.
 * Dry-run is the default. Deploy the v2 summary writer before --apply; closure
 * updates trigger its monthly recomputation. No counting/approval is changed.
 *
 * node --import tsx scripts/backfill-dre-cash-differences-202610.mts --workspace=ID --kiosk=ID
 * node --import tsx scripts/backfill-dre-cash-differences-202610.mts --workspace=ID --kiosk=ID --apply --plan=SHA256 --backup=/private/tmp/dre-october-ID.json
 * node --import tsx scripts/backfill-dre-cash-differences-202610.mts --workspace=ID --kiosk=ID --apply --refresh-summary --plan=SHA256 --backup=/private/tmp/dre-october-refresh-ID.json
 * node --import tsx scripts/backfill-dre-cash-differences-202610.mts --workspace=ID --kiosk=ID --verify
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { config } from "dotenv";
import { FieldPath } from "firebase-admin/firestore";

import { buildCashClosureOperators, withCashClosureOperatorAggregate } from "../src/features/financial/cash-closures/operators";
import { normalizeCashClosureWithLines } from "../src/features/financial/cash-closures/persistence";
import { summarizeCashClosureDre } from "../src/features/financial/cash-closures/dre-contract";
import type { CashClosure, CashClosureLine, CashClosureOperator } from "../src/features/financial/cash-closures/types";

const args = process.argv.slice(2);
function option(name: string) {
  return args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const workspaceId = option("workspace")?.trim();
const kioskId = option("kiosk")?.trim();
const apply = args.includes("--apply");
const verify = args.includes("--verify");
const refreshSummary = args.includes("--refresh-summary");
const expectedPlan = option("plan");
const backupPath = option("backup");
if (!workspaceId || !kioskId || !/^[A-Za-z0-9_-]{1,100}$/.test(workspaceId)
  || !/^[A-Za-z0-9_-]{1,100}$/.test(kioskId)) {
  throw new Error("Informe --workspace e --kiosk (IDs explícitos, até 100 caracteres). Outubro de 2026 é fixo.");
}
if (apply && verify) throw new Error("Escolha somente --apply ou --verify.");
if (refreshSummary && !apply) throw new Error("--refresh-summary exige --apply.");
if (apply && (!expectedPlan || !/^[a-f0-9]{64}$/.test(expectedPlan) || !backupPath)) {
  throw new Error("--apply exige --plan=<SHA256 do dry-run> e --backup=<caminho local privado>.");
}
if (!apply && (expectedPlan || backupPath)) throw new Error("--plan e --backup são exclusivos de --apply.");

config({ path: ".env.local" });
const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");
const closureCollection = financialDbAdmin.collection("cashClosures");
const monthlyId = `${workspaceId}_${kioskId}_2026_10`;
const closureQuery = closureCollection.where("workspaceId", "==", workspaceId)
  .where("kioskId", "==", kioskId).where("year", "==", 2026).where("month", "==", 10)
  .limit(32);

type Snapshot = FirebaseFirestore.DocumentSnapshot;
type QuerySnapshot = FirebaseFirestore.QuerySnapshot;
function stamp(snapshot: Snapshot) {
  return snapshot.updateTime?.toMillis() ?? null;
}
function document<T>(snapshot: Snapshot): T {
  if (!snapshot.exists) throw new Error(`Documento ausente: ${snapshot.ref.path}`);
  return { id: snapshot.id, ...snapshot.data() } as T;
}
function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
type ReadSet = { closure: Snapshot; lines: QuerySnapshot; operators: QuerySnapshot };
function planClosure(read: ReadSet) {
  const stored = document<CashClosure>(read.closure);
  if (stored.workspaceId !== workspaceId || stored.kioskId !== kioskId || stored.year !== 2026 || stored.month !== 10
    || !/^2026-10-(0[1-9]|[12]\d|3[01])$/.test(stored.date)) {
    throw new Error(`Escopo divergente em ${read.closure.ref.path}.`);
  }
  if (read.lines.size > 350 || read.operators.size > 50) throw new Error(`Limite de subcoleções em ${stored.id}.`);
  const rawLines = read.lines.docs.map(row => document<CashClosureLine>(row));
  const existingOperators = read.operators.docs.map(row => document<CashClosureOperator>(row));
  const normalized = normalizeCashClosureWithLines(stored, rawLines);
  const rebuilt = buildCashClosureOperators({
    closure: normalized.closure, lines: normalized.lines, existingOperators, now: stored.updatedAt,
  }).operators;
  if (rebuilt.length > 50 || (stored.status === "pending_review" && existingOperators.length !== rebuilt.length)) {
    throw new Error(`Status parcial sem cobertura por operador em ${stored.id}; revisão manual necessária.`);
  }
  const projected = withCashClosureOperatorAggregate(normalized.closure, rebuilt, stored.updatedAt);
  const patch = {
    dreSelectedCashDifferences: projected.dreSelectedCashDifferences ?? null,
    drePdvFallbackOperatorCount: projected.drePdvFallbackOperatorCount ?? null,
  };
  const revisions = { closure: stamp(read.closure),
    lines: read.lines.docs.map(row => [row.id, stamp(row)]),
    operators: read.operators.docs.map(row => [row.id, stamp(row)]) };
  return { id: stored.id, date: stored.date, status: stored.status, patch,
    previous: { dreSelectedCashDifferences: stored.dreSelectedCashDifferences ?? null,
      drePdvFallbackOperatorCount: stored.drePdvFallbackOperatorCount ?? null },
    changed: !isDeepStrictEqual(patch, {
      dreSelectedCashDifferences: stored.dreSelectedCashDifferences ?? null,
      drePdvFallbackOperatorCount: stored.drePdvFallbackOperatorCount ?? null,
    }), revisions, projected };
}
async function readClosure(ref: FirebaseFirestore.DocumentReference, transaction?: FirebaseFirestore.Transaction): Promise<ReadSet> {
  const linesQuery = ref.collection("lines").orderBy(FieldPath.documentId()).limit(351);
  const operatorsQuery = ref.collection("cashClosureOperators").orderBy(FieldPath.documentId()).limit(51);
  if (transaction) {
    const closure = await transaction.get(ref);
    const lines = await transaction.get(linesQuery);
    const operators = await transaction.get(operatorsQuery);
    return { closure, lines, operators };
  }
  const [closure, lines, operators] = await Promise.all([ref.get(), linesQuery.get(), operatorsQuery.get()]);
  return { closure, lines, operators };
}

const found = await closureQuery.get();
if (found.size === 0 || found.size > 31) throw new Error("Quantidade de fechamentos fora do intervalo 1–31.");
const plans = [];
for (const row of found.docs.sort((a, b) => a.id.localeCompare(b.id))) {
  plans.push(planClosure(await readClosure(row.ref)));
}
if (new Set(plans.map(row => row.date)).size !== plans.length) throw new Error("Fechamentos duplicados por data.");
const monthly = summarizeCashClosureDre(plans.map(row => row.projected));
const digest = sha({ workspaceId, kioskId, month: "2026-10", rows: plans.map(row => ({
  id: row.id, revisions: row.revisions, patch: row.patch,
})) });
const report = { workspaceId, kioskId, month: "2026-10", plan: digest,
  closureCount: plans.length, changedCount: plans.filter(row => row.changed).length,
  rows: plans.map(({ id, date, status, changed, patch }) => ({ id, date, status, changed, ...patch })),
  projection: monthly };

if (verify) {
  const summary = await financialDbAdmin.collection("cashClosureMonthlySummaries").doc(monthlyId).get();
  const value = summary.data();
  const matches = value?.dreVersion === 2
    && value.dreRevenueTotalCents === monthly.dreRevenueTotalCents
    && value.dreCashShortageTotalCents === monthly.dreCashShortageTotalCents
    && value.dreCashSurplusTotalCents === monthly.dreCashSurplusTotalCents
    && value.dreCashShortageKnownCents === monthly.dreCashShortageKnownCents
    && value.dreCashSurplusKnownCents === monthly.dreCashSurplusKnownCents
    && isDeepStrictEqual(value.dreCoverage, monthly.dreCoverage)
    && plans.every(row => !row.changed);
  process.stdout.write(`${JSON.stringify({ mode: "VERIFY", matches, ...report }, null, 2)}\n`);
  if (!matches) process.exitCode = 2;
} else if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN", ...report }, null, 2)}\n`);
} else {
  if (expectedPlan !== digest) throw new Error("Plano mudou desde o dry-run; nenhuma escrita feita.");
  await writeFile(backupPath!, JSON.stringify({ workspaceId, kioskId, month: "2026-10", plan: digest,
    rows: plans.map(({ id, date, previous, revisions }) => ({ id, date, previous, revisions })) }, null, 2),
  { encoding: "utf8", flag: "wx", mode: 0o600 });
  for (const planned of plans.filter(row => row.changed)) {
    await financialDbAdmin.runTransaction(async transaction => {
      const fresh = planClosure(await readClosure(closureCollection.doc(planned.id), transaction));
      if (!isDeepStrictEqual(fresh.revisions, planned.revisions)
        || !isDeepStrictEqual(fresh.patch, planned.patch)) {
        throw new Error(`Fechamento ${planned.id} mudou; interrompido após as escritas anteriores. Reexecute o dry-run.`);
      }
      transaction.update(closureCollection.doc(planned.id), planned.patch);
    });
  }
  if (refreshSummary && plans.every(row => !row.changed)) {
    const planned = plans[0];
    await financialDbAdmin.runTransaction(async transaction => {
      const fresh = planClosure(await readClosure(closureCollection.doc(planned.id), transaction));
      if (!isDeepStrictEqual(fresh.revisions, planned.revisions)) {
        throw new Error(`Fechamento ${planned.id} mudou; reexecute o dry-run.`);
      }
      transaction.update(closureCollection.doc(planned.id), {
        dreCashDifferenceSummaryRefreshAt: new Date().toISOString(),
      });
    });
  }
  process.stdout.write(`${JSON.stringify({ mode: "APPLIED_TRIGGER_PENDING", backupPath,
    note: "Aguarde o trigger v2 e execute --verify; resumo não foi escrito diretamente.", ...report }, null, 2)}\n`);
}
