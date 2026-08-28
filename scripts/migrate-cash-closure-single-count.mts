/**
 * Finaliza fechamentos que permaneceram em `pending_review` na retirada da
 * conferência financeira em duas etapas.
 *
 * Seguro por padrão: sem `--execute`, faz somente o preflight paginado.
 * A execução é idempotente porque consulta apenas fechamentos ainda pendentes.
 *
 * Uso:
 *   npm run migrate:cash-closure-single-count
 *   npm run migrate:cash-closure-single-count -- --execute
 */
import { FieldPath } from "firebase-admin/firestore";
import { config } from "dotenv";

config({ path: ".env.local" });

const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");
const { finalizeCashClosure } = await import("../src/features/financial/cash-closures/repository.server");
const { resolveCashClosureSingleCount } = await import("../src/features/financial/cash-closures/single-count");
const {
  finalizeCashDepositAdjustmentForClosure,
  processCashDepositQueue,
} = await import("../src/features/financial/cash-deposits/repository.server");
const { normalizeCashClosureWithLines } = await import("../src/features/financial/cash-closures/persistence");
type CashClosure = import("../src/features/financial/cash-closures/types").CashClosure;
type CashClosureLine = import("../src/features/financial/cash-closures/types").CashClosureLine;

const execute = process.argv.includes("--execute");
const pageSize = 100;
const actor = {
  userId: "system:cash-closure-single-count-migration",
  userName: "Migração para contagem única",
};

type Candidate = {
  id: string;
  workspaceId: string;
  kioskId: string;
  lineCount: number;
  legacyFinanceLineCount: number;
};

const candidates: Candidate[] = [];
const blockers: Array<{ closureId: string; reason: string }> = [];
const seenIds = new Set<string>();
let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
let closureReads = 0;
let lineReads = 0;

while (true) {
  let query: FirebaseFirestore.Query = financialDbAdmin.collection("cashClosures")
    .where("status", "==", "pending_review")
    .orderBy(FieldPath.documentId())
    .limit(pageSize);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  closureReads += snapshot.size;
  if (snapshot.empty) break;

  for (const document of snapshot.docs) {
    if (seenIds.has(document.id)) {
      blockers.push({ closureId: document.id, reason: "Fechamento duplicado no preflight." });
      continue;
    }
    seenIds.add(document.id);
    const rawClosure = { id: document.id, ...document.data() } as CashClosure;
    const lineSnapshot = await document.ref.collection("lines").get();
    lineReads += lineSnapshot.size;
    const normalized = normalizeCashClosureWithLines(
      rawClosure,
      lineSnapshot.docs.map((lineDocument) => ({
        id: lineDocument.id,
        ...lineDocument.data(),
      }) as CashClosureLine),
    );
    if (!normalized.closure.workspaceId || !normalized.closure.kioskId) {
      blockers.push({ closureId: document.id, reason: "Workspace ou unidade ausente." });
      continue;
    }
    const resolved = normalized.lines.map((line) => ({
      line,
      singleCount: resolveCashClosureSingleCount(line, normalized.closure.status),
    }));
    if (resolved.some(({ singleCount }) => singleCount.cents === null)) {
      blockers.push({ closureId: document.id, reason: "Há linha manual sem contagem." });
      continue;
    }
    if (resolved.some(({ line, singleCount }) => (
      singleCount.cents !== line.expectedCents && !singleCount.note
    ))) {
      blockers.push({ closureId: document.id, reason: "Há divergência sem observação." });
      continue;
    }
    candidates.push({
      id: document.id,
      workspaceId: normalized.closure.workspaceId,
      kioskId: normalized.closure.kioskId,
      lineCount: normalized.lines.length,
      legacyFinanceLineCount: resolved.filter(({ singleCount }) => singleCount.source === "legacy_finance").length,
    });
  }

  cursor = snapshot.docs.at(-1) ?? null;
  if (snapshot.size < pageSize) break;
}

console.log(JSON.stringify({
  mode: execute ? "EXECUTE_REQUESTED" : "DRY_RUN",
  preflight: {
    pendingClosures: seenIds.size,
    eligibleClosures: candidates.length,
    blockedClosures: blockers.length,
    closureReads,
    lineReads,
    minimumDocumentReads: closureReads + lineReads,
  },
  candidates,
  blockers,
}, null, 2));

if (!execute || candidates.length === 0) process.exit(blockers.length > 0 ? 1 : 0);
if (blockers.length > 0) {
  console.log("Execução cancelada: corrija todos os bloqueios do preflight antes de escrever.");
  process.exit(1);
}

const completed: string[] = [];
const failures: Array<{ closureId: string; error: string }> = [];
for (const candidate of candidates) {
  try {
    const closure = await finalizeCashClosure(candidate.id, actor);
    await finalizeCashDepositAdjustmentForClosure(candidate.id);
    await processCashDepositQueue(candidate.workspaceId, candidate.kioskId, actor);
    completed.push(closure.id);
  } catch (error) {
    failures.push({
      closureId: candidate.id,
      error: error instanceof Error ? error.message : "Falha desconhecida.",
    });
  }
}

console.log(JSON.stringify({
  mode: "EXECUTED",
  completed: completed.length,
  failed: failures.length,
  completedClosureIds: completed,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
