"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseReceipt,
  type PurchaseReceiptItem,
  type PurchaseFinancial,
  type PurchaseUnitType,
} from '@/types';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  doc,
  query,
  where,
  writeBatch,
  updateDoc,
  getDocs,
  getDoc,
  deleteField,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { WORKSPACE_ID } from '@/lib/workspace';
import { calculatePricePerBaseUnit } from '@/lib/purchasing-units';

export interface CreatePurchasePayload {
  supplierId: string;
  origin: PurchaseOrder['origin'];
  quotationId?: string;
  receiptMode: PurchaseOrder['receiptMode'];
  paymentMethod: PurchaseOrder['paymentMethod'];
  paymentDueDate: string;
  paymentCondition?: PurchaseOrder['paymentCondition'];
  installmentsCount?: number;
  estimatedReceiptDate: string;
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  notes?: string;
  items: Array<{
    baseItemId: string;
    productId?: string;
    quotationItemId?: string;
    unit: string;
    purchaseUnitType?: PurchaseUnitType;
    purchaseUnitLabel?: string;
    quantityOrdered: number;
    unitPriceOrdered: number;
    discountOrdered?: number;
    notes?: string;
  }>;
}

export type OrderEdits = {
  paymentMethod?: PurchaseOrder['paymentMethod'];
  paymentDueDate?: string;
  paymentCondition?: PurchaseOrder['paymentCondition'];
  installmentsCount?: number;
  estimatedReceiptDate?: string;
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  notes?: string;
};

