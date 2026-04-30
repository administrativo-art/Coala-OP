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

  const startConference = useCallback(async (receiptId: string) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');

    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/purchasing/receipts/${receiptId}/start-conference`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao iniciar a conferência.');
    }

    const receipt = receipts.find((entry) => entry.id === receiptId);
    if (receipt) {
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
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/receipts/${receiptId}/save-conference`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao salvar a conferência.');
      }

      const receipt = receipts.find((r) => r.id === receiptId);
      if (receipt) {
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
    [firebaseUser, receipts],
  );

  const startStockEntry = useCallback(async (receiptId: string) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');

    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/purchasing/receipts/${receiptId}/start-stock-entry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao iniciar a entrada em estoque.');
    }

    const receipt = receipts.find((entry) => entry.id === receiptId);
    if (receipt) {
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
      if (!firebaseUser) throw new Error('Usuário não autenticado.');

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/receipts/${receiptId}/confirm-stock-entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...payload,
          username: user?.username || 'Sistema',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao confirmar a entrada em estoque.');
      }

      const { status: finalStatus } = await response.json();

      const receipt = receipts.find((r) => r.id === receiptId);
      if (receipt) {
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
    [firebaseUser, receipts, user],
  );

  const fetchReceiptItems = useCallback(async (receiptId: string): Promise<PurchaseReceiptItem[]> => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/purchasing/receipts/${receiptId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Falha ao buscar itens do recebimento.');
    return response.json();
  }, [firebaseUser]);

  const value: PurchaseReceiptContextType = useMemo(
    () => ({ receipts, loading, fetchReceiptItems, startConference, saveConference, startStockEntry, confirmStockEntry }),
    [receipts, loading, fetchReceiptItems, startConference, saveConference, startStockEntry, confirmStockEntry],
  );

  return <PurchaseReceiptContext.Provider value={value}>{children}</PurchaseReceiptContext.Provider>;
}
