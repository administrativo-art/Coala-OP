import { PENDING_RECEIPT_STATUSES, type ReceiptParcelStatus } from "../receipts-reconciliation/stone-account";
import { formatCents, formatDateBr } from "./month";
import type { ClosingCheck, ClosingFlow, ClosingItem, ClosingItemKind } from "./types";

type ParcelSource = "card" | "pix";

/** Parcela da conta Stone, já separada por fluxo (à vista ou parcelado) para a competência. */
export type CardPixParcelInput = {
  id: string;
  source: ParcelSource;
  status: ReceiptParcelStatus;
  expectedDate: string | null;
  netCents: number;
};

/** Parcela como vem da conferência Stone, antes de ser separada em à vista e parcelado. */
export type StoneReceiptParcelInput = CardPixParcelInput & { saleDate: string | null; installmentCount: number };

/**
 * Dois jeitos de contar o recebimento (decisão de 2026-11-22):
 * - À vista (débito, crédito 1x e Pix): conta no mês da **venda**, qualquer que seja a data em que a parcela cai. Crédito
 *   vendido em outubro e pago em novembro é de outubro; o fluxo só fecha quando tudo foi pago.
 * - Parcelado (crédito em 2x ou mais): conta no mês em que a parcela **vence**, de qualquer mês de venda. Cada mês fecha o
 *   que venceu nele; as parcelas futuras ficam para o acompanhamento das vendas parceladas.
 */
export function splitReceiptParcels(parcels: StoneReceiptParcelInput[], month: string) {
  const inMonth = (date: string | null) => !!date && date.slice(0, 7) === month;
  const cashSale: CardPixParcelInput[] = [];
  const installment: CardPixParcelInput[] = [];
  for (const { saleDate, installmentCount, ...parcel } of parcels) {
    if (installmentCount > 1) {
      if (inMonth(parcel.expectedDate)) installment.push(parcel);
    } else if (inMonth(saleDate ?? parcel.expectedDate)) cashSale.push(parcel);
  }
  return { cashSale, installment };
}

/** Conferência Stone salva do mês considerado no fechamento (a própria competência). */
export type CardPixSourceInput = {
  month: string;
  ready: boolean;
  /** Salva depois do fim da competência, com o mês inteiro publicado pela Stone. */
  complete: boolean;
  /** Dias do mês em que a Stone não trouxe o Pix processado: sem eles o recebimento do Pix não foi conferido. */
  pixUnavailableDays?: number;
};

export type CardPixUnitInput = {
  key: string;
  label: string;
  href: string;
  sources: CardPixSourceInput[];
  /** Só as parcelas que contam neste fluxo para a competência. */
  parcels: CardPixParcelInput[];
};

export type CardPixFlowInput = { units: CardPixUnitInput[]; canViewItems: boolean; originHref: string };

/** Meses de venda lidos no fechamento: só a própria competência, e só se o vínculo Stone já vigorava nela. */
export const cardPixSourceMonths = (month: string, validFrom: string, monthThrough: string) => (monthThrough >= validFrom ? [month] : []);

type Variant = {
  key: "card_pix" | "card_installments";
  name: string;
  prefix: string;
  sources: ParcelSource[];
  checks: Record<ParcelSource, { id: string; name: string }>;
};

const SOURCE_NAME: Record<ParcelSource, string> = { card: "cartão", pix: "Pix" };
const CARD_PIX: Variant = {
  key: "card_pix", name: "Recebimento · Cartão e Pix", prefix: "card_pix", sources: ["card", "pix"],
  checks: { card: { id: "card_pix.card", name: "Cartão recebido (vendas do mês)" }, pix: { id: "card_pix.pix", name: "Pix recebido (vendas do mês)" } },
};
const INSTALLMENTS: Variant = {
  key: "card_installments", name: "Recebimento · Cartão parcelado", prefix: "card_installments", sources: ["card"],
  checks: { card: { id: "card_installments.card", name: "Parcelas recebidas no mês" }, pix: { id: "card_installments.pix", name: "Pix" } },
};
const SOURCES_NAME = "Conferência Stone do mês";

