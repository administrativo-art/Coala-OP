import { PENDING_RECEIPT_STATUSES, type ReceiptParcelStatus } from "../receipts-reconciliation/stone-account";
import type { ClosingCheck, ClosingFlow, ClosingItem } from "./types";

/** Parcela da conta Stone com data prevista dentro da competência, venha ela de qualquer mês de venda. */
export type ReceiptsParcelInput = {
  id: string;
  status: ReceiptParcelStatus;
  expectedDate: string | null;
  netCents: number;
};

/** Conferência Stone salva de um mês de venda que pode ter parcelas caindo na competência. */
export type ReceiptsSourceInput = {
  month: string;
  ready: boolean;
  /** Salva depois do fim da competência, com o mês inteiro publicado pela Stone. */
  complete: boolean;
};

export type ReceiptsUnitInput = {
  key: string;
  label: string;
  href: string;
  sources: ReceiptsSourceInput[];
  /** Só as parcelas com data prevista na competência. */
  parcels: ReceiptsParcelInput[];
};

export type ReceiptsFlowInput = { units: ReceiptsUnitInput[]; canViewItems: boolean; originHref: string };

const CHECK_SOURCES = "receipts.sources";
const CHECK_CARDS = "receipts.cards";
const CHECK_CASH = "receipts.cash";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const trusted = (source: ReceiptsSourceInput) => source.ready && source.complete;
const unitTrusted = (unit: ReceiptsUnitInput) => unit.sources.length > 0 && unit.sources.every(trusted);

/** Pendente = ainda não entrou na conta Stone. `to_receive` dentro da competência só acontece enquanto a Stone não publicou o dia. */
const isPending = (status: ReceiptParcelStatus) => status === "to_receive" || PENDING_RECEIPT_STATUSES.includes(status);

/**
 * Recebimento, etapa Pix e cartão: tudo o que estava previsto para cair na conta Stone na competência
 * entrou, sem importar em que mês foi vendido. Parcela de venda antiga conta no mês em que vence; crédito
 * à vista de 30 dias vendido no fim do mês pertence ao mês seguinte. Sem a conferência salva dos meses de
 * venda, as contagens são desconhecidas: contam como pendentes, nunca como zero.
 * A etapa do dinheiro só existe depois do fechamento do mês e ainda não está conectada.
 */
export function evaluateReceiptsFlow(input: ReceiptsFlowInput): ClosingFlow {
  const units = input.units;
  const items: ClosingItem[] = [];
  let readyFrom: string | null = null;
  for (const unit of units) {
    for (const source of unit.sources.filter((entry) => !trusted(entry))) {
      items.push({
        id: `receipts:${unit.key}:${source.month}:not-ready`, checkId: CHECK_SOURCES, kind: "receipts_not_ready", tone: "warn", title: unit.label,
        detail: source.ready
          ? `A conferência Stone de ${monthLabel(source.month)} foi salva antes de o mês fechar. Refaça com o arquivo completo da Stone.`
          : `A conferência Stone de ${monthLabel(source.month)} ainda não foi salva.`,
        dueDate: null, amountCents: null, href: unit.href,
      });
    }
    if (!unit.sources.every((source) => source.ready)) continue;
    const pending = unit.parcels.filter((parcel) => isPending(parcel.status));
    const awaiting = pending.filter((parcel) => parcel.status === "to_receive");
    const overdue = pending.filter((parcel) => parcel.status !== "to_receive");
    const sum = (rows: ReceiptsParcelInput[]) => rows.reduce((total, row) => total + row.netCents, 0);
    if (overdue.length > 0) {
      items.push({
        id: `receipts:${unit.key}:pending`, checkId: CHECK_CARDS, kind: "receipts_pending", tone: "warn", title: unit.label,
        detail: plural(overdue.length, "parcela prevista no mês ainda não recebida", "parcelas previstas no mês ainda não recebidas"),
        dueDate: null, amountCents: sum(overdue), href: unit.href,
      });
    }
    if (awaiting.length > 0) {
      const latest = awaiting.reduce<string | null>((last, parcel) => (parcel.expectedDate && (!last || parcel.expectedDate > last) ? parcel.expectedDate : last), null);
      if (latest && (!readyFrom || latest > readyFrom)) readyFrom = latest;
      items.push({
        id: `receipts:${unit.key}:awaiting`, checkId: CHECK_CARDS, kind: "receipts_awaiting", tone: "info", title: unit.label,
        detail: plural(awaiting.length, "parcela prevista no mês ainda dentro do prazo da Stone", "parcelas previstas no mês ainda dentro do prazo da Stone"),
        dueDate: latest, amountCents: sum(awaiting), href: unit.href,
      });
    }
  }
  const sourceDone = units.filter(unitTrusted).length;
  const cardsDone = units.filter((unit) => unitTrusted(unit) && !unit.parcels.some((parcel) => isPending(parcel.status))).length;
  const cash: ClosingCheck = {
    id: CHECK_CASH, name: "Dinheiro depositado", state: "unavailable", done: null, total: null,
    note: "Confere depois do fechamento do mês.",
  };
  const checks: ClosingCheck[] = units.length === 0
    ? [
      { id: CHECK_SOURCES, name: "Conferências Stone dos meses", state: "unavailable", done: null, total: null, note: "Nenhum vínculo Stone vigente nesta competência." },
      cash,
    ]
    : [
      { id: CHECK_SOURCES, name: "Conferências Stone dos meses", state: sourceDone === units.length ? "ok" : "pending", done: sourceDone, total: units.length },
      { id: CHECK_CARDS, name: "Pix e cartão previstos no mês", state: cardsDone === units.length ? "ok" : "pending", done: cardsDone, total: units.length },
      cash,
    ];
  const state = checks.some((check) => check.state === "pending") ? "pending"
    : checks.some((check) => check.state === "unavailable") ? "unavailable" : "ok";
  return {
    key: "receipts", name: "Recebimento", state, checks,
    items: input.canViewItems ? items : [], itemsHidden: !input.canViewItems && items.length > 0,
    readyFrom, originHref: input.originHref,
  };
}

export function receiptsFlowUnavailable(originHref: string): ClosingFlow {
  return {
    key: "receipts", name: "Recebimento", state: "unavailable", itemsHidden: false, items: [], readyFrom: null, originHref,
    checks: [{ id: CHECK_SOURCES, name: "Conferências Stone dos meses", state: "unavailable", done: null, total: null, note: "Não foi possível ler o recebimento agora. Tente de novo." }],
  };
}
