import { formatStoneMoney } from "../agent/presentation";
import type { DailySalesApiResult, DailySalesReviewStatus } from "./review-state";
import type { SalesSourceIssue } from "./daily-review";
import type {
  ReconciliationSalesChannel,
  SalesMatchFact,
  SuggestedSalesReconciliationCase,
  SalesReconciliationCaseKind,
  SalesReconciliationMatchBasis,
} from "./types";

export type CaseFilter = "attention" | "all" | "auto";
export type ChannelFilter = "all" | ReconciliationSalesChannel;
export type KindFilter = "all" | Exclude<SalesReconciliationCaseKind, "matched">;

export const channelOrder: ReconciliationSalesChannel[] = ["pix", "debit_card", "credit_card"];

export const channels: Record<ReconciliationSalesChannel, string> = {
  pix: "Pix",
  debit_card: "Débito",
  credit_card: "Crédito",
};

export const kinds: Record<SalesReconciliationCaseKind, string> = {
  matched: "Conferida automaticamente",
  pdv_only: "Venda somente no PDV",
  stone_only: "Captura somente na Stone",
  amount_mismatch: "Valores diferentes",
  status_mismatch: "Estados diferentes",
  unit_mismatch: "Unidades diferentes",
  unit_unmapped: "Unidade não identificada",
  ambiguous: "Correspondência ambígua",
};

export const kindsShort: Record<Exclude<SalesReconciliationCaseKind, "matched">, string> = {
  pdv_only: "Só no PDV",
  stone_only: "Só na Stone",
  amount_mismatch: "Valor diferente",
  status_mismatch: "Estado diferente",
  unit_mismatch: "Unidade diferente",
  unit_unmapped: "Unidade não identificada",
  ambiguous: "Ambígua",
};

export const caseReasons: Record<SalesReconciliationCaseKind, string> = {
  matched: "Valor, unidade e evidências são compatíveis dentro deste recorte.",
  pdv_only: "O pagamento aparece no PDV, mas não foi localizado na fonte Stone consultada.",
  stone_only: "A captura aparece na Stone, mas não foi localizada no PDV deste recorte.",
  amount_mismatch: "As evidências apontam para a mesma venda, porém os valores não coincidem.",
  status_mismatch: "A situação informada pelo PDV diverge do evento encontrado na Stone.",
  unit_mismatch: "As evidências relacionadas pertencem a unidades diferentes.",
  unit_unmapped: "Uma das fontes não possui vínculo oficial com a unidade selecionada.",
  ambiguous: "Há mais de uma combinação possível ou a evidência não identifica um par único.",
};

export const multisetReason = "Os valores e as quantidades coincidem no dia. A conferência vale para o conjunto e não identifica qual captura pertence a cada pagamento.";

export const bases: Record<SalesReconciliationMatchBasis, string> = {
  provider_transaction_id: "NSU PDV = ID Stone",
  nsu_authorization_terminal: "NSU + autorização + terminal",
  merchant_order: "Referência explícita do pedido",
  unique_amount_time: "Par único por valor e janela de cinco minutos",
  daily_amount_multiset: "Mesmo conjunto de valores e quantidades no dia",
  candidate_group: "Grupo de candidatos por horário",
  unmatched: "Sem par neste recorte",
};

export const providerTransactionLabels: Record<SalesMatchFact["source"], string> = {
  pdv: "NSU informado pelo PDV",
  stone: "ID da transação Stone",
};

export const confidences: Record<SuggestedSalesReconciliationCase["confidence"], string> = {
  high: "Confiança alta",
  medium: "Confiança média",
  none: "Sem confiança de par",
};

export const issueReasons: Record<SalesSourceIssue["reason"], string> = {
  invalid_coupon: "Cupom sem identificação válida",
  duplicate_coupon: "Cupom duplicado",
  invalid_payments: "Pagamentos incompletos ou total divergente",
  invalid_date: "Data inválida ou ausente",
  outside_day: "Registro fora do dia",
  unsupported_channel: "Meio de pagamento não comparável",
  invalid_amount: "Valor inválido ou com fração de centavo",
  non_capture_event: "Evento que não é uma nova venda",
  cancellation_event: "Cancelamento/estorno informado pela Stone exige conferir o histórico da venda",
  cancellation_charge_event: "Desconto de cancelamento informado pela Stone exige conferir o histórico da venda",
  chargeback_event: "Chargeback informado pela Stone exige conferir o histórico da venda",
  chargeback_refund_event: "Estorno de chargeback informado pela Stone exige conferir o histórico da venda",
  unsupported_capture: "Captura incompleta ou não suportada",
};

