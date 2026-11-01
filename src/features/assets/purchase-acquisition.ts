export type PurchaseAcquisitionIdentity = {
  workspaceId: string;
  purchaseOrderId: string;
  purchaseReceiptId: string;
  purchaseReceiptItemId: string;
};

type PurchaseRelationDocuments = {
  orderExists: boolean;
  orderWorkspaceId?: unknown;
  receiptExists: boolean;
  receiptWorkspaceId?: unknown;
  receiptPurchaseOrderId?: unknown;
  receiptItemExists: boolean;
  receiptItemPurchaseReceiptId?: unknown;
  receiptItemPurchaseOrderItemId?: unknown;
  orderItemExists: boolean;
  orderItemId?: string;
};

export function purchaseAcquisitionRelationError(identity: PurchaseAcquisitionIdentity, documents: PurchaseRelationDocuments) {
  if (!documents.orderExists || !documents.receiptExists || !documents.receiptItemExists || !documents.orderItemExists) {
    return "PURCHASE_ACQUISITION_NOT_FOUND";
  }
  if (documents.orderWorkspaceId !== identity.workspaceId || documents.receiptWorkspaceId !== identity.workspaceId) {
    return "PURCHASE_ACQUISITION_SCOPE";
  }
  if (documents.receiptPurchaseOrderId !== identity.purchaseOrderId) return "PURCHASE_ACQUISITION_RELATION";
  if (documents.receiptItemPurchaseReceiptId !== identity.purchaseReceiptId) return "PURCHASE_ACQUISITION_RELATION";
  if (!documents.orderItemId || documents.receiptItemPurchaseOrderItemId !== documents.orderItemId) return "PURCHASE_ACQUISITION_RELATION";
  return null;
}
