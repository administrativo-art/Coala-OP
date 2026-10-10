import "server-only";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";

const EXPENSE_POSITIONS = new Set(["impostos_deducoes", "custos_variaveis", "pessoal", "despesas_operacionais", "ocupacao", "despesas_financeiras", "despesa_nao_operacional", "impostos_resultado"]);
// Read on every note analysis; the chart of accounts changes rarely.
const CACHE_TTL_MS = 10 * 60_000;

export type LocalPurchaseAccount = { id: string; name: string };
let cache: { expiresAt: number; value: Promise<LocalPurchaseAccount[]> } | null = null;

/** Optional allowlist: local purchases are consumables, cleaning supplies and utensils, never the whole chart. */
function allowedAccountIds() {
  const ids = (process.env.LOCAL_PURCHASE_ACCOUNT_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

async function loadAccounts() {
  const snapshot = await financialDbAdmin.collection("accounts").limit(501).get();
  if (snapshot.size > 500) {
    throw new AppError({ code: "LOCAL_PURCHASE_CONTEXT_LIMIT", kind: "CONFLICT", safeMessage: "Os cadastros excedem o limite do aplicativo. Solicite a revisão do catálogo." });
  }
  const parents = new Set(snapshot.docs.map((document) => document.get("parentId")).filter(Boolean));
  const allowed = allowedAccountIds();
  return snapshot.docs
    .filter((document) => document.get("active") !== false && document.get("is_dre_account") !== false
      && !parents.has(document.id) && EXPENSE_POSITIONS.has(document.get("dre_position"))
      && (!allowed || allowed.has(document.id)))
    .map((document) => ({ id: document.id, name: String(document.get("name") || document.id) }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** Leaf DRE expense accounts a local purchase may use: the list the app shows and the AI may suggest from. */
export function listLocalPurchaseAccounts() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, value: loadAccounts() };
  entry.value.catch(() => { if (cache === entry) cache = null; });
  cache = entry;
  return entry.value;
}
