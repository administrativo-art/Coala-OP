"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseReceipt,
  type PurchaseReceiptItem,
  type PurchaseFinancial,
  type PurchaseFreightPaymentMode,
  type OperationalItemDestination,
  type PurchaseAssetComponentAction,
  type PurchaseItemTreatment,
  type PurchaseStockEntryType,
  type PurchaseUnitType,
} from '@/types';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { WORKSPACE_ID } from '@/lib/workspace';
import { calculatePricePerBaseUnit } from '@/lib/purchasing-units';
import { syncPurchaseReceiptTask } from '@/features/tasks/lib/client';

export interface CreatePurchasePayload {
  supplierId: string;
  supplierName?: string;
  origin: PurchaseOrder['origin'];
  quotationId?: string;
  receiptMode: PurchaseOrder['receiptMode'];
  paymentMethod: PurchaseOrder['paymentMethod'];
  paymentAccountId?: string | null;
  paymentAccountName?: string | null;
  paymentMethodId?: string | null;
  paymentMethodLabel?: string | null;
  paymentDueDate: string;
  paymentCondition?: PurchaseOrder['paymentCondition'];
  installmentsCount?: number;
  installmentDueDates?: string[];
  estimatedReceiptDate: string;
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  freightPaymentMode?: PurchaseFreightPaymentMode;
  freightSupplierId?: string | null;
  freightSupplierName?: string | null;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  trackingInfo?: string;
  notes?: string;
  items: Array<{
    baseItemId: string;
    productId?: string;
    itemName?: string;
    operationalCategoryId?: string;
    operationalCategoryName?: string;
    itemDestination?: OperationalItemDestination;
    quotationItemId?: string;
    unit: string;
    purchaseUnitType?: PurchaseUnitType;
    purchaseUnitLabel?: string;
    quantityOrdered: number;
    unitPriceOrdered: number;
    discountOrdered?: number;
    entryType?: PurchaseStockEntryType;
    itemTreatment?: PurchaseItemTreatment;
    linkedAssetId?: string | null;
    linkedAssetCode?: string | null;
    linkedAssetName?: string | null;
    componentAction?: PurchaseAssetComponentAction | null;
    notes?: string;
  }>;
}

export type OrderEdits = {
  paymentMethod?: PurchaseOrder['paymentMethod'];
  paymentAccountId?: string | null;
  paymentAccountName?: string | null;
  paymentMethodId?: string | null;
  paymentMethodLabel?: string | null;
  paymentDueDate?: string;
  paymentCondition?: PurchaseOrder['paymentCondition'];
  installmentsCount?: number;
  installmentDueDates?: string[];
  estimatedReceiptDate?: string;
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  freightPaymentMode?: PurchaseFreightPaymentMode;
  freightSupplierId?: string | null;
  freightSupplierName?: string | null;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  trackingInfo?: string;
  notes?: string;
  items?: Array<{
    baseItemId: string;
    productId?: string;
    itemName?: string;
    operationalCategoryId?: string;
    operationalCategoryName?: string;
    itemDestination?: OperationalItemDestination;
    quotationItemId?: string;
    unit: string;
    purchaseUnitType?: PurchaseUnitType;
    purchaseUnitLabel?: string;
    quantityOrdered: number;
    unitPriceOrdered: number;
    discountOrdered?: number;
    entryType?: PurchaseStockEntryType;
    itemTreatment?: PurchaseItemTreatment;
    linkedAssetId?: string | null;
    linkedAssetCode?: string | null;
    linkedAssetName?: string | null;
    componentAction?: PurchaseAssetComponentAction | null;
    notes?: string;
  }>;
};

type OrderItemBaseEdits = NonNullable<OrderEdits['items']>[number];
export type OrderItemEdits = Omit<
  OrderItemBaseEdits,
  'productId' | 'itemName' | 'operationalCategoryId' | 'operationalCategoryName' | 'notes'
> & {
  productId?: string | null;
  itemName?: string | null;
  operationalCategoryId?: string | null;
  operationalCategoryName?: string | null;
  notes?: string | null;
};

