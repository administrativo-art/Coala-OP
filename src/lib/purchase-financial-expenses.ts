import {
  resolveCardStatementCycle,
  resolveCardStatementCycleFromMonth,
  type CreditCardInstrument,
  type PlannedPaymentMethodType,
} from "@/features/financial/lib/card-invoices";
import { financialDateFromIso } from "@/features/financial/lib/financial-dates";
import { purchaseExpenseHasSettlementEvidence } from "@/lib/purchasing-order-reversal";

export type PurchaseFreightPaymentMode = "included_with_goods" | "separate";

export type PurchaseExpenseComponent = {
  role: "combined" | "goods" | "freight";
  description: string;
  supplier: string;
  totalValue: number;
  accountPlanId: string;
  accountPlanName: string;
  hasAccountAllocations: boolean;
  accountAllocations: Array<{
    accountPlanId: string;
    accountPlanName: string;
    amount: number;
  }> | null;
};

type PurchaseExpenseComponentInput = {
  totalValue: number;
  deliveryFee?: number | null;
  freightPaymentMode?: PurchaseFreightPaymentMode | null;
  goodsSupplier: string;
  freightSupplier?: string | null;
  goodsAccountPlanId?: string | null;
  goodsAccountPlanName?: string | null;
  freightAccountPlanId?: string | null;
  freightAccountPlanName?: string | null;
};

export type PurchasePaymentInstrument = CreditCardInstrument & {
  type: "credit_card" | "debit_card";
};

type PurchaseExpensePaymentInput = {
  paymentMethod?: unknown;
  paymentDueDate?: unknown;
  purchaseDate?: unknown;
  paymentCondition?: unknown;
  installmentsCount?: unknown;
  paymentAccountId?: unknown;
  paymentAccountName?: unknown;
  paymentMethodId?: unknown;
  paymentMethodLabel?: unknown;
};

export type PurchaseCardInstallmentAssignment = {
  number: number;
  dueDate: Date;
  cardStatementId: string;
  cardStatementKey: string;
  cardStatementMonthKey: string;
  cardReconciliationStatus: "pending";
  cardStatementRevisionStatus: "active";
};

export type PurchaseExpensePaymentPlan = {
  plannedPaymentMethodType: PlannedPaymentMethodType | null;
  plannedBankAccountId: string | null;
  plannedBankAccountName: string | null;
  plannedPaymentMethodId: string | null;
  plannedPaymentMethodLabel: string | null;
  dueDate: Date;
  firstInstallmentDueDate: Date | null;
  cardChargeDate: Date | null;
  originalCardChargeDate: string | null;
  cardStatementId: string | null;
  cardStatementKey: string | null;
  cardStatementMonthKey: string | null;
  cardReconciliationStatus: "pending" | null;
  cardStatementRevisionStatus: "active" | null;
  installmentAssignments: PurchaseCardInstallmentAssignment[];
};

function money(value: unknown) {
  return Math.max(Math.round((Number(value) || 0) * 100) / 100, 0);
}

function purchasePlannedPaymentMethodType(value: unknown): PlannedPaymentMethodType | null {
  if (value === "card_credit") return "credit_card";
  if (value === "card_debit") return "debit_card";
  return null;
}

function hasLockedCardStatementEvidence(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    String(record.cardStatementImportFingerprint || "").trim()
    || (Array.isArray(record.cardStatementImportFingerprints) && record.cardStatementImportFingerprints.length > 0)
    || record.cardStatementRegisteredValue !== null && record.cardStatementRegisteredValue !== undefined
    || record.cardReconciliationStatus === "reconciled"
    || record.cardReconciliationStatus === "not_required"
    || record.cardStatementRevisionStatus === "removed"
    || record.cardStatementAuditDisposition === "waived_before_dre_start",
  );
}

/**
 * Uma importação oficial passa a ser a fonte de verdade da linha da fatura.
 * O sincronismo do pedido não pode reconstruir essa linha e apagar a revisão,
 * o valor registrado ou o vínculo de conciliação.
 */
export function purchaseExpenseHasLockedCardStatementEvidence(expense: unknown) {
  if (!expense || typeof expense !== "object") return false;
  const record = expense as Record<string, unknown>;
  if (hasLockedCardStatementEvidence(record)) return true;
  return Array.isArray(record.installments)
    && record.installments.some(hasLockedCardStatementEvidence);
}

export function assertPurchaseExpenseCanSync(expense: unknown) {
  if (
    expense
    && typeof expense === "object"
    && purchaseExpenseHasSettlementEvidence(expense as Record<string, unknown>)
  ) {
    throw new Error(
      "A despesa da compra já possui liquidação e não pode ser ressíncronizada pelo pedido.",
    );
  }
  if (purchaseExpenseHasLockedCardStatementEvidence(expense)) {
    throw new Error(
      "A despesa da compra já possui uma importação oficial de fatura e não pode ser ressíncronizada pelo pedido.",
    );
  }
}

