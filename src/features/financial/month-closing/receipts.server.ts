import "server-only";

import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { listCashClosures } from "@/features/financial/cash-closures/repository.server";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { readStoneReceiptSnapshot } from "@/features/financial/receipts-reconciliation/stone-account-snapshot.server";
import { reportSystemError } from "@/lib/observability";

import { shiftMonth, todayKey } from "./month";
import { evaluateReceiptsFlow, receiptsFlowUnavailable, type ReceiptsCashInput, type ReceiptsParcelInput, type ReceiptsSourceInput, type ReceiptsUnitInput } from "./receipts-flow";
import { kioskNames, monthBounds, readMappings } from "./sales-fees.server";
import { feeBindings } from "./stone-bindings";
import type { ClosingFlow } from "./types";

type Input = { workspaceId: string; month: string; canViewItems: boolean; now?: Date };

/** Meses de venda sempre lidos: o crédito à vista vendido no mês anterior cai neste. */
const BASE_LOOKBACK_MONTHS = 1;
/** Se alguma conferência lida tiver parcelado, lê também os meses anteriores até a maior parcela prevista (12x). */
const INSTALLMENT_LOOKBACK_MONTHS = 11;

/** Teto de leitura dos fechamentos de caixa do mês (≈ 31 dias × quiosques); acima disso a etapa fica indisponível. */
const CASH_CLOSURES_LIMIT = 1000;

const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

/**
 * Etapa do dinheiro. Um dia aprovado com dinheiro elegível só está resolvido com depósito pago ou ajustado
 * (ajuste feito na tela de depósitos). Somente leitura: um GET de até 1.000 fechamentos por chamada, sem polling.
 */
async function readCashStage(input: Input, bounds: ReturnType<typeof monthBounds>, now: Date): Promise<ReceiptsCashInput> {
  const closures = await listCashClosures({ workspaceId: input.workspaceId, year: bounds.year, month: bounds.index, limit: CASH_CLOSURES_LIMIT });
  if (closures.length >= CASH_CLOSURES_LIMIT) throw new Error("Fechamentos de caixa do mês acima do limite de leitura.");
  const kiosks = new Map<string, { label: string; openDays: number; unpaidDays: number; unpaidCents: number }>();
  for (const closure of closures) {
    const entry = kiosks.get(closure.kioskId) ?? { label: closure.kioskName || closure.kioskId, openDays: 0, unpaidDays: 0, unpaidCents: 0 };
    if (closure.status !== "approved") entry.openDays += 1;
    else if (closure.cashDeposit.eligibleCents > 0 && !["paid", "adjusted"].includes(closure.cashDeposit.status)) {
      entry.unpaidDays += 1;
      entry.unpaidCents += Math.max(0, closure.cashDeposit.eligibleCents - (closure.cashDeposit.paidCents ?? 0));
    }
    kiosks.set(closure.kioskId, entry);
  }
  return {
    monthOver: todayKey(now) > bounds.through,
    kiosks: [...kiosks.entries()].map(([kioskId, entry]) => ({
      key: kioskId, ...entry,
      closuresHref: `${FINANCIAL_ROUTES.cashClosures}?${query({ month: input.month, kioskId })}`,
      depositsHref: `${FINANCIAL_ROUTES.cashDeposits}?${query({ month: input.month, kioskId })}`,
    })),
  };
}

/**
 * Recebimento (etapa Pix e cartão): parcelas com data prevista na competência, lidas das conferências Stone salvas dos
 * meses de venda que podem cair nela. Somente leitura. Custo por chamada, sem polling: por vínculo, 2 documentos de
 * conferência (até 12 quando há parcelado). Fonte ilegível deixa só este fluxo indisponível, com evento de erro.
 */
export async function readReceiptsFlow(input: Input): Promise<ClosingFlow> {
  const now = input.now ?? new Date();
  const bounds = monthBounds(input.month);
  const originHref = `${FINANCIAL_ROUTES.stoneReceipts}?${query({ month: input.month })}`;
  const publishedThrough = latestPublishedDate(now);
  const referenceDay = publishedThrough < bounds.through ? publishedThrough : bounds.through;
  try {
    const mappings = await readMappings(input.workspaceId);
    const bindings = feeBindings(mappings, referenceDay);
    const names = await kioskNames([...new Set(bindings.map((binding) => binding.kioskId))]);
    const units = await Promise.all(bindings.map(async (binding): Promise<ReceiptsUnitInput> => {
      const sourceOf = async (month: string) => {
        const saved = await readStoneReceiptSnapshot({ workspaceId: input.workspaceId, mappingId: binding.id, kioskId: binding.kioskId, stoneCode: binding.stoneCode, month });
        const ready = saved.status === "ready";
        const source: ReceiptsSourceInput = {
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
      const parcels = new Map<string, ReceiptsParcelInput>();
      for (const { result } of reads) {
        for (const parcel of result?.parcels ?? []) {
          if (!parcel.expectedDate || parcel.expectedDate < bounds.from || parcel.expectedDate > bounds.through) continue;
          parcels.set(parcel.id, { id: parcel.id, status: parcel.status, expectedDate: parcel.expectedDate, netCents: parcel.expectedNetCents });
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
    const cash = await readCashStage(input, bounds, now).catch((error) => {
      reportSystemError({ error, source: "api-financial", operation: "month-closing-receipts-cash", routeOrJob: "/api/financial/month-closing" });
      return null;
    });
    return evaluateReceiptsFlow({ units, cash, canViewItems: input.canViewItems, originHref });
  } catch (error) {
    reportSystemError({ error, source: "api-financial", operation: "month-closing-receipts", routeOrJob: "/api/financial/month-closing" });
    return receiptsFlowUnavailable(originHref);
  }
}