export interface PurchaseOrderContextType {
  orders: PurchaseOrder[];
  loading: boolean;
  createPurchase: (payload: CreatePurchasePayload) => Promise<string | null>;
  updateOrder: (orderId: string, edits: OrderEdits) => Promise<void>;
  confirmOrder: (orderId: string) => Promise<void>;
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
    async (payload: CreatePurchasePayload): Promise<string | null> => {
      if (!user) return null;
      const now = new Date().toISOString();
      const isImmediate = payload.receiptMode === 'immediate_pickup';
      const deliveryFee = payload.deliveryFee ?? 0;

      const batch = writeBatch(db);
      const quotationItemIds = new Set(
        payload.items
          .map((item) => item.quotationItemId)
          .filter((id): id is string => !!id),
      );

      // 1. PurchaseOrder
      const orderRef = doc(collection(db, PURCHASING_COLLECTIONS.purchaseOrders));
      const itemsSubtotal = payload.items.reduce(
        (sum, i) => sum + Math.max(i.quantityOrdered * i.unitPriceOrdered - (i.discountOrdered ?? 0), 0),
        0,
      );
      const totalEstimated = itemsSubtotal + deliveryFee;
      const order = stripUndefined({
        workspaceId: WORKSPACE_ID,
        origin: payload.origin,
        quotationId: payload.quotationId,
        supplierId: payload.supplierId,
        receiptMode: payload.receiptMode,
        status: 'created' as PurchaseOrder['status'],
        estimatedReceiptDate: isImmediate ? now : payload.estimatedReceiptDate,
        paymentDueDate: payload.paymentDueDate,
        paymentMethod: payload.paymentMethod,
        paymentCondition: payload.paymentCondition ?? 'cash',
        installmentsCount: payload.paymentCondition === 'installments' ? payload.installmentsCount : undefined,
        accountPlanId: payload.accountPlanId,
        accountPlanName: payload.accountPlanName,
        freightAccountPlanId: payload.freightAccountPlanId,
        freightAccountPlanName: payload.freightAccountPlanName,
        resultCenterId: payload.resultCenterId,
        resultCenterName: payload.resultCenterName,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
        totalEstimated,
        notes: payload.notes || undefined,
        createdAt: now,
        createdBy: user.id,
      });
      batch.set(orderRef, order);

      // 2+3. PurchaseOrderItems + PurchaseReceipt + PurchaseReceiptItems (all in one pass)
      const receiptRef = doc(collection(db, PURCHASING_COLLECTIONS.purchaseReceipts));
      const receipt: Omit<PurchaseReceipt, 'id'> = {
        workspaceId: WORKSPACE_ID,
        purchaseOrderId: orderRef.id,
        supplierId: payload.supplierId,
        receiptMode: payload.receiptMode,
        status: isImmediate ? 'awaiting_stock' : 'awaiting_delivery',
        expectedDate: isImmediate ? now : payload.estimatedReceiptDate,
        totalExpected: totalEstimated,
      };
      batch.set(receiptRef, receipt);

      for (const item of payload.items) {
        // Order item
        const orderItemRef = doc(collection(db, PURCHASING_COLLECTIONS.purchaseOrderItems(orderRef.id)));
        batch.set(orderItemRef, stripUndefined({
          purchaseOrderId: orderRef.id,
          baseItemId: item.baseItemId,
          productId: item.productId,
          quotationItemId: item.quotationItemId,
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? item.unit,
          quantityOrdered: item.quantityOrdered,
          unitPriceOrdered: item.unitPriceOrdered,
          discountOrdered: item.discountOrdered,
          totalOrdered: Math.max(item.quantityOrdered * item.unitPriceOrdered - (item.discountOrdered ?? 0), 0),
          notes: item.notes,
        }));

        if (payload.quotationId && item.quotationItemId) {
          const qItemRef = doc(
            db,
            PURCHASING_COLLECTIONS.quotationItems(payload.quotationId),
            item.quotationItemId,
          );
          batch.update(qItemRef, {
            conversionStatus: 'converted',
            convertedToPurchaseItemId: orderItemRef.id,
          });
        }

        // Receipt item — mirrors order item, quantities filled at receipt time
        const receiptItemRef = doc(collection(db, PURCHASING_COLLECTIONS.purchaseReceiptItems(receiptRef.id)));
        batch.set(receiptItemRef, {
          purchaseReceiptId: receiptRef.id,
          purchaseOrderItemId: orderItemRef.id,
          baseItemId: item.baseItemId,
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? item.unit,
          quantityOrdered: item.quantityOrdered,
          quantityReceived: 0,
          unitPriceOrdered: item.unitPriceOrdered,
          unitPriceConfirmed: item.unitPriceOrdered,
          totalConfirmed: 0,
          status: 'pending' as const,
        } satisfies Omit<PurchaseReceiptItem, 'id' | 'lots'>);
      }

      // 4. PurchaseFinancial
      const financialRef = doc(collection(db, PURCHASING_COLLECTIONS.purchaseFinancials));
      const financial: Omit<PurchaseFinancial, 'id'> = {
        workspaceId: WORKSPACE_ID,
        purchaseOrderId: orderRef.id,
        supplierId: payload.supplierId,
        receiptMode: payload.receiptMode,
        status: 'forecasted',
        accountPlanId: payload.accountPlanId,
        accountPlanName: payload.accountPlanName,
        freightAccountPlanId: payload.freightAccountPlanId,
        freightAccountPlanName: payload.freightAccountPlanName,
        resultCenterId: payload.resultCenterId,
        resultCenterName: payload.resultCenterName,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
        amountEstimated: totalEstimated,
        paymentMethod: payload.paymentMethod,
        paymentDueDate: payload.paymentDueDate,
        paymentCondition: payload.paymentCondition ?? 'cash',
        installmentsCount: payload.paymentCondition === 'installments' ? payload.installmentsCount : undefined,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(financialRef, stripUndefined(financial));

      // 5. Reflect quotation conversion status (if from quotation)
      if (payload.quotationId && quotationItemIds.size > 0) {
        const quotationItemsSnap = await getDocs(
          collection(db, PURCHASING_COLLECTIONS.quotationItems(payload.quotationId)),
        );
        const nextStatuses = quotationItemsSnap.docs.map((d) => {
          if (quotationItemIds.has(d.id)) return 'converted';
          return d.data().conversionStatus;
        });
        const convertibleStatuses = nextStatuses.filter((s) => s !== 'discarded');
        const allConverted =
          convertibleStatuses.length > 0 && convertibleStatuses.every((s) => s === 'converted');
        batch.update(doc(db, PURCHASING_COLLECTIONS.quotations, payload.quotationId), {
          status: allConverted ? 'converted' : 'partially_converted',
        });
      }

      try {
        await batch.commit();
        return orderRef.id;
      } catch (e) {
        console.error('Error creating purchase order:', e);
        return null;
      }
    },
    [user],
  );

