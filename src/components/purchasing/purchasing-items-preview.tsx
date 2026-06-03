"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';

import { useProducts } from '@/hooks/use-products';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useQuotations } from '@/hooks/use-quotations';
import { type PurchaseOrderItem, type PurchaseReceiptItem, type QuotationItem } from '@/types';

type PurchasingPreviewItem = PurchaseOrderItem | PurchaseReceiptItem | QuotationItem;

function itemQuantity(item: PurchasingPreviewItem) {
  if ('quantityOrdered' in item) return item.quantityOrdered;
  if ('quantity' in item) return item.quantity;
  return 0;
}

function itemUnit(item: PurchasingPreviewItem) {
  return ('purchaseUnitLabel' in item && item.purchaseUnitLabel) || item.unit || '';
}

function itemQuantityLabel(item: PurchasingPreviewItem) {
  const unit = itemUnit(item);
  const formatQty = (value: number) =>
    Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

  if ('quantityReceived' in item && 'quantityOrdered' in item) {
    return `Recebido: ${formatQty(Number(item.quantityReceived ?? 0))} / ${formatQty(Number(item.quantityOrdered ?? 0))} ${unit}`;
  }

  return `Quantidade: ${formatQty(Number(itemQuantity(item) || 0))} ${unit}`;
}

function fallbackItemName(item: PurchasingPreviewItem) {
  return item.itemName || ('freeText' in item ? item.freeText : '') || item.baseItemId || 'Item da compra';
}

export function PurchasingItemsPreview({ orderId, quotationId, receiptId }: { orderId?: string; quotationId?: string; receiptId?: string }) {
  const { fetchOrderItems } = usePurchaseOrders();
  const { fetchReceiptItems } = usePurchaseReceipts();
  const { fetchItems: fetchQuotationItems } = useQuotations();
  const { products, getProductFullName } = useProducts();
  const [items, setItems] = useState<PurchasingPreviewItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      try {
        if (orderId) {
          const data = await fetchOrderItems(orderId);
          if (!cancelled) setItems(data);
          return;
        }
        if (receiptId) {
          const data = await fetchReceiptItems(receiptId);
          if (!cancelled) setItems(data);
          return;
        }
        if (quotationId) {
          const data = await fetchQuotationItems(quotationId);
          if (!cancelled) setItems(data);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    }

    void loadItems();
    return () => {
      cancelled = true;
    };
  }, [fetchOrderItems, fetchQuotationItems, fetchReceiptItems, orderId, quotationId, receiptId]);

  if (items.length === 0) return null;

  const first = items[0];
  const product = first.productId ? products.find((entry) => entry.id === first.productId) : null;
  const name = product ? getProductFullName(product) : fallbackItemName(first);

  return (
    <div className="mt-3 rounded-[10px] border border-zinc-100 bg-zinc-50/70 p-2.5">
      <div className="flex items-center gap-2">
        {product?.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={name}
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-[8px] border border-zinc-200 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-blue-200 bg-blue-50 text-xs font-black text-blue-600">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-xs font-bold leading-snug text-zinc-700">{name}</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {itemQuantityLabel(first)}
            {items.length > 1 ? ` · +${items.length - 1} item${items.length > 2 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
