export type InvoiceDestination = {
  kind: "asset_invoice" | "non_asset_invoice";
  assetIds: string[];
  version: number;
  sha256: string;
  confirmedAt: string;
  confirmedBy: string;
  deletionState?: "pending" | "deleting" | "blocked" | "deleted";
  deletedStoragePath?: string;
  storageGeneration?: string;
  recoveryUntil?: string;
};

export function sameInvoiceDestination(current: InvoiceDestination | undefined, kind: InvoiceDestination["kind"], assetIds: string[], sha256: string) {
  return current?.kind === kind && current.sha256 === sha256
    && current.assetIds.length === assetIds.length
    && current.assetIds.every((id, index) => id === assetIds[index]);
}

export function invoiceReferenceKey(messageId: string, fileId: string) {
  return `${messageId}:${fileId}`;
}

export function confirmedInboxBoleto(message: { workspaceId: string; linkedExpenseId: string | null; linkedExpenseInstallmentNumber?: number | null; classification?: { barcode?: string | null }; attachments: Array<{ contentType: string; storagePath: string | null; extractedHints?: { barcode?: string | null } | null; destination?: InvoiceDestination }> }, workspaceId: string, expenseId: string, installmentNumber?: number) {
  if (message.workspaceId !== workspaceId || message.linkedExpenseId !== expenseId
    || (message.linkedExpenseInstallmentNumber ?? undefined) !== installmentNumber
    || !message.classification?.barcode) return null;
  const barcode = message.classification.barcode.replace(/\D/g, "");
  const files = message.attachments.filter((file) => file.contentType === "application/pdf" && file.storagePath
    && file.destination?.kind !== "non_asset_invoice" && file.extractedHints?.barcode?.replace(/\D/g, "") === barcode);
  return files.length === 1 ? files[0] : null;
}
