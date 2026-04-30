// Firestore collection names for the purchasing v2 module.
// supplierId fields reference the existing `entities` collection.
// baseItemId fields reference the existing `baseProducts` collection.

export const PURCHASING_COLLECTIONS = {
  quotations: 'quotations',
  quotationItems: (quotationId: string) => `quotations/${quotationId}/items`,

  purchaseOrders: 'purchase_orders',
  purchaseOrderItems: (orderId: string) => `purchase_orders/${orderId}/items`,

  purchaseReceipts: 'purchase_receipts',
  purchaseReceiptItems: (receiptId: string) => `purchase_receipts/${receiptId}/items`,
  purchaseReceiptLots: (receiptId: string, itemId: string) =>
    `purchase_receipts/${receiptId}/items/${itemId}/lots`,

  purchaseFinancials: 'purchase_financials',
  effectiveCostHistory: 'effective_cost_history',
} as const;

// Firestore composite index definitions (for documentation / CLI reference).
// Run `firebase deploy --only firestore:indexes` after adding these to firestore.indexes.json.
export const PURCHASING_INDEX_NOTES = `
quotations:             [workspaceId ASC, supplierId ASC, status ASC, createdAt DESC]
quotations:             [workspaceId ASC, status ASC, validUntil ASC]
quotation_items:        [quotationId ASC, baseItemId ASC]
quotation_items:        [baseItemId ASC, quotationId ASC]
purchase_orders:        [workspaceId ASC, supplierId ASC, status ASC, createdAt DESC]
purchase_orders:        [workspaceId ASC, receiptMode ASC, estimatedReceiptDate ASC]
purchase_orders:        [quotationId ASC]
purchase_receipts:      [workspaceId ASC, status ASC, expectedDate ASC]
purchase_receipts:      [purchaseOrderId ASC]
effective_cost_history: [workspaceId ASC, baseItemId ASC, occurredAt DESC]
effective_cost_history: [supplierId ASC, baseItemId ASC, occurredAt DESC]
`;
