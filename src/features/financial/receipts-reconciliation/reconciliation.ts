import { z } from "zod";

export const BANK_CREDIT_GRACE_DAYS = 2;
export const MONEY_TOLERANCE = 0.01;

const civilDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const receiptReconciliationRequestSchema = z.object({
  kioskId: z.string().trim().min(1).max(180),
  stoneCode: z.string().regex(/^\d{1,20}$/),
  from: civilDateSchema,
  through: civilDateSchema,
}).strict().superRefine((value, context) => {
  const from = Date.parse(`${value.from}T00:00:00Z`);
  const through = Date.parse(`${value.through}T00:00:00Z`);
  const days = Number.isFinite(from) && Number.isFinite(through)
    ? Math.round((through - from) / 86_400_000) + 1
    : 0;
  if (value.from > value.through) context.addIssue({ code: z.ZodIssueCode.custom, path: ["through"], message: "O fim deve ser posterior ao início." });
  if (days < 1 || days > 31) context.addIssue({ code: z.ZodIssueCode.custom, path: ["through"], message: "Consulte no máximo 31 dias por vez." });
});
export type ReceiptReconciliationRequest = z.infer<typeof receiptReconciliationRequestSchema>;

export type StoneReceiptAdjustment = {
  kind: "cancellation" | "cancellation_charge" | "chargeback" | "chargeback_refund";
  count: number;
};

export type StoneReceiptSettlement = {
  id: string;
  transactionId: string;
  installment: number;
  paymentId: string | null;
  paymentDate: string;
  expectedPaymentDate: string | null;
  saleDate: string | null;
  grossAmount: number;
  netAmount: number;
  paymentEventCount: number;
  sourceFileId: string;
  sourceReferenceDate: string;
  adjustments: StoneReceiptAdjustment[];
};

export type BankCreditFact = {
  id: string;
  date: string;
  amount: number;
  description: string;
  references: string[];
  externalTransactionId: string | null;
};

export type ReceiptMatchStatus =
  | "received"
  | "received_with_adjustment"
  | "stone_payment_review"
  | "awaiting_bank_credit"
  | "missing_bank_credit"
  | "bank_amount_mismatch"
  | "ambiguous_bank_credit"
  | "bank_only";

export type ReceiptMatch = {
  id: string;
  status: Exclude<ReceiptMatchStatus, "bank_only">;
  stone: StoneReceiptSettlement;
  bank: BankCreditFact | null;
  candidateBankCredits: BankCreditFact[];
  amountDifference: number | null;
  dateDifferenceDays: number | null;
  explanation: string;
};

export type UnmatchedBankCredit = {
  id: string;
  status: "bank_only";
  bank: BankCreditFact;
  stoneOriginLikely: boolean;
  explanation: string;
};

export type ReceiptReconciliationResult = {
  matches: ReceiptMatch[];
  unmatchedBankCredits: UnmatchedBankCredit[];
  summary: {
    totalStoneSettlements: number;
    received: number;
    receivedWithAdjustment: number;
    stonePaymentReview: number;
    awaitingBankCredit: number;
    missingBankCredit: number;
    bankAmountMismatch: number;
    ambiguousBankCredit: number;
    bankOnly: number;
    stoneNetAmount: number;
    bankMatchedAmount: number;
  };
  limitations: string[];
};

function civilDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateAtNoon(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateDifferenceDays(from: string, through: string) {
  const first = dateAtNoon(from);
  const second = dateAtNoon(through);
  if (!first || !second) return null;
  return Math.round((second.getTime() - first.getTime()) / 86_400_000);
}

function addDays(value: string, amount: number) {
  const date = dateAtNoon(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function likelyStoneCredit(bank: BankCreditFact) {
  const text = `${bank.description} ${bank.references.join(" ")}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
  return /\bSTONE\b|STONECO|PAG(?:AMENTO)?\s*STONE|TON\s*PAG/.test(text);
}

function adjustmentLabel(adjustments: StoneReceiptAdjustment[]) {
  if (!adjustments.length) return "";
  return adjustments.map(adjustment => `${adjustment.kind} (${adjustment.count})`).join(", ");
}

function compareSettlement(settlement: StoneReceiptSettlement, bankCredits: BankCreditFact[], today: string): ReceiptMatch {
  const start = settlement.paymentDate;
  const end = addDays(settlement.paymentDate, BANK_CREDIT_GRACE_DAYS);
  const dated = bankCredits.filter(credit => credit.date >= start && credit.date <= end);
  const exact = dated.filter(credit => Math.abs(credit.amount - settlement.netAmount) <= MONEY_TOLERANCE);
  const adjustmentText = adjustmentLabel(settlement.adjustments);

  if (settlement.paymentEventCount !== 1) {
    const candidate = exact.length === 1 ? exact[0] : null;
    return {
      id: settlement.id,
      status: "stone_payment_review",
      stone: settlement,
      bank: candidate,
      candidateBankCredits: dated,
      amountDifference: candidate ? roundMoney(candidate.amount - settlement.netAmount) : null,
      dateDifferenceDays: candidate ? dateDifferenceDays(settlement.paymentDate, candidate.date) : null,
      explanation: "A Stone sinalizou mais de um evento de pagamento para a parcela; confira antes de considerar o recebimento conciliado.",
    };
  }

  if (exact.length === 1) {
    const bank = exact[0];
    const status = settlement.adjustments.length ? "received_with_adjustment" : "received";
    const dateDifference = dateDifferenceDays(settlement.paymentDate, bank.date);
    return {
      id: settlement.id,
      status,
      stone: settlement,
      bank,
      candidateBankCredits: dated,
      amountDifference: roundMoney(bank.amount - settlement.netAmount),
      dateDifferenceDays: dateDifference,
      explanation: status === "received_with_adjustment"
        ? `Crédito confirmado no banco; a Stone também informou ${adjustmentText}.`
        : "Crédito confirmado no banco na conta vinculada ao StoneCode.",
    };
  }

  if (exact.length > 1) {
    return {
      id: settlement.id,
      status: "ambiguous_bank_credit",
      stone: settlement,
      bank: null,
      candidateBankCredits: exact,
      amountDifference: null,
      dateDifferenceDays: null,
      explanation: "Há mais de um crédito bancário com o mesmo valor na janela de liquidação; a baixa exige revisão.",
    };
  }

  if (dated.length > 0) {
    const closest = [...dated].sort((a, b) =>
      Math.abs(a.amount - settlement.netAmount) - Math.abs(b.amount - settlement.netAmount)
    )[0];
    return {
      id: settlement.id,
      status: "bank_amount_mismatch",
      stone: settlement,
      bank: closest,
      candidateBankCredits: dated,
      amountDifference: roundMoney(closest.amount - settlement.netAmount),
      dateDifferenceDays: dateDifferenceDays(settlement.paymentDate, closest.date),
      explanation: adjustmentText
        ? `Existe crédito na janela, mas o valor não bate; a Stone informou ${adjustmentText}.`
        : "Existe crédito na janela de liquidação, mas o valor não bate com o líquido informado pela Stone.",
    };
  }

  const awaiting = today <= end;
  return {
    id: settlement.id,
    status: awaiting ? "awaiting_bank_credit" : "missing_bank_credit",
    stone: settlement,
    bank: null,
    candidateBankCredits: [],
    amountDifference: null,
    dateDifferenceDays: null,
    explanation: awaiting
      ? "A Stone informou a liquidação, mas o prazo de crédito ainda está aberto."
      : "A Stone informou a liquidação e o crédito não apareceu na conta vinculada dentro da janela esperada.",
  };
}

export function reconcileStoneReceipts(input: {
  settlements: StoneReceiptSettlement[];
  bankCredits: BankCreditFact[];
  today: string;
}) : ReceiptReconciliationResult {
  const today = civilDate(input.today);
  if (!today) throw new Error("A data atual da conciliação é inválida.");

  const claimedBankIds = new Set<string>();
  const matches = input.settlements.map(settlement => {
    const result = compareSettlement(settlement, input.bankCredits.filter(credit => !claimedBankIds.has(credit.id)), today);
    if (result.bank && (result.status === "received" || result.status === "received_with_adjustment" || result.status === "stone_payment_review")) {
      claimedBankIds.add(result.bank.id);
    }
    return result;
  });

  const unmatchedBankCredits = input.bankCredits
    .filter(credit => !claimedBankIds.has(credit.id))
    .map((bank): UnmatchedBankCredit => ({
      id: `bank-only:${bank.id}`,
      status: "bank_only",
      bank,
      stoneOriginLikely: likelyStoneCredit(bank),
      explanation: likelyStoneCredit(bank)
        ? "Crédito identificado como provável Stone, mas não há liquidação Stone compatível no recorte."
        : "Crédito de entrada sem liquidação Stone compatível no recorte; confirme a origem antes de classificar.",
    }));

  const count = (status: ReceiptMatchStatus) => matches.filter(match => match.status === status).length;
  return {
    matches,
    unmatchedBankCredits,
    summary: {
      totalStoneSettlements: matches.length,
      received: count("received"),
      receivedWithAdjustment: count("received_with_adjustment"),
      stonePaymentReview: count("stone_payment_review"),
      awaitingBankCredit: count("awaiting_bank_credit"),
      missingBankCredit: count("missing_bank_credit"),
      bankAmountMismatch: count("bank_amount_mismatch"),
      ambiguousBankCredit: count("ambiguous_bank_credit"),
      bankOnly: unmatchedBankCredits.length,
      stoneNetAmount: roundMoney(matches.reduce((total, match) => total + match.stone.netAmount, 0)),
      bankMatchedAmount: roundMoney(matches.reduce((total, match) => total + (match.bank && (match.status === "received" || match.status === "received_with_adjustment") ? match.bank.amount : 0), 0)),
    },
    limitations: [
      `Recebido significa crédito importado na conta bancária do vínculo; PaymentDate da Stone sozinho não baixa o recebimento.`,
      `A janela inicial aceita crédito entre a data de liquidação e +${BANK_CREDIT_GRACE_DAYS} dias civis.`,
      "A consulta não cria lançamento, pagamento, baixa ou ajuste financeiro.",
      "Créditos sem par podem ser de outra origem; a identificação textual de Stone é apenas um indício para revisão.",
    ],
  };
}
