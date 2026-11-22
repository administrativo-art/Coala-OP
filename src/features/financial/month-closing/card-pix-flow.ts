import { PENDING_RECEIPT_STATUSES, type ReceiptParcelStatus } from "../receipts-reconciliation/stone-account";
import { formatCents, formatDateBr } from "./month";
import type { ClosingCheck, ClosingFlow, ClosingItem, ClosingItemKind } from "./types";

type ParcelSource = "card" | "pix";

/** Parcela da conta Stone, de venda da competência, com data prevista dentro dela. */
export type CardPixParcelInput = {
  id: string;
  source: ParcelSource;
  status: ReceiptParcelStatus;
  expectedDate: string | null;
  netCents: number;
};

/** Conferência Stone salva do mês de venda considerado no fechamento (a própria competência). */
export type CardPixSourceInput = {
  month: string;
  ready: boolean;
  /** Salva depois do fim da competência, com o mês inteiro publicado pela Stone. */
  complete: boolean;
};

export type CardPixUnitInput = {
  key: string;
  label: string;
  href: string;
  sources: CardPixSourceInput[];
  /** Só as parcelas com data prevista na competência. */
  parcels: CardPixParcelInput[];
};

export type CardPixFlowInput = { units: CardPixUnitInput[]; canViewItems: boolean; originHref: string };

const CHECK_SOURCES = "card_pix.sources";
const CHECK_CARD = "card_pix.card";
const CHECK_PIX = "card_pix.pix";

const SOURCES: ParcelSource[] = ["card", "pix"];
const SOURCE_NAME: Record<ParcelSource, string> = { card: "cartão", pix: "Pix" };
const SOURCE_CHECK: Record<ParcelSource, { id: string; name: string }> = {
  card: { id: CHECK_CARD, name: "Cartão previsto no mês" },
  pix: { id: CHECK_PIX, name: "Pix previsto no mês" },
};

/** O que falta por situação: ordem de exibição, tipo do item e texto (singular e plural). */
const PENDING_KINDS: Array<{ status: ReceiptParcelStatus; kind: ClosingItemKind; one: string; many: string }> = [
  { status: "unpaid", kind: "card_pix_unpaid", one: "não recebida", many: "não recebidas" },
  { status: "chargeback", kind: "card_pix_chargeback", one: "com estorno", many: "com estorno" },
  { status: "review", kind: "card_pix_review", one: "em revisão", many: "em revisão" },
  { status: "paid_late", kind: "card_pix_late", one: "paga depois do previsto", many: "pagas depois do previsto" },
  { status: "missing_file", kind: "card_pix_missing_file", one: "sem o arquivo da Stone do dia", many: "sem o arquivo da Stone do dia" },
];

/** Meses de venda lidos no fechamento: só a própria competência, e só se o vínculo Stone já vigorava nela. */
export const cardPixSourceMonths = (month: string, validFrom: string, monthThrough: string) => (monthThrough >= validFrom ? [month] : []);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const dayLabel = (date: string) => formatDateBr(date).slice(0, 5);
const trusted = (source: CardPixSourceInput) => source.ready && source.complete;
const unitTrusted = (unit: CardPixUnitInput) => unit.sources.length > 0 && unit.sources.every(trusted);
const sum = (rows: CardPixParcelInput[]) => rows.reduce((total, row) => total + row.netCents, 0);

/** Pendente = ainda não entrou na conta Stone. `to_receive` dentro da competência só acontece enquanto a Stone não publicou o dia. */
const isPending = (status: ReceiptParcelStatus) => status === "to_receive" || PENDING_RECEIPT_STATUSES.includes(status);

/** “previstas de 05/10 a 20/10”, ou a data única. */
function expectedRange(rows: CardPixParcelInput[]) {
  const dates = rows.map((row) => row.expectedDate).filter((date): date is string => !!date).sort();
  if (dates.length === 0) return "";
  const [first, last] = [dates[0], dates[dates.length - 1]];
  return first === last ? ` · prevista em ${dayLabel(first)}` : ` · previstas de ${dayLabel(first)} a ${dayLabel(last)}`;
}

/**
 * Cartão e Pix: parcelas das vendas da competência com data prevista dentro dela. Setembro e meses anteriores não
 * entram. Sem a conferência salva do mês, as contagens são desconhecidas: contam como pendentes, nunca como zero.
 * O que falta aparece por unidade, por cartão ou Pix e por situação, com valor e datas.
 */
