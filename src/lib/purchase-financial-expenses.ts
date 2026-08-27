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

function money(value: unknown) {
  return Math.max(Math.round((Number(value) || 0) * 100) / 100, 0);
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
