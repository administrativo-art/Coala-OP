"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PurchaseFinancial } from '@/types';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  doc,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { WORKSPACE_ID } from '@/lib/workspace';

export interface PurchaseFinancialContextType {
  financials: PurchaseFinancial[];
  loading: boolean;
  markAsPaid: (financialId: string) => Promise<void>;
}

export const PurchaseFinancialContext = createContext<PurchaseFinancialContextType | undefined>(undefined);

export function PurchaseFinancialProvider({ children }: { children: React.ReactNode }) {
  const { permissions } = useAuth();
  const [financials, setFinancials] = useState<PurchaseFinancial[]>([]);
  const [loading, setLoading] = useState(true);
  const canView = canViewPurchasing(permissions);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, PURCHASING_COLLECTIONS.purchaseFinancials),
      where('workspaceId', '==', WORKSPACE_ID),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseFinancial));
        setFinancials(data.sort((a, b) => new Date(b.paymentDueDate).getTime() - new Date(a.paymentDueDate).getTime()));
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching financials:', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [canView]);

  const markAsPaid = useCallback(async (financialId: string) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, PURCHASING_COLLECTIONS.purchaseFinancials, financialId), {
      status: 'paid' as PurchaseFinancial['status'],
      paidAt: now,
      updatedAt: now,
    });
  }, []);

  const value: PurchaseFinancialContextType = useMemo(
    () => ({ financials, loading, markAsPaid }),
    [financials, loading, markAsPaid],
  );

  return <PurchaseFinancialContext.Provider value={value}>{children}</PurchaseFinancialContext.Provider>;
}
