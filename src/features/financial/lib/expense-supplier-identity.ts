import type { Entity } from "@/types";
import { normalizeBrazilianDocument, validBrazilianTaxId } from "@/features/financial/beneficiaries/normalization";

/** A typed name is display text; only an explicit entity ID establishes identity. */
export function expenseSupplierIdentity(entities: Array<Pick<Entity, "id" | "type" | "document">>, entityId: string | null) {
  const entity = entities.find((item) => item.id === entityId);
  const document = normalizeBrazilianDocument(entity?.document);
  if (!entity || !validBrazilianTaxId(document)
    || (entity.type === "pessoa_fisica" ? document.length !== 11 : document.length !== 14)) {
    return { supplierId: null, supplierTaxId: null };
  }
  return { supplierId: entity.id, supplierTaxId: document };
}

export function expenseBillingIdentity(
  loaded: Record<string, unknown> | null,
  inbox: Record<string, unknown> | null,
  supplierTaxId: string | null,
  protectedSource: boolean,
) {
  const previous = { ...(loaded ?? {}), ...(inbox ?? {}) };
  const previousTaxId = typeof previous.supplierTaxId === "string" ? previous.supplierTaxId : null;
  return { ...previous, supplierTaxId: protectedSource ? previousTaxId : supplierTaxId };
}

export function expenseSupplierFields(
  selected: { supplierId: string | null; supplierTaxId: string | null },
  loadedSupplierId: string | null,
  loadedBillingIdentity: Record<string, unknown> | null,
  inboxBillingIdentity: Record<string, unknown> | null,
  protectedSource: boolean,
) {
  return {
    supplierId: protectedSource ? loadedSupplierId : selected.supplierId,
    billingIdentity: expenseBillingIdentity(loadedBillingIdentity, inboxBillingIdentity,
      selected.supplierTaxId, protectedSource),
  };
}

export function expenseHasProtectedSupplierSource(expense: {
  financialInboxMessageId?: unknown;
  generatedReceiptId?: unknown;
  originModule?: unknown;
}) {
  return Boolean(expense.financialInboxMessageId || expense.generatedReceiptId
    || expense.originModule === "financial_inbox" || expense.originModule === "generated_receipt");
}
