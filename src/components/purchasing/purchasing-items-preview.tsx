"use client";

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

import { useProducts } from '@/hooks/use-products';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useQuotations } from '@/hooks/use-quotations';
import { type PurchaseOrderItem, type PurchaseReceiptItem, type QuotationItem } from '@/types';

type PurchasingPreviewItem = PurchaseOrderItem | PurchaseReceiptItem | QuotationItem;

const previewCache = new Map<string, PurchasingPreviewItem[]>();

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

function previewKey(orderId?: string, quotationId?: string, receiptId?: string) {
  if (orderId) return `order:${orderId}`;
  if (receiptId) return `receipt:${receiptId}`;
  if (quotationId) return `quotation:${quotationId}`;
  return '';
}

export function PurchasingItemsPreview({
  orderId,
  quotationId,
  receiptId,
  variant = 'card',
}: {
  orderId?: string;
  quotationId?: string;
  receiptId?: string;
  variant?: 'card' | 'inline';
}) {
  const { fetchOrderItems } = usePurchaseOrders();
  const { fetchReceiptItems } = usePurchaseReceipts();
  const { fetchItems: fetchQuotationItems } = useQuotations();
  const { products, getProductFullName } = useProducts();
  const key = previewKey(orderId, quotationId, receiptId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(variant !== 'inline');
  const [items, setItems] = useState<PurchasingPreviewItem[]>(() => previewCache.get(key) ?? []);
  const [resolved, setResolved] = useState(() => previewCache.has(key));

  useEffect(() => {
    if (variant !== 'inline' || shouldLoad) return;
    const target = rootRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoad, variant]);

  useEffect(() => {
    const cached = previewCache.get(key);
    if (cached) {
      setItems(cached);
      setResolved(true);
      return;
    }
    setItems([]);
    setResolved(false);
    if (!key || !shouldLoad) return;

    let cancelled = false;

    async function loadItems() {
      try {
        if (orderId) {
          const data = await fetchOrderItems(orderId);
          if (!cancelled) {
            previewCache.set(key, data);
            setItems(data);
            setResolved(true);
          }
          return;
        }
        if (receiptId) {
          const data = await fetchReceiptItems(receiptId);
          if (!cancelled) {
            previewCache.set(key, data);
            setItems(data);
            setResolved(true);
          }
          return;
        }
        if (quotationId) {
          const data = await fetchQuotationItems(quotationId);
          if (!cancelled) {
            previewCache.set(key, data);
            setItems(data);
            setResolved(true);
          }
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setResolved(true);
        }
      }
    }

    void loadItems();
    return () => {
      cancelled = true;
    };
  }, [fetchOrderItems, fetchQuotationItems, fetchReceiptItems, key, orderId, quotationId, receiptId, shouldLoad]);

  const getItemName = (item: PurchasingPreviewItem) => {
    const product = item.productId ? products.find((entry) => entry.id === item.productId) : null;
    return product ? getProductFullName(product) : fallbackItemName(item);
  };

  if (variant === 'inline') {
    const visibleItems = items.slice(0, 2);
    const remaining = Math.max(items.length - visibleItems.length, 0);
    return (
      <div ref={rootRef} className="mt-1 truncate text-xs text-zinc-500">
        <span className="font-bold text-zinc-400">Itens: </span>
        {!resolved
          ? 'carregando…'
          : items.length === 0
            ? 'não informados'
            : visibleItems
                .map((item) => `${getItemName(item)} (${itemQuantityLabel(item).replace('Quantidade: ', '')})`)
                .join(' · ')}
        {resolved && remaining > 0 ? ` · +${remaining} item${remaining > 1 ? 's' : ''}` : ''}
      </div>
    );
  }

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
