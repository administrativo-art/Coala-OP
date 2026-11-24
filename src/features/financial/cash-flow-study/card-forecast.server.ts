import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { buildCardCashForecast, cardInstrumentKey, isCardPurchase, type CardSourceRow } from "./card-forecast";
import { horizonEndFor } from "./model";

export const CARD_FORECAST_LIMITS = { activeStatements: 120, referencedStatements: 120, obligations: 240, batchSize: 50 } as const;
const STATEMENT_FIELDS = ["accountId", "paymentMethodId", "paymentMethodLabel", "dueDate", "status", "officialTotal", "obligationId", "settlementSummary", "linkedBankTransactionId", "linkedBankTransactionIds"];
const OBLIGATION_FIELDS = ["sourceId", "obligationType", "status", "summary"];
const safeId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 250 && !x.includes("/");

/** Default-admin-only financial study. Never reads people, attachments or allocations. No producer calls. */
export async function loadStudyCardForecast(purchases: CardSourceRow[], today: string, purchaseCoverageComplete = true, db = financialDbAdmin) {
  let complete = purchaseCoverageComplete;
  let futureCoverageComplete = purchaseCoverageComplete;
  const blockedInstruments = new Set<string>();
  const referenceInstruments = new Map<string, Set<string>>();
  const blockReference = (id: string) => { for (const key of referenceInstruments.get(id) ?? []) blockedInstruments.add(key); };
  const statements = new Map<string, CardSourceRow>();
  const obligations: CardSourceRow[] = [];
  const gaps: string[] = [];
  try {
    const active = await db.collection("cardStatements").where("status", "in", ["open", "closed"]).limit(CARD_FORECAST_LIMITS.activeStatements + 1).select(...STATEMENT_FIELDS).get();
    if (active.size > CARD_FORECAST_LIMITS.activeStatements) { complete = false; futureCoverageComplete = false; }
    for (const doc of active.docs.slice(0, CARD_FORECAST_LIMITS.activeStatements)) statements.set(doc.id, { id: doc.id, data: doc.data() });
    const ids = new Set<string>();
    for (const purchase of purchases) {
      if (!isCardPurchase(purchase.data)) continue;
      const instrument = cardInstrumentKey(purchase.data);
      const remember = (id: unknown) => {
        if (!safeId(id)) { if (id && instrument) blockedInstruments.add(instrument); return; }
        ids.add(id);
        if (instrument) referenceInstruments.set(id, new Set([...(referenceInstruments.get(id) ?? []), instrument]));
      };
      remember(purchase.data.cardStatementId);
      if (Array.isArray(purchase.data.installments)) for (const item of purchase.data.installments) {
        if (item && typeof item === "object") remember(item.cardStatementId);
      }
    }
    const missing = [...ids].filter(id => !statements.has(id)).sort();
    if (missing.length > CARD_FORECAST_LIMITS.referencedStatements) { complete = false; for (const id of missing.slice(CARD_FORECAST_LIMITS.referencedStatements)) blockReference(id); }
    const selected = missing.slice(0, CARD_FORECAST_LIMITS.referencedStatements);
    for (let i = 0; i < selected.length; i += CARD_FORECAST_LIMITS.batchSize) {
      const refs = selected.slice(i, i + CARD_FORECAST_LIMITS.batchSize).map(id => db.collection("cardStatements").doc(id));
      for (const doc of await db.getAll(...refs, { fieldMask: STATEMENT_FIELDS })) {
        if (doc.exists) statements.set(doc.id, { id: doc.id, data: doc.data()! }); else { complete = false; blockReference(doc.id); }
      }
    }
    const obligationIds = [...new Set([...statements.values()].map(s => s.data.obligationId).filter(safeId))].sort();
    if (obligationIds.length > CARD_FORECAST_LIMITS.obligations) complete = false;
    for (let i = 0; i < Math.min(obligationIds.length, CARD_FORECAST_LIMITS.obligations); i += CARD_FORECAST_LIMITS.batchSize) {
      const refs = obligationIds.slice(i, Math.min(i + CARD_FORECAST_LIMITS.batchSize, CARD_FORECAST_LIMITS.obligations)).map(id => db.collection("financialObligations").doc(id));
      for (const doc of await db.getAll(...refs, { fieldMask: OBLIGATION_FIELDS })) {
        if (doc.exists) obligations.push({ id: doc.id, data: doc.data()! }); else complete = false;
      }
    }
  } catch {
    complete = false; futureCoverageComplete = false;
    gaps.push("Não foi possível concluir a leitura das faturas/obrigações do cartão; conferir Despesas/Faturas.");
  }
  const result = buildCardCashForecast({ today, horizonEnd: horizonEndFor(today), purchases, statements: [...statements.values()], obligations, complete, futureCoverageComplete, blockedInstruments: [...blockedInstruments] });
  return { expenses: result.expenses, gaps: [...gaps, ...result.gaps], complete };
}
