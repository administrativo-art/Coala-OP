import {
  inferPurchaseItemTreatment,
  purchaseTreatmentSkipsOperationalEntry,
} from "@/lib/purchasing-item-treatment";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types";

export type PurchaseOrderConfirmationIssueCode =
  | "items"
  | "payment_due_date"
  | "payment_method"
  | "payment_card"
  | "installments"
  | "account_plan"
  | "result_center"
  | "estimated_receipt_date"
  | "stock_item_registration"
  | "freight_account_plan"
  | "freight_payment_mode"
  | "freight_supplier";

export type PurchaseOrderConfirmationIssue = {
  code: PurchaseOrderConfirmationIssueCode;
  label: string;
  scope: "order" | "items";
};

type ReadinessOrder = Pick<
  PurchaseOrder,
  | "paymentDueDate"
  | "paymentMethod"
  | "paymentAccountId"
  | "paymentMethodId"
  | "paymentCondition"
  | "installmentDueDates"
  | "accountPlanId"
  | "resultCenterId"
  | "receiptMode"
  | "estimatedReceiptDate"
  | "deliveryFee"
  | "freightAccountPlanId"
  | "freightPaymentMode"
  | "freightSupplierName"
>;

type ReadinessItem = Pick<
  PurchaseOrderItem,
  | "baseItemId"
  | "productId"
  | "itemTreatment"
  | "entryType"
  | "itemDestination"
>;

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCardPayment(paymentMethod?: PurchaseOrder["paymentMethod"]) {
  return paymentMethod === "card_credit" || paymentMethod === "card_debit";
}

export function getPurchaseOrderConfirmationIssues(
  order: ReadinessOrder,
  items: ReadinessItem[],
): PurchaseOrderConfirmationIssue[] {
  const issues: PurchaseOrderConfirmationIssue[] = [];

  if (items.length === 0) {
    issues.push({
      code: "items",
      label: "Inclua ao menos um item no pedido",
      scope: "items",
    });
  }
  if (!hasText(order.paymentDueDate)) {
    issues.push({
      code: "payment_due_date",
      label: isCardPayment(order.paymentMethod)
        ? "Informe a data da compra"
        : "Informe o vencimento",
      scope: "order",
    });
  }
  if (!hasText(order.paymentMethod)) {
    issues.push({
      code: "payment_method",
      label: "Informe a forma de pagamento",
      scope: "order",
    });
  }
  if (
    isCardPayment(order.paymentMethod) &&
    (!hasText(order.paymentAccountId) || !hasText(order.paymentMethodId))
  ) {
    issues.push({
      code: "payment_card",
      label: "Selecione o cartão da compra",
      scope: "order",
    });
  }
  if (
    order.paymentCondition === "installments" &&
    (!Array.isArray(order.installmentDueDates) ||
      order.installmentDueDates.length < 2)
  ) {
    issues.push({
      code: "installments",
      label: "Informe as datas do parcelamento",
      scope: "order",
    });
  }
  if (!hasText(order.accountPlanId)) {
    issues.push({
      code: "account_plan",
      label: "Defina o plano de contas da mercadoria",
      scope: "order",
    });
  }
  if (!hasText(order.resultCenterId)) {
    issues.push({
      code: "result_center",
      label: "Defina o centro de resultado",
      scope: "order",
    });
  }
  if (
    order.receiptMode === "future_delivery" &&
    !hasText(order.estimatedReceiptDate)
  ) {
    issues.push({
      code: "estimated_receipt_date",
      label: "Informe a previsão de recebimento",
      scope: "order",
    });
  }
  if (
    items.some(
      (item) => {
        const treatment = inferPurchaseItemTreatment(item);
        return (
          treatment !== "asset" &&
          !purchaseTreatmentSkipsOperationalEntry(treatment) &&
          (!hasText(item.productId) || !hasText(item.baseItemId))
        );
      },
    )
  ) {
    issues.push({
      code: "stock_item_registration",
      label: "Revise os itens de estoque sem produto/insumo vinculado",
      scope: "items",
    });
  }

  if (Number(order.deliveryFee ?? 0) > 0) {
    if (!hasText(order.freightAccountPlanId)) {
      issues.push({
        code: "freight_account_plan",
        label: "Defina o plano de contas do frete",
        scope: "order",
      });
    }
    if (!hasText(order.freightPaymentMode)) {
      issues.push({
        code: "freight_payment_mode",
        label: "Informe como o frete será pago",
        scope: "order",
      });
    }
    if (
      order.freightPaymentMode === "separate" &&
      String(order.freightSupplierName || "").trim().length < 2
    ) {
      issues.push({
        code: "freight_supplier",
        label: "Informe o favorecido do frete",
        scope: "order",
      });
    }
  }

  return issues;
}

export function purchaseOrderDisplayCode(
  order: Pick<PurchaseOrder, "id" | "externalOrderNumber">,
) {
  const source = String(order.externalOrderNumber || order.id)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  return `CMP-${source.slice(-8)}`;
}
