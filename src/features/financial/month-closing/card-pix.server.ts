import "server-only";

import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { readStoneReceiptSnapshot } from "@/features/financial/receipts-reconciliation/stone-account-snapshot.server";
import { reportSystemError } from "@/lib/observability";

import { shiftMonth } from "./month";
import { cardPixFlowUnavailable, evaluateCardPixFlow, type CardPixParcelInput, type CardPixSourceInput, type CardPixUnitInput } from "./card-pix-flow";
import { kioskNames, monthBounds, readMappings } from "./sales-fees.server";
import { feeBindings } from "./stone-bindings";
import type { ClosingFlow } from "./types";

type Input = { workspaceId: string; month: string; canViewItems: boolean; now?: Date };

/** Meses de venda sempre lidos: o crédito à vista vendido no mês anterior cai neste. */
const BASE_LOOKBACK_MONTHS = 1;
/** Se alguma conferência lida tiver parcelado, lê também os meses anteriores até a maior parcela prevista (12x). */
const INSTALLMENT_LOOKBACK_MONTHS = 11;

const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

/**
 * Cartão e Pix: parcelas com data prevista na competência, lidas das conferências Stone salvas dos
 * meses de venda que podem cair nela. Somente leitura. Custo por chamada, sem polling: por vínculo, 2 documentos de
 * conferência (até 12 quando há parcelado). Fonte ilegível deixa só este fluxo indisponível, com evento de erro.
 */
export async function readCardPixFlow(input: Input): Promise<ClosingFlow> {
  const now = input.now ?? new Date();
  const bounds = monthBounds(input.month);
  const originHref = `${FINANCIAL_ROUTES.stoneReceipts}?${query({ month: input.month })}`;
  const publishedThrough = latestPublishedDate(now);
  const referenceDay = publishedThrough < bounds.through ? publishedThrough : bounds.through;
  try {
    const mappings = await readMappings(input.workspaceId);
    const bindings = feeBindings(mappings, referenceDay);
    const names = await kioskNames([...new Set(bindings.map((binding) => binding.kioskId))]);
    const units = await Promise.all(bindings.map(async (binding): Promise<CardPixUnitInput> => {
      const sourceOf = async (month: string) => {
        const saved = await readStoneReceiptSnapshot({ workspaceId: input.workspaceId, mappingId: binding.id, kioskId: binding.kioskId, stoneCode: binding.stoneCode, month });
        const ready = saved.status === "ready";
        const source: CardPixSourceInput = {
          month, ready,
          // Mês inteiro publicado e conferência salva depois do fim da competência; antes disso o dado pode estar incompleto.
          complete: ready && publishedThrough >= bounds.through && !!saved.savedAt && saved.savedAt.slice(0, 10) > bounds.through,
        };
        return { source, result: saved.status === "ready" ? saved.result : null };
      };
      const relevant = (month: string) => monthBounds(month).through >= binding.validFrom;
      const months = Array.from({ length: BASE_LOOKBACK_MONTHS + 1 }, (_, index) => shiftMonth(input.month, -index)).filter(relevant);
      let reads = await Promise.all(months.map(sourceOf));
      if (reads.some(({ result }) => result?.parcels.some((parcel) => parcel.installmentCount > 1))) {
        const older = Array.from({ length: INSTALLMENT_LOOKBACK_MONTHS - BASE_LOOKBACK_MONTHS }, (_, index) => shiftMonth(input.month, -(BASE_LOOKBACK_MONTHS + 1 + index))).filter(relevant);
        reads = [...reads, ...await Promise.all(older.map(sourceOf))];
      }
      const parcels = new Map<string, CardPixParcelInput>();
      for (const { result } of reads) {
        for (const parcel of result?.parcels ?? []) {
          if (!parcel.expectedDate || parcel.expectedDate < bounds.from || parcel.expectedDate > bounds.through) continue;
          parcels.set(parcel.id, { id: parcel.id, source: parcel.source, status: parcel.status, expectedDate: parcel.expectedDate, netCents: parcel.expectedNetCents });
        }
      }
      const same = bindings.filter((other) => other.kioskId === binding.kioskId).length;
      const name = names.get(binding.kioskId) ?? binding.kioskId;
      return {
        key: `${binding.id}:${binding.stoneCode}`, label: same > 1 ? `${name} · Stone ${binding.stoneCode}` : name,
        href: `${FINANCIAL_ROUTES.stoneReceipts}?${query({ month: input.month, mapping: binding.id, stoneCode: binding.stoneCode })}`,
        sources: reads.map(({ source }) => source), parcels: [...parcels.values()],
      };
    }));
    return evaluateCardPixFlow({ units, canViewItems: input.canViewItems, originHref });
  } catch (error) {
    reportSystemError({ error, source: "api-financial", operation: "month-closing-card-pix", routeOrJob: "/api/financial/month-closing" });
    return cardPixFlowUnavailable(originHref);
  }
}