export const stoneEventLabels: Record<string, string> = {
  Captures: "Capturas",
  Payments: "Pagamentos",
  Cancellations: "Cancelamentos",
  CancellationCharges: "Descontos de cancelamento",
  Chargebacks: "Chargebacks",
  ChargebackRefunds: "Estornos de chargeback",
};

export const saleStatuses: Record<SalesMatchFact["status"], string> = {
  approved: "Captura informada",
  pending: "Aprovação não informada pelo PDV",
  partial_cancellation: "Cancelamento parcial no PDV",
  cancelled: "Cancelado",
  refunded: "Estornado",
  chargeback: "Chargeback",
};

export const pixSourceLabels: Record<DailySalesApiResult["pix"]["status"], string> = {
  available: "arquivo recebido",
  requested: "solicitado à Stone; aguardando arquivo",
  pending: "arquivo recebido; processamento ou formato pendente",
  failed: "falha no recebimento ou processamento",
  unavailable: "arquivo ainda não recebido",
  not_configured: "integração não configurada",
};

export const reviewStatuses: Record<DailySalesReviewStatus, string> = {
  closed: "Dia fechado automaticamente",
  attention_required: "Dia aberto: requer atenção",
  awaiting_source: "Dia aberto: aguardando fonte",
};

export const money = (cents: number) => {
  const absolute = BigInt(Math.abs(cents));
  return formatStoneMoney(`${cents < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`);
};

export const formatDateKey = (key: string) => {
  const [year, month, day] = key.split("-");
  return year && month && day ? `${day}/${month}/${year}` : key;
};

export const addDays = (key: string, delta: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

export const isAttention = (row: SuggestedSalesReconciliationCase) => row.reviewStatus === "attention_required";
export const isMultiset = (row: SuggestedSalesReconciliationCase) => row.kind === "matched" && row.matchBasis === "daily_amount_multiset";
export const caseBadgeLabel = (row: SuggestedSalesReconciliationCase) => isMultiset(row) ? "Conjunto diário conferido" : kinds[row.kind];
export const caseReason = (row: SuggestedSalesReconciliationCase) => isMultiset(row) ? multisetReason : caseReasons[row.kind];
export const caseTime = (row: SuggestedSalesReconciliationCase, facts: Map<string, SalesMatchFact>) => {
  const fact = facts.get(row.pdvFactIds[0] ?? "") ?? facts.get(row.stoneSaleIds[0] ?? "");
  return fact ? new Date(fact.soldAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
};
export const factLabel = (fact: SalesMatchFact) => fact.couponId ? `Cupom ${fact.couponId}` : `Transação ${fact.identifiers.providerTransactionId ?? fact.id}`;

export function summarizeChannel(cases: SuggestedSalesReconciliationCase[], channel: ChannelFilter) {
  const list = cases.filter(row => channel === "all" || row.channel === channel);
  const pdv = list.reduce((sum, row) => sum + row.pdvGrossAmountCents, 0);
  const stone = list.reduce((sum, row) => sum + row.stoneGrossAmountCents, 0);
  const attention = list.filter(isAttention).length;
  return { list, pdv, stone, difference: stone - pdv, attention, auto: list.length - attention };
}

export function filterCases(cases: SuggestedSalesReconciliationCase[], filters: { channel: ChannelFilter; caseFilter: CaseFilter; kind: KindFilter }) {
  const inChannel = cases.filter(row => filters.channel === "all" || row.channel === filters.channel);
  const attention = inChannel.filter(isAttention);
  const kindCounts = new Map<SalesReconciliationCaseKind, number>();
  attention.forEach(row => kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1));
  // Um filtro por tipo só vale para divergências e se ainda existir no recorte atual.
  const kind: KindFilter = filters.caseFilter === "attention" && filters.kind !== "all" && kindCounts.has(filters.kind) ? filters.kind : "all";
  let rows = filters.caseFilter === "all" ? inChannel : filters.caseFilter === "auto" ? inChannel.filter(row => !isAttention(row)) : attention;
  if (kind !== "all") rows = rows.filter(row => row.kind === kind);
  return { inChannel, attention, auto: inChannel.length - attention.length, rows, kind, kindCounts };
}