/** O que falta por situação: ordem de exibição, tipo do item e texto (singular e plural). */
const PENDING_KINDS: Array<{ status: ReceiptParcelStatus; kind: ClosingItemKind; one: string; many: string }> = [
  { status: "unpaid", kind: "card_pix_unpaid", one: "não recebida", many: "não recebidas" },
  { status: "chargeback", kind: "card_pix_chargeback", one: "com estorno", many: "com estorno" },
  { status: "review", kind: "card_pix_review", one: "em revisão", many: "em revisão" },
  { status: "paid_late", kind: "card_pix_late", one: "paga depois do previsto", many: "pagas depois do previsto" },
  { status: "missing_file", kind: "card_pix_missing_file", one: "sem o arquivo da Stone do dia", many: "sem o arquivo da Stone do dia" },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const dayLabel = (date: string) => formatDateBr(date).slice(0, 5);
const trusted = (source: CardPixSourceInput) => source.ready && source.complete;
const unitTrusted = (unit: CardPixUnitInput) => unit.sources.length > 0 && unit.sources.every(trusted);
const sum = (rows: CardPixParcelInput[]) => rows.reduce((total, row) => total + row.netCents, 0);

/** Pendente = ainda não entrou na conta Stone. `to_receive` é a parcela dentro do prazo da Stone, que ainda vai cair. */
const isPending = (status: ReceiptParcelStatus) => status === "to_receive" || PENDING_RECEIPT_STATUSES.includes(status);

/** “previstas de 05/10 a 20/10”, ou a data única. */
function expectedRange(rows: CardPixParcelInput[]) {
  const dates = rows.map((row) => row.expectedDate).filter((date): date is string => !!date).sort();
  if (dates.length === 0) return "";
  const [first, last] = [dates[0], dates[dates.length - 1]];
  return first === last ? ` · prevista em ${dayLabel(first)}` : ` · previstas de ${dayLabel(first)} a ${dayLabel(last)}`;
}

/**
 * Sem a conferência salva do mês, as contagens são desconhecidas: contam como pendentes, nunca como zero. O que falta
 * aparece por unidade, por cartão ou Pix e por situação, com valor e datas. Parcela dentro do prazo da Stone não trava
 * ninguém: aparece como “dentro do prazo” e define até quando esperar.
 */
function evaluateReceipts(input: CardPixFlowInput, variant: Variant): ClosingFlow {
  const sourcesId = `${variant.prefix}.sources`;
  const units = input.units;
  const items: ClosingItem[] = [];
  let readyFrom: string | null = null;
  for (const unit of units) {
    for (const source of unit.sources.filter((entry) => !trusted(entry))) {
      items.push({
        id: `${variant.prefix}:${unit.key}:${source.month}:not-ready`, checkId: sourcesId, kind: "card_pix_not_ready", tone: "warn", title: unit.label,
        detail: source.ready
          ? `A conferência Stone de ${monthLabel(source.month)} foi salva antes de o mês fechar. Refaça com o arquivo completo da Stone.`
          : `A conferência Stone de ${monthLabel(source.month)} ainda não foi salva.`,
        dueDate: null, amountCents: null, href: unit.href,
      });
    }
    if (!unit.sources.every((source) => source.ready)) continue;
    for (const source of variant.sources) {
      const rows = unit.parcels.filter((parcel) => parcel.source === source);
      for (const entry of PENDING_KINDS) {
        const group = rows.filter((parcel) => parcel.status === entry.status);
        if (group.length === 0) continue;
        items.push({
          id: `${variant.prefix}:${unit.key}:${source}:${entry.status}`, checkId: variant.checks[source].id, kind: entry.kind, tone: "warn", title: unit.label,
          detail: `${plural(group.length, "parcela", "parcelas")} de ${SOURCE_NAME[source]} ${group.length === 1 ? entry.one : entry.many}${expectedRange(group)}`,
          dueDate: null, amountCents: sum(group), href: unit.href,
        });
      }
      const awaiting = rows.filter((parcel) => parcel.status === "to_receive");
      if (awaiting.length > 0) {
        const latest = awaiting.reduce<string | null>((last, parcel) => (parcel.expectedDate && (!last || parcel.expectedDate > last) ? parcel.expectedDate : last), null);
        if (latest && (!readyFrom || latest > readyFrom)) readyFrom = latest;
        items.push({
          id: `${variant.prefix}:${unit.key}:${source}:awaiting`, checkId: variant.checks[source].id, kind: "card_pix_awaiting", tone: "info", title: unit.label,
          detail: `${plural(awaiting.length, "parcela", "parcelas")} de ${SOURCE_NAME[source]} ainda dentro do prazo da Stone${expectedRange(awaiting)}`,
          dueDate: latest, amountCents: sum(awaiting), href: unit.href,
        });
      }
    }
  }
  const sourceDone = units.filter(unitTrusted).length;
  const allTrusted = units.length > 0 && sourceDone === units.length;
  const bySource = (source: ParcelSource): ClosingCheck => {
    const { id, name } = variant.checks[source];
    if (!allTrusted) return { id, name, state: "pending", done: null, total: null, note: "Aguarda as conferências Stone dos meses." };
    if (source === "pix") {
      const days = units.flatMap((unit) => unit.sources).reduce((total, entry) => total + (entry.pixUnavailableDays ?? 0), 0);
      if (days > 0) return { id, name, state: "unavailable", done: null, total: null, note: `A Stone não trouxe o Pix processado em ${plural(days, "dia", "dias")}; o recebimento do Pix não foi conferido.` };
    }
    const rows = units.flatMap((unit) => unit.parcels).filter((parcel) => parcel.source === source);
    const pending = rows.filter((parcel) => isPending(parcel.status));
    return {
      id, name, state: pending.length === 0 ? "ok" : "pending", done: rows.length - pending.length, total: rows.length,
      ...(pending.length > 0 ? { note: `Faltam ${pending.length} de ${rows.length} parcelas, ${formatCents(sum(pending))}.` }
        : rows.length === 0 && variant.key === "card_installments" ? { note: "Nenhuma parcela de venda parcelada vence neste mês." } : {}),
    };
  };
  const checks: ClosingCheck[] = units.length === 0
    ? [{ id: sourcesId, name: SOURCES_NAME, state: "unavailable", done: null, total: null, note: "Nenhum vínculo Stone vigente nesta competência." }]
    : [
      { id: sourcesId, name: SOURCES_NAME, state: allTrusted ? "ok" : "pending", done: sourceDone, total: units.length },
      ...variant.sources.map(bySource),
    ];
  const state = checks.some((check) => check.state === "pending") ? "pending"
    : checks.some((check) => check.state === "unavailable") ? "unavailable" : "ok";
  return {
    key: variant.key, name: variant.name, state, checks,
    items: input.canViewItems ? items : [], itemsHidden: !input.canViewItems && items.length > 0,
    readyFrom, originHref: input.originHref,
  };
}

/** Recebimento do cartão e Pix à vista, por venda do mês. */
export const evaluateCardPixFlow = (input: CardPixFlowInput) => evaluateReceipts(input, CARD_PIX);
/** Recebimento do cartão parcelado, por parcela que vence no mês. */
export const evaluateCardInstallmentsFlow = (input: CardPixFlowInput) => evaluateReceipts(input, INSTALLMENTS);

function unavailable(variant: Variant, originHref: string): ClosingFlow {
  return {
    key: variant.key, name: variant.name, state: "unavailable", itemsHidden: false, items: [], readyFrom: null, originHref,
    checks: [{ id: `${variant.prefix}.sources`, name: SOURCES_NAME, state: "unavailable", done: null, total: null, note: "Não foi possível ler o recebimento agora. Tente de novo." }],
  };
}
export const cardPixFlowUnavailable = (originHref: string) => unavailable(CARD_PIX, originHref);
export const cardInstallmentsFlowUnavailable = (originHref: string) => unavailable(INSTALLMENTS, originHref);