  const updateOrder = useCallback(async (orderId: string, edits: OrderEdits) => {
    const orderUpdates: Record<string, unknown> = {};
    if (edits.paymentMethod !== undefined) orderUpdates.paymentMethod = edits.paymentMethod;
    if (edits.paymentDueDate !== undefined) orderUpdates.paymentDueDate = edits.paymentDueDate;
    if (edits.paymentCondition !== undefined) orderUpdates.paymentCondition = edits.paymentCondition;
    if ('installmentsCount' in edits) {
      orderUpdates.installmentsCount =
        edits.paymentCondition === 'installments' || edits.installmentsCount
          ? edits.installmentsCount ?? deleteField()
          : deleteField();
    }
    if (edits.estimatedReceiptDate !== undefined) orderUpdates.estimatedReceiptDate = edits.estimatedReceiptDate;
    if ('accountPlanId' in edits) orderUpdates.accountPlanId = edits.accountPlanId || deleteField();
    if ('accountPlanName' in edits) orderUpdates.accountPlanName = edits.accountPlanName || deleteField();
    if ('freightAccountPlanId' in edits) orderUpdates.freightAccountPlanId = edits.freightAccountPlanId || deleteField();
    if ('freightAccountPlanName' in edits) orderUpdates.freightAccountPlanName = edits.freightAccountPlanName || deleteField();
    if ('resultCenterId' in edits) orderUpdates.resultCenterId = edits.resultCenterId || deleteField();
    if ('resultCenterName' in edits) orderUpdates.resultCenterName = edits.resultCenterName || deleteField();
    if ('deliveryFee' in edits) orderUpdates.deliveryFee = (edits.deliveryFee ?? 0) > 0 ? edits.deliveryFee : deleteField();
    if ('notes' in edits) orderUpdates.notes = edits.notes?.trim() || deleteField();

    const batch = writeBatch(db);
    let recalculatedTotal: number | null = null;

    if ('deliveryFee' in edits) {
      const itemSnap = await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseOrderItems(orderId)));
      const itemsSubtotal = itemSnap.docs.reduce(
        (sum, itemDoc) => sum + Number(itemDoc.data().totalOrdered ?? 0),
        0,
      );
      recalculatedTotal = itemsSubtotal + (edits.deliveryFee ?? 0);
      orderUpdates.totalEstimated = recalculatedTotal;
    }