export interface PurchaseOrderContextType {
  orders: PurchaseOrder[];
  loading: boolean;
  createPurchase: (payload: CreatePurchasePayload) => Promise<string | null>;
  updateOrder: (orderId: string, edits: OrderEdits) => Promise<void>;
  updateOrderItem: (orderId: string, itemId: string, edits: OrderItemEdits) => Promise<void>;
  confirmOrder: (orderId: string) => Promise<void>;
  markReceivedElsewhere: (orderId: string, notes?: string) => Promise<void>;
  cancelOrder: (orderId: string, reason: string) => Promise<void>;
  fetchOrderItems: (orderId: string) => Promise<PurchaseOrderItem[]>;
}

export const PurchaseOrderContext = createContext<PurchaseOrderContextType | undefined>(undefined);

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export function PurchaseOrderProvider({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, permissions } = useAuth();
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const canView = canViewPurchasing(permissions);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, PURCHASING_COLLECTIONS.purchaseOrders),
      where('workspaceId', '==', WORKSPACE_ID),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseOrder));
        setOrders(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching purchase orders:', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [canView]);

  const createPurchase = useCallback(
    async (payload: CreatePurchasePayload) => {
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/purchasing/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao criar o pedido de compra.');
      }

      const { id } = await response.json();
      return id as string;
    },
    [firebaseUser],
  );

  const updateOrder = useCallback(
    async (orderId: string, edits: OrderEdits) => {
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(edits),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao atualizar o pedido.');
      }
    },
    [firebaseUser],
  );

  const updateOrderItem = useCallback(
    async (orderId: string, itemId: string, edits: OrderItemEdits) => {
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(edits),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao atualizar o item do pedido.');
      }
    },
    [firebaseUser],
  );

  const confirmOrder = useCallback(
    async (orderId: string) => {
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/orders/${orderId}/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao confirmar o pedido.');
      }

      const { receiptId } = await response.json();

      // Sync task
      const order = orders.find((o) => o.id === orderId);
      if (order) {
        await syncPurchaseReceiptTask(firebaseUser, {
          receiptId,
          purchaseOrderId: orderId,
          supplierId: order.supplierId,
          status:
            order.receiptMode === 'immediate_pickup' ? 'in_stock_entry' : 'awaiting_delivery',
          receiptMode: order.receiptMode,
          expectedDate: order.paymentDueDate,
          notes: order.notes,
        }).catch((error) => {
          console.error('Error syncing purchase receipt task:', error);
        });
      }
    },
    [firebaseUser, orders],
  );

  const cancelOrder = useCallback(
    async (orderId: string, reason: string) => {
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao cancelar o pedido.');
      }
    },
    [firebaseUser],
  );

  const markReceivedElsewhere = useCallback(
    async (orderId: string, notes?: string) => {
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/orders/${orderId}/mark-received-elsewhere`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao baixar a compra por outro meio.');
      }

      const { receiptId, status } = await response.json().catch(() => ({}));
      const order = orders.find((o) => o.id === orderId);
      if (order && receiptId) {
        await syncPurchaseReceiptTask(firebaseUser, {
          receiptId,
          purchaseOrderId: orderId,
          supplierId: order.supplierId,
          status: status ?? 'stocked',
          receiptMode: order.receiptMode,
          expectedDate: order.estimatedReceiptDate,
          notes: notes ?? order.notes,
        }).catch((error) => {
          console.error('Error syncing purchase receipt task:', error);
        });
      }
    },
    [firebaseUser, orders],
  );

  const fetchOrderItems = useCallback(async (orderId: string): Promise<PurchaseOrderItem[]> => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/purchasing/orders/${orderId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Falha ao buscar itens do pedido.');
    return response.json();
  }, [firebaseUser]);

  const value: PurchaseOrderContextType = useMemo(
    () => ({
      orders,
      loading,
      createPurchase,
      updateOrder,
      updateOrderItem,
      confirmOrder,
      markReceivedElsewhere,
      cancelOrder,
      fetchOrderItems,
    }),
    [orders, loading, createPurchase, updateOrder, updateOrderItem, confirmOrder, markReceivedElsewhere, cancelOrder, fetchOrderItems],
  );

  return <PurchaseOrderContext.Provider value={value}>{children}</PurchaseOrderContext.Provider>;
}
