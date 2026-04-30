"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  type PurchaseReceipt,
  type PurchaseReceiptItem,
  type PurchaseReceiptLot,
  type EffectiveCostEntry,
  type Product,
  type BaseProduct,
} from '@/types';
import { calculatePricePerBaseUnit, calculateStockQuantityFromPurchase } from '@/lib/purchasing-units';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  doc,
  query,
  where,
  getDocs,
  writeBatch,
  updateDoc,
  serverTimestamp,
  increment,
  getDoc,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { WORKSPACE_ID } from '@/lib/workspace';
import { syncPurchaseReceiptTask } from '@/features/tasks/lib/client';

export interface LotInput {
  lotCode: string;
  expiryDate?: string;
  quantity: number;
}

export interface ReceiptItemInput {
  receiptItemId: string;
  purchaseOrderItemId: string;
  baseItemId: string;
  unit: string;
  purchaseUnitType?: PurchaseReceiptItem['purchaseUnitType'];
  purchaseUnitLabel?: string;
  quantityReceived: number;
  unitPriceConfirmed: number;
  divergenceReason?: string;
}

export interface StockEntryItemInput {
  receiptItemId: string;
  purchaseOrderItemId: string;
  baseItemId: string;
  productId: string;     // specific Product variant for stock entry
  productName?: string;
  purchaseUnitType?: PurchaseReceiptItem['purchaseUnitType'];
  purchaseUnitLabel?: string;
  lots: LotInput[];
}

export interface SaveConferencePayload {
  items: ReceiptItemInput[];
  notes?: string;
  receiptProofUrl?: string;
  receiptProofDescription?: string;
}

export interface ConfirmStockEntryPayload {
  destinationKioskId: string;
  destinationKioskName: string;
  items: StockEntryItemInput[];
  notes?: string;
  receiptProofUrl?: string;
  receiptProofDescription?: string;
}

export interface PurchaseReceiptContextType {
  receipts: PurchaseReceipt[];
  loading: boolean;
  fetchReceiptItems: (receiptId: string) => Promise<PurchaseReceiptItem[]>;
  startConference: (receiptId: string) => Promise<void>;
  saveConference: (receiptId: string, payload: SaveConferencePayload) => Promise<void>;
  startStockEntry: (receiptId: string) => Promise<void>;
  confirmStockEntry: (receiptId: string, payload: ConfirmStockEntryPayload) => Promise<void>;
}

export const PurchaseReceiptContext = createContext<PurchaseReceiptContextType | undefined>(undefined);

function getReceiptItemStatus(
  quantityReceived: number,
  quantityOrdered: number,
  unitPriceConfirmed: number,
  unitPriceOrdered: number,
  divergenceReason?: string,
): PurchaseReceiptItem['status'] {
  const quantityDiffers = Math.abs(quantityReceived - quantityOrdered) > 0.001;
  const priceDiffers = Math.abs(unitPriceConfirmed - unitPriceOrdered) > 0.01;

  if (quantityReceived === 0) return 'cancelled';
  if (quantityReceived < quantityOrdered) return 'partial';
  if (divergenceReason || quantityDiffers || priceDiffers) return 'divergent';
  return 'received';
}