function cardStatementDocumentId(key: string) {
  return key.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function shiftMonth(monthKey: string, offset: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error("Competência da fatura inválida.");
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Traduz o meio de pagamento operacional da compra para o contrato financeiro.
 * A compra confirmada continua sendo uma despesa real; no crédito, estas
 * identidades apenas a projetam dentro da fatura que será conciliada depois.
 */
export function buildPurchaseExpensePaymentPlan(
  input: PurchaseExpensePaymentInput,
  instrument: PurchasePaymentInstrument | null,
  options: { separateFromOrderPayment?: boolean } = {},
): PurchaseExpensePaymentPlan {
  const paymentMethodType = options.separateFromOrderPayment
    ? null
    : purchasePlannedPaymentMethodType(input.paymentMethod);
  const rawPaymentDate = paymentMethodType === "credit_card" || paymentMethodType === "debit_card"
    ? input.purchaseDate
    : input.paymentDueDate;
  const paymentDateKey = String(rawPaymentDate || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const purchaseDate = financialDateFromIso(paymentDateKey);
  if (paymentMethodType && !instrument) {
    throw new Error("O cartão selecionado para a compra não foi encontrado na conta financeira.");
  }
  if (!options.separateFromOrderPayment && instrument && paymentMethodType !== instrument.type) {
    throw new Error("O tipo do cartão selecionado diverge do meio de pagamento da compra.");
  }

  const base = {
    plannedPaymentMethodType: paymentMethodType,
    plannedBankAccountId: instrument?.accountId ?? null,
    plannedBankAccountName: instrument?.accountName ?? null,
    plannedPaymentMethodId: instrument?.methodId ?? null,
    plannedPaymentMethodLabel: instrument?.methodLabel ?? null,
    dueDate: purchaseDate,
    firstInstallmentDueDate: input.paymentCondition === "installments" ? purchaseDate : null,
    cardChargeDate: null,
    originalCardChargeDate: null,
    cardStatementId: null,
    cardStatementKey: null,
    cardStatementMonthKey: null,
    cardReconciliationStatus: null,
    cardStatementRevisionStatus: null,
    installmentAssignments: [],
  } satisfies PurchaseExpensePaymentPlan;

  if (paymentMethodType !== "credit_card" || !instrument) return base;

  const firstCycle = resolveCardStatementCycle(purchaseDate, instrument);
  const installmentCount = input.paymentCondition === "installments"
    ? Math.max(2, Number(input.installmentsCount) || 2)
    : 1;
  const installmentAssignments = Array.from({ length: installmentCount }, (_, index) => {
    const cycle = resolveCardStatementCycleFromMonth(shiftMonth(firstCycle.monthKey, index), instrument);
    return {
      number: index + 1,
      dueDate: cycle.dueDate,
      cardStatementId: cardStatementDocumentId(cycle.key),
      cardStatementKey: cycle.key,
      cardStatementMonthKey: cycle.monthKey,
      cardReconciliationStatus: "pending" as const,
      cardStatementRevisionStatus: "active" as const,
    };
  });

  return {
    ...base,
    dueDate: firstCycle.dueDate,
    firstInstallmentDueDate: input.paymentCondition === "installments" ? firstCycle.dueDate : null,
    cardChargeDate: purchaseDate,
    originalCardChargeDate: paymentDateKey,
    cardStatementId: cardStatementDocumentId(firstCycle.key),
    cardStatementKey: firstCycle.key,
    cardStatementMonthKey: firstCycle.monthKey,
    cardReconciliationStatus: "pending",
    cardStatementRevisionStatus: "active",
    installmentAssignments,
  };
}

export function buildPurchaseExpenseComponents(
  input: PurchaseExpenseComponentInput,
): PurchaseExpenseComponent[] {
  const totalValue = money(input.totalValue);
  const freightValue = Math.min(money(input.deliveryFee), totalValue);
  const goodsValue = money(totalValue - freightValue);
  const goodsSupplier = input.goodsSupplier.trim() || "Fornecedor da compra";
  const freightSupplier = String(input.freightSupplier || "").trim();
  const goodsAccountPlanId = String(input.goodsAccountPlanId || "").trim();
  const goodsAccountPlanName = String(input.goodsAccountPlanName || "").trim();
  const freightAccountPlanId = String(input.freightAccountPlanId || "").trim();
  const freightAccountPlanName = String(input.freightAccountPlanName || "").trim();

  const goodsComponent = (role: "combined" | "goods", value: number): PurchaseExpenseComponent => ({
    role,
    description: `Compra ${goodsSupplier}`,
    supplier: goodsSupplier,
    totalValue: value,
    accountPlanId: goodsAccountPlanId,
    accountPlanName: goodsAccountPlanName,
    hasAccountAllocations: false,
    accountAllocations: null,
  });

  if (freightValue <= 0) return [goodsComponent("goods", totalValue)];

  if (input.freightPaymentMode !== "separate") {
    const combined = goodsComponent("combined", totalValue);
    const distinctPlans = goodsAccountPlanId && freightAccountPlanId && goodsAccountPlanId !== freightAccountPlanId;
    return [{
      ...combined,
      hasAccountAllocations: Boolean(distinctPlans),
      accountAllocations: distinctPlans
        ? [
            { accountPlanId: goodsAccountPlanId, accountPlanName: goodsAccountPlanName, amount: goodsValue },
            { accountPlanId: freightAccountPlanId, accountPlanName: freightAccountPlanName, amount: freightValue },
          ]
        : null,
    }];
  }

  if (!freightSupplier) {
    throw new Error("Informe o favorecido do frete pago separadamente.");
  }

  return [
    goodsComponent("goods", goodsValue),
    {
      role: "freight",
      description: `Frete sobre compra | ${freightSupplier}`,
      supplier: freightSupplier,
      totalValue: freightValue,
      accountPlanId: freightAccountPlanId,
      accountPlanName: freightAccountPlanName,
      hasAccountAllocations: false,
      accountAllocations: null,
    },
  ];
}
