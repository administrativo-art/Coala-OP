
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type RepositionActivity, type RepositionItem } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useExpiryProducts } from '@/hooks/use-expiry-products';

export interface RepositionContextType {
  activities: RepositionActivity[];
  loading: boolean;
  createRepositionActivity: (data: Omit<RepositionActivity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'requestedBy'>) => Promise<string | null>;
  updateRepositionActivity: (activityId: string, updates: Partial<RepositionActivity>) => Promise<void>;
  deleteRepositionActivity: (activityId: string) => Promise<void>;
  finalizeRepositionActivity: (activity: RepositionActivity) => Promise<void>;
}

export const RepositionContext = createContext<RepositionContextType | undefined>(undefined);

export function RepositionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<RepositionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const { moveMultipleLots } = useExpiryProducts();

  useEffect(() => {
    const q = query(collection(db, "repositionActivities"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RepositionActivity));
      setActivities(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching reposition activities:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const createRepositionActivity = useCallback(async (data: Omit<RepositionActivity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'requestedBy'>): Promise<string | null> => {
    if (!user) {
      console.error("User not authenticated to create reposition activity.");
      return null;
    }

    const now = new Date().toISOString();
    const newActivity: Omit<RepositionActivity, 'id'> = {
      ...data,
      status: 'Aguardando despacho',
      requestedBy: {
        userId: user.id,
        username: user.username,
      },
      createdAt: now,
      updatedAt: now,
    };

    try {
      const docRef = await addDoc(collection(db, 'repositionActivities'), newActivity);
      return docRef.id;
    } catch (error) {
      console.error("Error creating reposition activity:", error);
      return null;
    }
  }, [user]);

  const updateRepositionActivity = useCallback(async (activityId: string, updates: Partial<RepositionActivity>) => {
    const activityRef = doc(db, 'repositionActivities', activityId);
    
    const updatePayload: Record<string, any> = { ...updates, updatedAt: new Date().toISOString() };
    Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === undefined) {
            delete updatePayload[key];
        }
    });

    try {
      await updateDoc(activityRef, updatePayload);
    } catch (error) {
      console.error("Error updating reposition activity:", error);
    }
  }, []);
  
  const deleteRepositionActivity = useCallback(async (activityId: string) => {
    try {
      await deleteDoc(doc(db, 'repositionActivities', activityId));
    } catch (error) {
      console.error("Error deleting reposition activity:", error);
    }
  }, []);
  
  const finalizeRepositionActivity = useCallback(async (activity: RepositionActivity) => {
    if (!user) throw new Error("Usuário não autenticado.");
    if (!activity.items) return;

    const lotsToMove = activity.items.flatMap(item => 
      (item.receivedLots || []).map(lot => ({
        lotId: lot.lotId,
        productId: lot.productId,
        productName: lot.productName,
        lotNumber: lot.lotId,
        quantityToMove: lot.receivedQuantity,
        fromKioskId: activity.kioskOriginId,
        fromKioskName: activity.kioskOriginName,
        toKioskId: activity.kioskDestinationId,
        toKioskName: activity.kioskDestinationName,
        movedByUserId: user.id,
        movedByUsername: user.username,
      }))
    ).filter(lot => lot.quantityToMove > 0);
    
    if (lotsToMove.length > 0) {
      await moveMultipleLots(lotsToMove);
    }
    
    await updateRepositionActivity(activity.id, { status: 'Concluído' });

  }, [user, moveMultipleLots, updateRepositionActivity]);

  const value = useMemo(() => ({
    activities,
    loading,
    createRepositionActivity,
    updateRepositionActivity,
    deleteRepositionActivity,
    finalizeRepositionActivity,
  }), [activities, loading, createRepositionActivity, updateRepositionActivity, deleteRepositionActivity, finalizeRepositionActivity]);

  return <RepositionContext.Provider value={value}>{children}</RepositionContext.Provider>;
}
