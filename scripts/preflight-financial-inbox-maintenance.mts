/**
 * Preflight somente leitura da indexação e retenção da caixa financeira.
 * Uso: npm run preflight:financial-inbox -- --max-docs=5000
 */
import { config } from "dotenv";
import { FieldPath } from "firebase-admin/firestore";

config({ path: ".env.local" });

const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");
const { FINANCIAL_INBOX_SEARCH_INDEX_VERSION } = await import("../src/features/financial/inbox/search-index");
const { financialInboxRetentionPlan } = await import("../src/features/financial/inbox/retention-policy");
const maxDocsArgument = process.argv.find((argument) => argument.startsWith("--max-docs="));
const maxDocs = Math.min(20_000, Math.max(1, Number(maxDocsArgument?.split("=")[1] || 5_000)));
const pageSize = 250;
const now = new Date();
let cursor: string | null = null;
let scanned = 0;
let searchIndexPending = 0;
const statuses: Record<string, number> = {};
const archiveEligible: Record<string, number> = {};

while (scanned < maxDocs) {
  let query = financialDbAdmin.collection("financialInboxMessages")
    .orderBy(FieldPath.documentId())
    .limit(Math.min(pageSize, maxDocs - scanned));
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  if (snapshot.empty) break;
  for (const document of snapshot.docs) {
    const message = { id: document.id, ...document.data() } as import("../src/features/financial/inbox/types").FinancialInboxMessage;
    const status = String(message.status || "missing");
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (message.searchIndexVersion !== FINANCIAL_INBOX_SEARCH_INDEX_VERSION) searchIndexPending += 1;
    const plan = financialInboxRetentionPlan(message, now);
    if (plan) archiveEligible[plan.retentionClass] = (archiveEligible[plan.retentionClass] ?? 0) + 1;
  }
  scanned += snapshot.size;
  cursor = snapshot.docs.at(-1)?.id ?? null;
  if (snapshot.size < pageSize) break;
}

if (scanned >= maxDocs) {
  const next = cursor
    ? await financialDbAdmin.collection("financialInboxMessages").orderBy(FieldPath.documentId()).startAfter(cursor).limit(1).get()
    : null;
  if (next && !next.empty) throw new Error(`O preflight atingiu o limite de ${maxDocs} mensagens. Aumente --max-docs para obter um inventário completo.`);
}

console.log(JSON.stringify({
  mode: "read-only",
  generatedAt: now.toISOString(),
  scanned,
  searchIndexPending,
  archiveEligible,
  statuses,
}, null, 2));