    batch.update(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, orderId), orderUpdates);

    const shouldSyncFinancial =
      edits.paymentMethod !== undefined ||
      edits.paymentDueDate !== undefined ||
      edits.paymentCondition !== undefined ||
      'installmentsCount' in edits ||
      'accountPlanId' in edits ||
      'accountPlanName' in edits ||
      'freightAccountPlanId' in edits ||
      'freightAccountPlanName' in edits ||
      'resultCenterId' in edits ||
      'resultCenterName' in edits ||
      'deliveryFee' in edits;

    if (shouldSyncFinancial) {
      const financialUpdates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (edits.paymentMethod !== undefined) financialUpdates.paymentMethod = edits.paymentMethod;
      if (edits.paymentDueDate !== undefined) financialUpdates.paymentDueDate = edits.paymentDueDate;
      if (edits.paymentCondition !== undefined) financialUpdates.paymentCondition = edits.paymentCondition;
      if ('installmentsCount' in edits) {
        financialUpdates.installmentsCount =
          edits.paymentCondition === 'installments' || edits.installmentsCount
            ? edits.installmentsCount ?? deleteField()
            : deleteField();
      }
      if ('accountPlanId' in edits) financialUpdates.accountPlanId = edits.accountPlanId || deleteField();
      if ('accountPlanName' in edits) financialUpdates.accountPlanName = edits.accountPlanName || deleteField();
      if ('freightAccountPlanId' in edits) financialUpdates.freightAccountPlanId = edits.freightAccountPlanId || deleteField();
      if ('freightAccountPlanName' in edits) financialUpdates.freightAccountPlanName = edits.freightAccountPlanName || deleteField();
      if ('resultCenterId' in edits) financialUpdates.resultCenterId = edits.resultCenterId || deleteField();
      if ('resultCenterName' in edits) financialUpdates.resultCenterName = edits.resultCenterName || deleteField();
      if ('deliveryFee' in edits) financialUpdates.deliveryFee = (edits.deliveryFee ?? 0) > 0 ? edits.deliveryFee : deleteField();
      if (recalculatedTotal !== null) financialUpdates.amountEstimated = recalculatedTotal;

      const financialSnap = await getDocs(
        query(
          collection(db, PURCHASING_COLLECTIONS.purchaseFinancials),
          where('purchaseOrderId', '==', orderId),
        ),
      );
      for (const fd of financialSnap.docs) {
        batch.update(fd.ref, financialUpdates);
      }
    }

    await batch.commit();
  }, []);

  const confirmOrder = useCallback(async (orderId: string) => {
    if (!user || !firebaseUser) throw new Error('Usuário não autenticado.');

    const now = new Date().toISOString();
    const orderSnapshot = await getDoc(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, orderId));
    const orderData = orderSnapshot.data() as PurchaseOrder | undefined;
    const orderItemsSnap = await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseOrderItems(orderId)));
    const quotationItemsSnap = orderData?.quotationId
      ? await getDocs(collection(db, PURCHASING_COLLECTIONS.quotationItems(orderData.quotationId)))
      : null;
    const quotationItemsById = new Map(
      quotationItemsSnap?.docs.map((entry) => [entry.id, entry.data()]) ?? [],
    );

    const batch = writeBatch(db);
    batch.update(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, orderId), {
      status: 'confirmed',
      confirmedAt: now,
      confirmedBy: user.id,
    });

    const financialSnap = await getDocs(
      query(
        collection(db, PURCHASING_COLLECTIONS.purchaseFinancials),
        where('purchaseOrderId', '==', orderId),
      ),
    );
    for (const fd of financialSnap.docs) {
      batch.update(fd.ref, {
        status: 'confirmed' as PurchaseFinancial['status'],
        updatedAt: now,
      });
    }

    for (const itemDoc of orderItemsSnap.docs) {
      const item = itemDoc.data() as PurchaseOrderItem;
      if (!item.productId) continue;

      const product = products.find((entry) => entry.id === item.productId);
      const baseProduct = baseProducts.find((entry) => entry.id === item.baseItemId);
      if (!product || !baseProduct) continue;

      const quantityOrdered = Number(item.quantityOrdered ?? 0);
      if (quantityOrdered <= 0) continue;
      const fallbackDiscount = item.quotationItemId
        ? Number(quotationItemsById.get(item.quotationItemId)?.discount ?? 0)
        : 0;
      const effectiveDiscount = Number(item.discountOrdered ?? fallbackDiscount ?? 0);
      const netUnitPrice = Math.max(
        Number(item.unitPriceOrdered ?? 0) - effectiveDiscount / quantityOrdered,
        0,
      );

      if (item.discountOrdered == null && effectiveDiscount > 0) {
        batch.update(itemDoc.ref, {
          discountOrdered: effectiveDiscount,
          totalOrdered: Math.max(Number(item.unitPriceOrdered ?? 0) * quantityOrdered - effectiveDiscount, 0),
        });
      }

      const convertedPrice = calculatePricePerBaseUnit(
        netUnitPrice,
        product,
        baseProduct,
        item.purchaseUnitType,
      );
      if (!convertedPrice.ok) continue;

      const historyEntry = {
        baseProductId: item.baseItemId,
        productId: item.productId,
        price: netUnitPrice,
        pricePerUnit: convertedPrice.pricePerBaseUnit,
        entityId: orderData?.supplierId ?? '',
        confirmedBy: user.id,
        confirmedAt: now,
      };

      batch.update(doc(db, 'baseProducts', item.baseItemId), {
        initialCostPerUnit: convertedPrice.pricePerBaseUnit,
        lastEffectivePrice: historyEntry,
      });
    }

    await batch.commit();

    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/purchasing/orders/${orderId}/sync-expense`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao sincronizar despesa da compra.');
    }
  }, [baseProducts, firebaseUser, products, user]);

  const cancelOrder = useCallback(async (orderId: string, reason: string) => {
    const now = new Date().toISOString();
    const batch = writeBatch(db);

    batch.update(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, orderId), {
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: reason,
    });

    // Cancel any associated receipts and financials
    const [receiptSnap, financialSnap] = await Promise.all([
      getDocs(query(
        collection(db, PURCHASING_COLLECTIONS.purchaseReceipts),
        where('purchaseOrderId', '==', orderId),
      )),
      getDocs(query(
        collection(db, PURCHASING_COLLECTIONS.purchaseFinancials),
        where('purchaseOrderId', '==', orderId),
      )),
    ]);

    for (const rd of receiptSnap.docs) {
      batch.update(rd.ref, { status: 'cancelled' });
    }
    for (const fd of financialSnap.docs) {
      batch.update(fd.ref, { status: 'cancelled', updatedAt: now });
    }

    await batch.commit();
  }, []);

  const fetchOrderItems = useCallback(async (orderId: string): Promise<PurchaseOrderItem[]> => {
    const snap = await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseOrderItems(orderId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseOrderItem));
  }, []);

  const value: PurchaseOrderContextType = useMemo(
    () => ({ orders, loading, createPurchase, updateOrder, confirmOrder, cancelOrder, fetchOrderItems }),
    [orders, loading, createPurchase, updateOrder, confirmOrder, cancelOrder, fetchOrderItems],
  );

  return <PurchaseOrderContext.Provider value={value}>{children}</PurchaseOrderContext.Provider>;
}
