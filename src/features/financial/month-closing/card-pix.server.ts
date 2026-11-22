import "server-only";

import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { readStoneReceiptSnapshot } from "@/features/financial/receipts-reconciliation/stone-account-snapshot.server";
import { reportSystemError } from "@/lib/observability";

import {
  cardInstallmentsFlowUnavailable, cardPixFlowUnavailable, cardPixSourceMonths, evaluateCardInstallmentsFlow, evaluateCardPixFlow, splitReceiptParcels,
  type CardPixSourceInput, type CardPixUnitInput, type StoneReceiptParcelInput,
} from "./card-pix-flow";
import { kioskNames, monthBounds, readMappings } from "./sales-fees.server";
import { feeBindings } from "./stone-bindings";
import type { ClosingFlow } from "./types";

type Input = { workspaceId: string; month: string; canViewItems: boolean; now?: Date };

const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

/**
 * Recebimento do cartão e Pix, em dois fluxos (à vista por venda do mês; parcelado por parcela que vence no mês), lidos da
 * conferência Stone salva do próprio mês, que já traz as parcelas de vendas anteriores que vencem nele. Somente leitura.
 * Custo por chamada, sem polling: 1 documento de conferência por vínculo. Fonte ilegível deixa só estes fluxos
 * indisponíveis, com evento de erro.
 */
export async function readCardPixFlows(input: Input): Promise<{ cardPix: ClosingFlow; installments: ClosingFlow }> {
  const now = input.now ?? new Date();
  const bounds = monthBounds(input.month);
  const originHref = `${FINANCIAL_ROUTES.stoneReceipts}?${query({ month: input.month })}`;
  const publishedThrough = latestPublishedDate(now);
  const referenceDay = publishedThrough < bounds.through ? publishedThrough : bounds.through;
  try {
    const mappings = await readMappings(input.workspaceId);
    const bindings = feeBindings(mappings, referenceDay);
    const names = await kioskNames([...new Set(bindings.map((binding) => binding.kioskId))]);
    const units = await Promise.all(bindings.map(async (binding) => {
      const sourceOf = async (month: string) => {
        const saved = await readStoneReceiptSnapshot({ workspaceId: input.workspaceId, mappingId: binding.id, kioskId: binding.kioskId, stoneCode: binding.stoneCode, month });
        const ready = saved.status === "ready";
        const source: CardPixSourceInput = {
          month, ready, pixUnavailableDays: saved.status === "ready" ? saved.result.coverage.pixUnavailableDates.length : 0,
          // Mês inteiro publicado e conferência salva depois do fim da competência; antes disso o dado pode estar incompleto.
          complete: ready && publishedThrough >= bounds.through && !!saved.savedAt && saved.savedAt.slice(0, 10) > bounds.through,
        };
        return { source, result: saved.status === "ready" ? saved.result : null };
      };
      const reads = await Promise.all(cardPixSourceMonths(input.month, binding.validFrom, bounds.through).map(sourceOf));
      const parcels = new Map<string, StoneReceiptParcelInput>();
      for (const { result } of reads) {
        for (const parcel of result?.parcels ?? []) {
          parcels.set(parcel.id, {
            id: parcel.id, source: parcel.source, status: parcel.status, expectedDate: parcel.expectedDate, netCents: parcel.expectedNetCents,
            saleDate: parcel.saleDate ?? null, installmentCount: parcel.installmentCount,
          });
        }
      }
      const split = splitReceiptParcels([...parcels.values()], input.month);
      const same = bindings.filter((other) => other.kioskId === binding.kioskId).length;
      const name = names.get(binding.kioskId) ?? binding.kioskId;
      const base = {
        key: `${binding.id}:${binding.stoneCode}`, label: same > 1 ? `${name} · Stone ${binding.stoneCode}` : name,
        href: `${FINANCIAL_ROUTES.stoneReceipts}?${query({ month: input.month, mapping: binding.id, stoneCode: binding.stoneCode })}`,
        sources: reads.map(({ source }) => source),
      };
      return { cashSale: { ...base, parcels: split.cashSale } satisfies CardPixUnitInput, installment: { ...base, parcels: split.installment } satisfies CardPixUnitInput };
    }));
    return {
      cardPix: evaluateCardPixFlow({ units: units.map((unit) => unit.cashSale), canViewItems: input.canViewItems, originHref }),
      installments: evaluateCardInstallmentsFlow({ units: units.map((unit) => unit.installment), canViewItems: input.canViewItems, originHref }),
    };
  } catch (error) {
    reportSystemError({ error, source: "api-financial", operation: "month-closing-card-pix", routeOrJob: "/api/financial/month-closing" });
    return { cardPix: cardPixFlowUnavailable(originHref), installments: cardInstallmentsFlowUnavailable(originHref) };
  }
}