export function PurchaseReceiptProvider({ children }: { children: React.ReactNode }) {
  const { user, permissions, firebaseUser } = useAuth();
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const canView = canViewPurchasing(permissions);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, PURCHASING_COLLECTIONS.purchaseReceipts),
      where('workspaceId', '==', WORKSPACE_ID),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setReceipts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseReceipt)));
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching receipts:', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [canView]);

  const fetchReceiptItems = useCallback(async (receiptId: string): Promise<PurchaseReceiptItem[]> => {
    const snap = await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseReceiptItems(receiptId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseReceiptItem));
  }, []);

  const startConference = useCallback(async (receiptId: string) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, PURCHASING_COLLECTIONS.purchaseReceipts, receiptId), {
      status: 'in_conference',
      conferenceStartedAt: now,
    });
    const receipt = receipts.find((entry) => entry.id === receiptId);
    if (firebaseUser && receipt) {
      await syncPurchaseReceiptTask(firebaseUser, {
        receiptId: receipt.id,
        purchaseOrderId: receipt.purchaseOrderId,
        supplierId: receipt.supplierId,
        status: 'in_conference',
        receiptMode: receipt.receiptMode,
        expectedDate: receipt.expectedDate,
        notes: receipt.notes,
      }).catch((error) => {
        console.error('Error syncing purchase receipt task:', error);
      });
    }
  }, [firebaseUser, receipts]);

  const saveConference = useCallback(
    async (receiptId: string, payload: SaveConferencePayload) => {
      if (!user) throw new Error('Usuário não autenticado.');

      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const receipt = receipts.find((r) => r.id === receiptId);
      const orderSnap = receipt?.purchaseOrderId
        ? await getDoc(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, receipt.purchaseOrderId))
        : null;
      const orderData = orderSnap?.exists() ? orderSnap.data() : null;
      const orderItemsSnap = receipt?.purchaseOrderId
        ? await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseOrderItems(receipt.purchaseOrderId)))
        : null;
      const orderItemsById = new Map(orderItemsSnap?.docs.map((d) => [d.id, d.data()]) ?? []);

      let totalConfirmed = 0;
      let hasDivergence = false;
      let hasRemaining = false;

      for (const item of payload.items) {
        const orderItem = orderItemsById.get(item.purchaseOrderItemId);
        const quantityOrdered = Number(orderItem?.quantityOrdered ?? item.quantityReceived);
        const unitPriceOrdered = Number(orderItem?.unitPriceOrdered ?? item.unitPriceConfirmed);
        const itemStatus = getReceiptItemStatus(
          item.quantityReceived,
          quantityOrdered,
          item.unitPriceConfirmed,
          unitPriceOrdered,
          item.divergenceReason,
        );

        totalConfirmed += item.quantityReceived * item.unitPriceConfirmed;
        if (itemStatus === 'partial') hasRemaining = true;
        if (itemStatus === 'partial' || itemStatus === 'divergent') hasDivergence = true;

        batch.update(
          doc(db, PURCHASING_COLLECTIONS.purchaseReceiptItems(receiptId), item.receiptItemId),
          {
            unit: item.unit,
            purchaseUnitType: item.purchaseUnitType ?? orderItem?.purchaseUnitType ?? 'content',
            purchaseUnitLabel: item.purchaseUnitLabel ?? orderItem?.purchaseUnitLabel ?? item.unit,
            quantityReceived: item.quantityReceived,
            unitPriceConfirmed: item.unitPriceConfirmed,
            totalConfirmed: item.quantityReceived * item.unitPriceConfirmed,
            status: itemStatus,
            divergenceReason: item.divergenceReason?.trim() || null,
          },
        );
      }

      batch.update(doc(db, PURCHASING_COLLECTIONS.purchaseReceipts, receiptId), {
        status: 'awaiting_stock',
        totalConfirmed,
        conferenceCompletedAt: now,
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.receiptProofUrl !== undefined ? { receiptProofUrl: payload.receiptProofUrl } : {}),
        ...(payload.receiptProofDescription !== undefined ? { receiptProofDescription: payload.receiptProofDescription } : {}),
      });

      if (receipt?.purchaseOrderId) {
        batch.update(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, receipt.purchaseOrderId), {
          totalConfirmed,
        });

        const finSnap = await getDocs(
          query(
            collection(db, PURCHASING_COLLECTIONS.purchaseFinancials),
            where('purchaseOrderId', '==', receipt.purchaseOrderId),
          ),
        );
        finSnap.forEach((d) => {
          const wasDivergent =
            receipt.receiptMode === 'future_delivery' &&
            Math.abs(totalConfirmed - (d.data().amountEstimated ?? 0)) > 0.01;
          batch.update(d.ref, {
            status: hasRemaining ? 'forecasted' : wasDivergent || hasDivergence ? 'divergent' : 'confirmed',
            updatedAt: now,
          });
        });
      }

      if (orderData?.quotationId) {
        const quotationItemsSnap = await getDocs(
          collection(db, PURCHASING_COLLECTIONS.quotationItems(orderData.quotationId)),
        );
        const someConverted = quotationItemsSnap.docs.some((d) => d.data().conversionStatus === 'converted');
        batch.update(doc(db, PURCHASING_COLLECTIONS.quotations, orderData.quotationId), {
          status: someConverted ? 'partially_converted' : 'quoted',
        });
      }

      await batch.commit();

      if (firebaseUser && receipt) {
        await syncPurchaseReceiptTask(firebaseUser, {
          receiptId: receipt.id,
          purchaseOrderId: receipt.purchaseOrderId,
          supplierId: receipt.supplierId,
          status: 'awaiting_stock',
          receiptMode: receipt.receiptMode,
          expectedDate: receipt.expectedDate,
          notes: payload.notes ?? receipt.notes,
        }).catch((error) => {
          console.error('Error syncing purchase receipt task:', error);
        });
      }
    },
    [firebaseUser, receipts, user],
  );

  const startStockEntry = useCallback(async (receiptId: string) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, PURCHASING_COLLECTIONS.purchaseReceipts, receiptId), {
      status: 'in_stock_entry',
      stockEntryStartedAt: now,
    });
    const receipt = receipts.find((entry) => entry.id === receiptId);
    if (firebaseUser && receipt) {
      await syncPurchaseReceiptTask(firebaseUser, {
        receiptId: receipt.id,
        purchaseOrderId: receipt.purchaseOrderId,
        supplierId: receipt.supplierId,
        status: 'in_stock_entry',
        receiptMode: receipt.receiptMode,
        expectedDate: receipt.expectedDate,
        notes: receipt.notes,
      }).catch((error) => {
        console.error('Error syncing purchase receipt task:', error);
      });
    }
  }, [firebaseUser, receipts]);

  const confirmStockEntry = useCallback(
    async (receiptId: string, payload: ConfirmStockEntryPayload) => {
      if (!user) throw new Error('Usuário não autenticado.');

      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const receipt = receipts.find((r) => r.id === receiptId);
      const orderSnap = receipt?.purchaseOrderId
        ? await getDoc(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, receipt.purchaseOrderId))
        : null;
      const orderData = orderSnap?.exists() ? orderSnap.data() : null;
      const orderItemsSnap = receipt?.purchaseOrderId
        ? await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseOrderItems(receipt.purchaseOrderId)))
        : null;
      const orderItemsById = new Map(
        orderItemsSnap?.docs.map((d) => [d.id, d.data()]) ?? [],
      );
      const receiptItemsSnap = await getDocs(collection(db, PURCHASING_COLLECTIONS.purchaseReceiptItems(receiptId)));
      const receiptItemsById = new Map(
        receiptItemsSnap.docs.map((d) => [d.id, d.data() as PurchaseReceiptItem]),
      );
      const convertedQuotationItemIds = new Set<string>();

      let totalConfirmed = 0;
      let hasDivergence = false;
      let hasRemaining = false;
      const payloadReceiptItemIds = new Set(payload.items.map((item) => item.receiptItemId));

      for (const item of payload.items) {
        const orderItem = orderItemsById.get(item.purchaseOrderItemId);
        const existingReceiptItem = receiptItemsById.get(item.receiptItemId);
        const productSnap = await getDoc(doc(db, 'products', item.productId));
        if (!productSnap.exists()) {
          throw new Error('A unidade de estoque escolhida não foi encontrada.');
        }
        const product = { id: productSnap.id, ...productSnap.data() } as Product;

        const baseProductSnap = await getDoc(doc(db, 'baseProducts', item.baseItemId));
        if (!baseProductSnap.exists()) {
          throw new Error('O insumo base do recebimento não foi encontrado.');
        }
        const baseProduct = { id: baseProductSnap.id, ...baseProductSnap.data() } as BaseProduct;

        const purchaseUnitType = item.purchaseUnitType ?? existingReceiptItem?.purchaseUnitType ?? orderItem?.purchaseUnitType ?? 'content';
        const purchaseUnitLabel =
          item.purchaseUnitLabel ??
          existingReceiptItem?.purchaseUnitLabel ??
          orderItem?.purchaseUnitLabel ??
          existingReceiptItem?.unit ??
          orderItem?.unit ??
          '';
        const convertedPrice = calculatePricePerBaseUnit(
          existingReceiptItem?.unitPriceConfirmed ?? orderItem?.unitPriceOrdered ?? 0,
          product,
          baseProduct,
          purchaseUnitType,
        );
        if (!convertedPrice.ok) {
          throw new Error(convertedPrice.error);
        }

        const cumulativeReceived = existingReceiptItem?.quantityReceived ?? orderItem?.quantityOrdered ?? 0;
        const confirmedUnitPrice = existingReceiptItem?.unitPriceConfirmed ?? orderItem?.unitPriceOrdered ?? 0;
        totalConfirmed += cumulativeReceived * confirmedUnitPrice;

        const receiptItemStatus = getReceiptItemStatus(
          cumulativeReceived,
          Number(orderItem?.quantityOrdered ?? cumulativeReceived),
          confirmedUnitPrice,
          Number(orderItem?.unitPriceOrdered ?? confirmedUnitPrice),
          existingReceiptItem?.divergenceReason,
        );

        if (receiptItemStatus === 'divergent' || receiptItemStatus === 'partial') {
          hasDivergence = true;
        }
        if (receiptItemStatus === 'partial') {
          hasRemaining = true;
        }

        // Create lots
        for (const lot of item.lots) {
          const stockConversion = calculateStockQuantityFromPurchase(
            lot.quantity,
            product,
            product,
            baseProduct,
            purchaseUnitType,
          );
          if (!stockConversion.ok) {
            throw new Error(stockConversion.error);
          }

          // 1. PurchaseReceiptLot (subcollection)
          const lotRef = doc(
            collection(db, PURCHASING_COLLECTIONS.purchaseReceiptLots(receiptId, item.receiptItemId)),
          );
          batch.set(lotRef, {
            purchaseReceiptItemId: item.receiptItemId,
            baseItemId: item.baseItemId,
            lotCode: lot.lotCode,
            ...(lot.expiryDate != null ? { expiryDate: lot.expiryDate } : {}),
            quantity: lot.quantity,
            stockQuantity: stockConversion.stockQuantity,
            purchaseUnitType,
            purchaseUnitLabel,
            unitCost: confirmedUnitPrice,
            occurredAt: now,
          });

          // 2. EffectiveCostEntry
          const costRef = doc(collection(db, PURCHASING_COLLECTIONS.effectiveCostHistory));
          const costEntry: Omit<EffectiveCostEntry, 'id'> = {
            workspaceId: WORKSPACE_ID,
            baseItemId: item.baseItemId,
            supplierId: receipt?.supplierId ?? '',
            unitCost: convertedPrice.pricePerBaseUnit,
            quantity: stockConversion.baseQuantity,
            purchasePrice: confirmedUnitPrice,
            purchaseQuantity: lot.quantity,
            purchaseUnitType,
            purchaseUnitLabel,
            stockProductId: item.productId,
            stockProductQuantity: stockConversion.stockQuantity,
            purchaseReceiptId: receiptId,
            purchaseReceiptLotId: lotRef.id,
            purchaseOrderId: receipt?.purchaseOrderId ?? '',
            ...(orderData?.quotationId ? { quotationId: orderData.quotationId } : {}),
            ...(orderItem?.quotationItemId ? { quotationItemId: orderItem.quotationItemId } : {}),
            occurredAt: now,
          };
          batch.set(costRef, costEntry);

          // 3. Stock lot entry (LotEntry in existing `lots` collection)
          const lotKey = `${item.productId}_${payload.destinationKioskId}_${lot.lotCode}_${lot.expiryDate ?? 'noval'}`;
          const stockLotRef = doc(db, 'lots', lotKey);
          batch.set(
            stockLotRef,
            {
              productId: item.productId,
              productName: item.productName ?? item.baseItemId,
              lotNumber: lot.lotCode,
              expiryDate: lot.expiryDate ?? null,
              kioskId: payload.destinationKioskId,
              quantity: increment(stockConversion.stockQuantity),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );

          // 4. Movement history record
          const movRef = doc(collection(db, 'movementHistory'));
          batch.set(movRef, {
            lotId: lotKey,
            productId: item.productId,
            productName: item.productName ?? item.baseItemId,
            lotNumber: lot.lotCode,
            type: 'ENTRADA',
            quantityChange: stockConversion.stockQuantity,
            toKioskId: payload.destinationKioskId,
            toKioskName: payload.destinationKioskName,
            userId: user.id,
            username: user.username,
            timestamp: now,
            sourceType: 'purchase_receipt',
            sourceId: receiptId,
          });
        }

        if (orderData?.quotationId && orderItem?.quotationItemId) {
          convertedQuotationItemIds.add(orderItem.quotationItemId);
          batch.update(
            doc(
              db,
              PURCHASING_COLLECTIONS.quotationItems(orderData.quotationId),
              orderItem.quotationItemId,
            ),
            {
              conversionStatus: 'converted',
              convertedToPurchaseItemId: item.purchaseOrderItemId,
            },
          );
        }
      }

      receiptItemsById.forEach((existingItem, id) => {
        if (payloadReceiptItemIds.has(id)) return;
        totalConfirmed += (existingItem.quantityReceived ?? 0) * (existingItem.unitPriceConfirmed ?? existingItem.unitPriceOrdered ?? 0);
        if (existingItem.status === 'partial') hasRemaining = true;
        if (existingItem.status === 'partial' || existingItem.status === 'divergent') hasDivergence = true;
      });

      // Update PurchaseReceipt
      const receiptRef = doc(db, PURCHASING_COLLECTIONS.purchaseReceipts, receiptId);
      const finalStatus: PurchaseReceipt['status'] =
        hasRemaining
          ? 'partially_stocked'
          : hasDivergence
          ? 'stocked_with_divergence'
          : 'stocked';

      batch.update(receiptRef, {
        status: finalStatus,
        stockEnteredAt: now,
        receivedAt: now,
        totalConfirmed,
        ...(payload.notes ? { notes: payload.notes } : {}),
        ...(payload.receiptProofUrl ? { receiptProofUrl: payload.receiptProofUrl } : {}),
        ...(payload.receiptProofDescription ? { receiptProofDescription: payload.receiptProofDescription } : {}),
      });

      // Update PurchaseOrder (totalConfirmed + receivedAt)
      if (receipt?.purchaseOrderId) {
        batch.update(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, receipt.purchaseOrderId), {
          totalConfirmed,
          ...(finalStatus !== 'partially_stocked' ? { receivedAt: now } : {}),
        });

        // Update PurchaseFinancial: forecasted → confirmed (or divergent)
        const finSnap = await getDocs(
          query(
            collection(db, PURCHASING_COLLECTIONS.purchaseFinancials),
            where('purchaseOrderId', '==', receipt.purchaseOrderId),
          ),
        );
        finSnap.forEach((d) => {
          const wasDivergent =
            receipt.receiptMode === 'future_delivery' &&
            Math.abs(totalConfirmed - (d.data().amountEstimated ?? 0)) > 0.01;
          batch.update(d.ref, {
            status: finalStatus === 'partially_stocked' ? 'forecasted' : wasDivergent ? 'divergent' : 'confirmed',
            updatedAt: now,
          });
        });
      }

      if (orderData?.quotationId && convertedQuotationItemIds.size > 0) {
        const quotationItemsSnap = await getDocs(
          collection(db, PURCHASING_COLLECTIONS.quotationItems(orderData.quotationId)),
        );
        const conversionStatuses = quotationItemsSnap.docs.map((d) => {
          if (convertedQuotationItemIds.has(d.id)) return 'converted';
          return d.data().conversionStatus;
        });
        const convertibleStatuses = conversionStatuses.filter((s) => s !== 'discarded');
        const allConverted =
          convertibleStatuses.length > 0 && convertibleStatuses.every((s) => s === 'converted');
        const someConverted = convertibleStatuses.some((s) => s === 'converted');
        batch.update(doc(db, PURCHASING_COLLECTIONS.quotations, orderData.quotationId), {
          status: allConverted ? 'converted' : someConverted ? 'partially_converted' : 'quoted',
        });
      }

      await batch.commit();

      if (firebaseUser && receipt) {
        await syncPurchaseReceiptTask(firebaseUser, {
          receiptId: receipt.id,
          purchaseOrderId: receipt.purchaseOrderId,
          supplierId: receipt.supplierId,
          status: finalStatus,
          receiptMode: receipt.receiptMode,
          expectedDate: receipt.expectedDate,
          notes: payload.notes ?? receipt.notes,
        }).catch((error) => {
          console.error('Error syncing purchase receipt task:', error);
        });
      }
    },
    [firebaseUser, user, receipts],
  );

  const value: PurchaseReceiptContextType = useMemo(
    () => ({ receipts, loading, fetchReceiptItems, startConference, saveConference, startStockEntry, confirmStockEntry }),
    [receipts, loading, fetchReceiptItems, startConference, saveConference, startStockEntry, confirmStockEntry],
  );

  return <PurchaseReceiptContext.Provider value={value}>{children}</PurchaseReceiptContext.Provider>;
}
