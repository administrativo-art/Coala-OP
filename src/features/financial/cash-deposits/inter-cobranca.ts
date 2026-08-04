import type { InterCobrancaDetail } from "@/lib/integrations/inter/cobrancas";
import type { InterCobrancaPayer } from "@/lib/integrations/inter/config.server";
import { todayInClosureTimezone } from "../cash-closures/date";
import type { CashDepositBatch } from "./types";
import { cashDepositKioskCode } from "./references";

export const MIN_BOLETO_CENTS = 250;

export type InterCobrancaStatus =
  | "issuing"
  | "requested"
  | "issued"
  | "marked_received"
  | "paid"
  | "cancelled"
  | "failed";

export type InterCobrancaDocument = {
  id: string;
  workspaceId: string;
  batchId: string;
  kioskId: string;
  kioskName: string;
  attempt: number;
  status: InterCobrancaStatus;
  situacao: string | null;
  seuNumero: string;
  codigoSolicitacao: string | null;
  previousInterCobrancaId: string | null;
  valorNominalCents: number;
  dataVencimento: string;
  numDiasAgenda: number;
  formasRecebimento: Array<"BOLETO" | "PIX">;
  origemRecebimento: string | null;
  valorTotalRecebidoCents: number;
  recebidoManual: boolean;
  nossoNumero: string | null;
  codigoBarras: string | null;
  linhaDigitavel: string | null;
  txid: string | null;
  pixCopiaECola: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  lastCheckedAt: string | null;
  ledgerTransactionId: string | null;
  ledgerPostedAt: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
};

export type InterCobrancaEvent = {
  id: string;
  workspaceId: string;
  interCobrancaId: string | null;
  codigoSolicitacao: string | null;
  kind:
    | "issue_requested"
    | "issue_response"
    | "issue_result_unknown"
    | "recovered_by_seu_numero"
    | "active_query"
    | "webhook"
    | "cancel_requested"
    | "error";
  idempotencyKey: string | null;
  rawPayload: unknown;
  createdAt: string;
};

export function deterministicSeuNumero(input: {
  kioskId: string;
  periodEndDate: string;
  batchSequence: number;
  attempt: number;
}) {
  const date = input.periodEndDate.replace(/-/g, "").slice(2);
  const sequence = Math.max(0, input.batchSequence % 1000) * 10 + Math.min(Math.max(input.attempt, 0), 9);
  return `CX${cashDepositKioskCode(input.kioskId)}${date}${String(sequence).padStart(4, "0")}`;
}

export function parseInterMoneyToCents(value: unknown) {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function mapInterSituation(situacao: string): {
  status: InterCobrancaStatus;
  batchStatus: CashDepositBatch["status"] | null;
  closureDepositStatus: "issued" | "paid" | "allocated" | null;
  warning: string | null;
} {
  switch (situacao) {
    case "EM_PROCESSAMENTO":
      return { status: "requested", batchStatus: "issuing", closureDepositStatus: null, warning: null };
    case "A_RECEBER":
    case "ATRASADO":
    case "PROTESTO":
      return { status: "issued", batchStatus: "issued", closureDepositStatus: "issued", warning: null };
    case "RECEBIDO":
      return { status: "paid", batchStatus: "paid", closureDepositStatus: "paid", warning: null };
    case "MARCADO_RECEBIDO":
      return {
        status: "marked_received",
        batchStatus: "issued",
        closureDepositStatus: "issued",
        warning: "Cobrança marcada manualmente como recebida no Inter; liquidação bancária não confirmada.",
      };
    case "CANCELADO":
    case "EXPIRADO":
      return { status: "cancelled", batchStatus: "cancelled", closureDepositStatus: "allocated", warning: null };
    case "FALHA_EMISSAO":
      return { status: "failed", batchStatus: "failed", closureDepositStatus: "allocated", warning: null };
    default:
      return {
        status: "requested",
        batchStatus: null,
        closureDepositStatus: null,
        warning: `Situação Inter desconhecida: ${situacao}`,
      };
  }
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida: ${value}`);
  return date;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addBusinessDays(
  startDate: string,
  days: number,
  holidays: Iterable<string> = [],
) {
  const holidaySet = new Set(holidays);
  const date = parseDateKey(startDate);
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const key = dateKey(date);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidaySet.has(key)) remaining--;
  }
  return dateKey(date);
}

export function buildInterCobrancaIssueInput(input: {
  batch: CashDepositBatch;
  attempt: number;
  payer: InterCobrancaPayer;
  dueBusinessDays: number;
  numDiasAgenda: number;
  holidays?: string[];
  today?: string;
}) {
  if (!Number.isSafeInteger(input.batch.totalCents) || input.batch.totalCents < MIN_BOLETO_CENTS) {
    throw new Error("O bloco não atinge o valor mínimo de R$ 2,50 para emissão.");
  }
  if (input.batch.totalCents > input.batch.maxCents) {
    throw new Error("O bloco ultrapassa o limite de depósito.");
  }
  const dataVencimento = addBusinessDays(
    input.today ?? todayInClosureTimezone(),
    input.dueBusinessDays,
    input.holidays,
  );
  return {
    seuNumero: deterministicSeuNumero({
      kioskId: input.batch.kioskId,
      periodEndDate: input.batch.periodEndDate,
      batchSequence: input.batch.sequence,
      attempt: input.attempt,
    }),
    valorNominal: input.batch.totalCents / 100,
    dataVencimento,
    numDiasAgenda: input.numDiasAgenda,
    pagador: input.payer,
    formasRecebimento: ["BOLETO", "PIX"] as Array<"BOLETO" | "PIX">,
  };
}

export function detailFields(detail: InterCobrancaDetail) {
  return {
    situacao: detail.cobranca.situacao,
    origemRecebimento: detail.cobranca.origemRecebimento ?? null,
    valorTotalRecebidoCents: parseInterMoneyToCents(detail.cobranca.valorTotalRecebido),
    recebidoManual: detail.cobranca.situacao === "MARCADO_RECEBIDO",
    nossoNumero: detail.boleto?.nossoNumero ?? null,
    codigoBarras: detail.boleto?.codigoBarras ?? null,
    linhaDigitavel: detail.boleto?.linhaDigitavel ?? null,
    txid: detail.pix?.txid ?? null,
    pixCopiaECola: detail.pix?.pixCopiaECola ?? null,
  };
}
