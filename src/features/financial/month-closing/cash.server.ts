import "server-only";

import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { listCashClosures } from "@/features/financial/cash-closures/repository.server";
import { reportSystemError } from "@/lib/observability";

import { evaluateCashFlow, type CashInput, type CashKioskInput } from "./cash-flow";
import { todayKey } from "./month";
import { monthBounds } from "./sales-fees.server";
import type { ClosingFlow } from "./types";

type Input = { workspaceId: string; month: string; canViewItems: boolean; now?: Date };

/** Teto de leitura dos fechamentos de caixa do mês (≈ 31 dias × quiosques); acima disso o fluxo fica indisponível. */
const CASH_CLOSURES_LIMIT = 1000;

const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

/**
 * Lê os fechamentos de caixa do mês. Somente leitura: um GET de até 1.000 fechamentos por chamada, só com filtros de
 * igualdade (sem ordenação nem índice composto: o de workspace+ano+mês+data pede o quiosque), sem polling.
 */
async function readCash(input: Input, bounds: ReturnType<typeof monthBounds>, now: Date): Promise<CashInput> {
  const closures = await listCashClosures({ workspaceId: input.workspaceId, year: bounds.year, month: bounds.index, limit: CASH_CLOSURES_LIMIT, ordered: false });
  if (closures.length >= CASH_CLOSURES_LIMIT) throw new Error("Fechamentos de caixa do mês acima do limite de leitura.");
  const kiosks = new Map<string, Omit<CashKioskInput, "key" | "closuresHref" | "depositsHref">>();
  for (const closure of closures) {
    const entry = kiosks.get(closure.kioskId) ?? { label: closure.kioskName || closure.kioskId, closureDays: 0, openDays: 0, depositDays: 0, unpaidDays: 0, unpaidCents: 0 };
    entry.closureDays += 1;
    if (closure.status !== "approved") entry.openDays += 1;
    else if (closure.cashDeposit.eligibleCents > 0) {
      entry.depositDays += 1;
      if (!["paid", "adjusted"].includes(closure.cashDeposit.status)) {
        entry.unpaidDays += 1;
        entry.unpaidCents += Math.max(0, closure.cashDeposit.eligibleCents - (closure.cashDeposit.paidCents ?? 0));
      }
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

/** Fluxo Dinheiro: fechamento do caixa e depósito. Falha na leitura deixa só este fluxo indisponível, com evento de erro. */
export async function readCashFlow(input: Input): Promise<ClosingFlow> {
  const now = input.now ?? new Date();
  const cash = await readCash(input, monthBounds(input.month), now).catch((error) => {
    reportSystemError({ error, source: "api-financial", operation: "month-closing-cash", routeOrJob: "/api/financial/month-closing" });
    return null;
  });
  return evaluateCashFlow({ cash, canViewItems: input.canViewItems, originHref: `${FINANCIAL_ROUTES.cashClosures}?${query({ month: input.month })}` });
}
