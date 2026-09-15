import { createHash } from "node:crypto";

import type { StoneSaleTransaction } from "@/features/financial/sales-reconciliation/types";
import type { StoneReceivable } from "./types";

export const STONE_MDR_ACCOUNT = {
  id: "ybXT1oSjyqDdtGPOsAti",
  name: "Taxas de cartão",
} as const;

export const STONE_ANTICIPATION_ACCOUNT = {
  id: "9rYkpoScI5X2HC893bNj",
  name: "Taxas de antecipação de recebíveis",
} as const;

export type StoneFeeKind = "mdr" | "anticipation";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function stoneFeeExpenseId(receivableId: string, kind: StoneFeeKind) {
  return `stone_fee_${digest(`${receivableId}|${kind}`).slice(0, 40)}`;
}

export function stoneReceivableFeeEffects(receivable: Pick<StoneReceivable, "mdrAmountCents" | "anticipationFeeAmountCents">) {
  return [
    { kind: "mdr" as const, amountCents: receivable.mdrAmountCents, account: STONE_MDR_ACCOUNT },
    { kind: "anticipation" as const, amountCents: receivable.anticipationFeeAmountCents, account: STONE_ANTICIPATION_ACCOUNT },
  ];
}

export function stoneFeeExpenseFields(input: {
  receivable: StoneReceivable;
  sale: StoneSaleTransaction;
  kind: StoneFeeKind;
  amountCents: number;
  account: { id: string; name: string };
}) {
  if (input.amountCents <= 0 || !Number.isSafeInteger(input.amountCents)) {
    throw new Error("A taxa Stone precisa ser positiva e expressa em centavos inteiros.");
  }
  if (!input.sale.kioskId) throw new Error("A venda Stone da taxa não possui unidade canônica.");
  if (input.receivable.workspaceId !== input.sale.workspaceId) {
    throw new Error("O recebível e a venda Stone pertencem a workspaces diferentes.");
  }
  if (input.receivable.externalSaleId !== input.sale.externalTransactionId) {
    throw new Error("O recebível não corresponde à venda Stone informada.");
  }
  if (input.receivable.kioskId && input.receivable.kioskId !== input.sale.kioskId) {
    throw new Error("O recebível e a venda Stone pertencem a unidades diferentes.");
  }
  return {
    workspaceId: input.receivable.workspaceId,
    sourceType: "stone_receivable_fee",
    sourceId: input.receivable.id,
    stoneReceivableId: input.receivable.id,
    stoneExternalSaleId: input.sale.externalTransactionId,
    stoneSaleTransactionId: input.sale.id,
    stoneFeeKind: input.kind,
    stoneSourceHash: input.receivable.sourceHash,
    cashEffectIncludedInNetReceivable: true,
    cashEffectAlreadyRealized: input.receivable.status === "settled",
    createsBankingObligation: false,
    status: input.receivable.status === "settled" ? "paid" : "provisioned",
    provisionType: "actual",
    accountingContractVersion: 1,
    competenceMonth: input.sale.period,
    totalValue: input.amountCents / 100,
    accountId: input.account.id,
    accountPlan: input.account.id,
    accountPlanName: input.account.name,
    hasAccountAllocations: false,
    accountAllocations: [],
    hasPersonAllocations: false,
    personAllocations: [],
    isApportioned: false,
    resultCenter: input.sale.kioskId,
    description: input.kind === "mdr"
      ? `MDR Stone · recebível ${input.receivable.receivableKey}`
      : `Antecipação Stone · recebível ${input.receivable.receivableKey}`,
    supplier: "Stone",
  };
}
