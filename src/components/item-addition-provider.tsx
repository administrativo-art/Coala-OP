
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ItemAdditionRequest } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';

export interface ItemAdditionContextType {
  requests: ItemAdditionRequest[];
  loading: boolean;
  addRequest: (data: { kioskId: string; productName: string; brand?: string; notes?: string }) => Promise<void>;
  updateRequestStatus: (requestId: string, status: 'completed' | 'rejected') => Promise<void>;
}

export const ItemAdditionContext = createContext<ItemAdditionContextType | undefined>(undefined);

export function ItemAdditionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { kiosks } = useKiosks();
  const [requests, setRequests] = useState<ItemAdditionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "itemAdditionRequests"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ItemAdditionRequest));
      setRequests(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching item addition requests from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addRequest = useCallback(async (data: { kioskId: string; productName: string; brand?: string; notes?: string }) => {
    if (!user) throw new Error("Usuário não autenticado.");
    
    const kiosk = kiosks.find(k => k.id === data.kioskId);
    if (!kiosk) throw new Error("Quiosque não encontrado.");

    const newRequest: Omit<ItemAdditionRequest, 'id'> = {
      ...data,
      kioskName: kiosk.name,
      requestedBy: {
        userId: user.id,
        username: user.username,
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, "itemAdditionRequests"), newRequest);
    } catch (error) {
      console.error("Error adding item request:", error);
      throw error;
    }
  }, [user, kiosks]);

  const updateRequestStatus = useCallback(async (requestId: string, status: 'completed' | 'rejected') => {
    if (!user) throw new Error("Usuário não autenticado.");

    const requestRef = doc(db, "itemAdditionRequests", requestId);
    const updatePayload: Partial<ItemAdditionRequest> = {
      status,
      reviewedBy: {
        userId: user.id,
        username: user.username,
      },
      reviewedAt: new Date().toISOString(),
    };

    try {
      await updateDoc(requestRef, updatePayload);
    } catch (error) {
      console.error("Error updating item request status:", error);
      throw error;
    }
  }, [user]);

  const value: ItemAdditionContextType = useMemo(() => ({
    requests,
    loading,
    addRequest,
    updateRequestStatus,
  }), [requests, loading, addRequest, updateRequestStatus]);

  return <ItemAdditionContext.Provider value={value}>{children}</ItemAdditionContext.Provider>;
}