export function evaluateCardPixFlow(input: CardPixFlowInput): ClosingFlow {
  const units = input.units;
  const items: ClosingItem[] = [];
  let readyFrom: string | null = null;
  for (const unit of units) {
    for (const source of unit.sources.filter((entry) => !trusted(entry))) {
      items.push({
        id: `card-pix:${unit.key}:${source.month}:not-ready`, checkId: CHECK_SOURCES, kind: "card_pix_not_ready", tone: "warn", title: unit.label,
        detail: source.ready
          ? `A conferência Stone de ${monthLabel(source.month)} foi salva antes de o mês fechar. Refaça com o arquivo completo da Stone.`
          : `A conferência Stone de ${monthLabel(source.month)} ainda não foi salva.`,
        dueDate: null, amountCents: null, href: unit.href,
      });
    }
    if (!unit.sources.every((source) => source.ready)) continue;
    for (const source of SOURCES) {
      const rows = unit.parcels.filter((parcel) => parcel.source === source);
      for (const entry of PENDING_KINDS) {
        const group = rows.filter((parcel) => parcel.status === entry.status);
        if (group.length === 0) continue;
        items.push({
          id: `card-pix:${unit.key}:${source}:${entry.status}`, checkId: SOURCE_CHECK[source].id, kind: entry.kind, tone: "warn", title: unit.label,
          detail: `${plural(group.length, "parcela", "parcelas")} de ${SOURCE_NAME[source]} ${group.length === 1 ? entry.one : entry.many}${expectedRange(group)}`,
          dueDate: null, amountCents: sum(group), href: unit.href,
        });
      }
      const awaiting = rows.filter((parcel) => parcel.status === "to_receive");
      if (awaiting.length > 0) {
        const latest = awaiting.reduce<string | null>((last, parcel) => (parcel.expectedDate && (!last || parcel.expectedDate > last) ? parcel.expectedDate : last), null);
        if (latest && (!readyFrom || latest > readyFrom)) readyFrom = latest;
        items.push({
          id: `card-pix:${unit.key}:${source}:awaiting`, checkId: SOURCE_CHECK[source].id, kind: "card_pix_awaiting", tone: "info", title: unit.label,
          detail: `${plural(awaiting.length, "parcela", "parcelas")} de ${SOURCE_NAME[source]} ainda dentro do prazo da Stone${expectedRange(awaiting)}`,
          dueDate: latest, amountCents: sum(awaiting), href: unit.href,
        });
      }
    }
  }
  const sourceDone = units.filter(unitTrusted).length;
  const allTrusted = units.length > 0 && sourceDone === units.length;
  const bySource = (source: ParcelSource): ClosingCheck => {
    const { id, name } = SOURCE_CHECK[source];
    if (!allTrusted) return { id, name, state: "pending", done: null, total: null, note: "Aguarda as conferências Stone dos meses." };
    const rows = units.flatMap((unit) => unit.parcels).filter((parcel) => parcel.source === source);
    const pending = rows.filter((parcel) => isPending(parcel.status));
    return {
      id, name, state: pending.length === 0 ? "ok" : "pending", done: rows.length - pending.length, total: rows.length,
      ...(pending.length > 0 ? { note: `Faltam ${pending.length} de ${rows.length} parcelas, ${formatCents(sum(pending))}.` } : {}),
    };
  };
  const checks: ClosingCheck[] = units.length === 0
    ? [{ id: CHECK_SOURCES, name: "Conferência Stone do mês", state: "unavailable", done: null, total: null, note: "Nenhum vínculo Stone vigente nesta competência." }]
    : [
      { id: CHECK_SOURCES, name: "Conferência Stone do mês", state: allTrusted ? "ok" : "pending", done: sourceDone, total: units.length },
      bySource("card"),
      bySource("pix"),
    ];
  const state = checks.some((check) => check.state === "pending") ? "pending"
    : checks.some((check) => check.state === "unavailable") ? "unavailable" : "ok";
  return {
    key: "card_pix", name: "Cartão e Pix", state, checks,
    items: input.canViewItems ? items : [], itemsHidden: !input.canViewItems && items.length > 0,
    readyFrom, originHref: input.originHref,
  };
}

export function cardPixFlowUnavailable(originHref: string): ClosingFlow {
  return {
    key: "card_pix", name: "Cartão e Pix", state: "unavailable", itemsHidden: false, items: [], readyFrom: null, originHref,
    checks: [{ id: CHECK_SOURCES, name: "Conferência Stone do mês", state: "unavailable", done: null, total: null, note: "Não foi possível ler o recebimento agora. Tente de novo." }],
  };
}
