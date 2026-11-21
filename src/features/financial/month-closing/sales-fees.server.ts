import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";
import { reportSystemError } from "@/lib/observability";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { buildFeeReview } from "@/features/financial/receipts-reconciliation/fee-review.server";
import { listAutomatedSalesReviewMappings } from "@/features/financial/sales-reconciliation/mapping.server";
import { buildSalesReviewMonth } from "@/features/financial/sales-reconciliation/review-calendar";
import { listDailySalesReviewCalendar } from "@/features/financial/sales-reconciliation/review-state.server";

import { evaluateFeesFlow, feesFlowUnavailable, type FeesUnitInput } from "./fees-flow";
import { evaluateSalesFlow, salesFlowUnavailable, type SalesUnitInput } from "./sales-flow";
import type { ClosingFlow } from "./types";

type Input = { workspaceId: string; month: string; canViewItems: boolean; now?: Date };

function monthBounds(month: string) {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { year, index, from: `${month}-01`, through: `${month}-${String(last).padStart(2, "0")}` };
}

async function kioskNames(kioskIds: string[]) {
  if (kioskIds.length === 0) return new Map<string, string>();
  const documents = await dbAdmin.getAll(...kioskIds.map((id) => dbAdmin.collection("kiosks").doc(id)));
  return new Map(documents.map((document) => [document.id, String(document.data()?.name ?? document.id)]));
}

const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

/**
 * Vendas (revisão PDV × Stone) e Taxas (aba Taxas) por vínculo Stone da competência. Somente leitura.
 * Custo por chamada, sem polling: até 31 leituras do calendário por vínculo (Vendas) e, por vínculo, a leitura de
 * até 6 conferências mensais, decisões (≤2.000), ocorrências (≤500) e referências de taxa (Taxas).
 * Uma fonte ilegível deixa só o seu fluxo indisponível, com evento de erro; nunca conferido.
 */
export async function readSalesAndFeesFlows(input: Input): Promise<{ sales: ClosingFlow; fees: ClosingFlow }> {
  const now = input.now ?? new Date();
  const bounds = monthBounds(input.month);
  const salesHref = `${FINANCIAL_ROUTES.salesReconciliation}?${query({ month: input.month })}`;
  const feesHref = `${FINANCIAL_ROUTES.stoneReceipts}?${query({ tab: "fees", month: input.month })}`;
  const fallback = (error: unknown, operation: string) => {
    reportSystemError({ error, source: "api-financial", operation, routeOrJob: "/api/financial/month-closing" });
  };

  let bindings: Array<{ id: string; kioskId: string; stoneCode: string; validFrom: string; validTo: string | null }>;
  let names: Map<string, string>;
  try {
    const mappings = await listAutomatedSalesReviewMappings(input.workspaceId);
    bindings = mappings
      // Vínculo por terminal não tem revisão diária da unidade; o calendário e as taxas são por StoneCode.
      .filter((mapping) => mapping.terminalIds.length === 0 && mapping.validFrom <= bounds.through && (!mapping.validTo || mapping.validTo >= bounds.from))
      .flatMap((mapping) => mapping.stoneCodes.map((stoneCode) => ({
        id: mapping.id, kioskId: mapping.kioskId, stoneCode, validFrom: mapping.validFrom, validTo: mapping.validTo ?? null,
      })));
    names = await kioskNames([...new Set(bindings.map((binding) => binding.kioskId))]);
  } catch (error) {
    fallback(error, "month-closing-stone-bindings");
    return { sales: salesFlowUnavailable(salesHref), fees: feesFlowUnavailable(feesHref) };
  }
  const label = (binding: (typeof bindings)[number]) => {
    const same = bindings.filter((other) => other.kioskId === binding.kioskId).length;
    const name = names.get(binding.kioskId) ?? binding.kioskId;
    return same > 1 ? `${name} · Stone ${binding.stoneCode}` : name;
  };
  const target = (binding: (typeof bindings)[number], base: string, extra: Record<string, string> = {}) =>
    `${base}?${query({ ...extra, month: input.month, mapping: binding.id, stoneCode: binding.stoneCode })}`;
  const publishedThrough = latestPublishedDate(now);

  const salesPromise = (async () => {
    const units: SalesUnitInput[] = await Promise.all(bindings.map(async (binding) => {
      const records = await listDailySalesReviewCalendar({
        workspaceId: input.workspaceId, kioskId: binding.kioskId, mappingId: binding.id, stoneCode: binding.stoneCode,
        referenceDate: bounds.from, from: bounds.from, through: bounds.through,
      });
      return {
        key: `${binding.id}:${binding.stoneCode}`, label: label(binding),
        href: target(binding, FINANCIAL_ROUTES.salesReconciliation),
        month: buildSalesReviewMonth({ year: bounds.year, month: bounds.index, records, publishedThrough, validFrom: binding.validFrom, validTo: binding.validTo }),
      };
    }));
    return evaluateSalesFlow({ units, canViewItems: input.canViewItems, originHref: salesHref });
  })().catch((error) => { fallback(error, "month-closing-sales"); return salesFlowUnavailable(salesHref); });

  const feesPromise = (async () => {
    const units: FeesUnitInput[] = await Promise.all(bindings.map(async (binding) => {
      const review = await buildFeeReview({ workspaceId: input.workspaceId, mappingId: binding.id, kioskId: binding.kioskId, stoneCode: binding.stoneCode }, input.month, now);
      return {
        key: `${binding.id}:${binding.stoneCode}`, label: label(binding),
        href: target(binding, FINANCIAL_ROUTES.stoneReceipts, { tab: "fees" }),
        ready: review.ready,
        // Mês inteiro publicado e conferência salva depois do fim do mês; antes disso o dado pode estar incompleto.
        complete: review.ready && publishedThrough >= bounds.through && !!review.savedAt && review.savedAt.slice(0, 10) > bounds.through,
        exceptionCount: review.exceptions.length, changeCount: review.changes.length, chargeCount: review.charges.length,
      };
    }));
    return evaluateFeesFlow({ units, canViewItems: input.canViewItems, originHref: feesHref });
  })().catch((error) => { fallback(error, "month-closing-fees"); return feesFlowUnavailable(feesHref); });

  const [sales, fees] = await Promise.all([salesPromise, feesPromise]);
  return { sales, fees };
}
