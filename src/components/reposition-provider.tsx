

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type RepositionActivity, type RepositionItem } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, runTransaction, type DocumentSnapshot, getDoc } from 'firebase/firestore';
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
      const activityRef = await addDoc(collection(db, 'repositionActivities'), newActivity);
      
      // Reserve stock in a transaction
      await runTransaction(db, async (transaction) => {
        const lotRefsAndData: { lotRef: any, lotToMove: any }[] = [];

        // 1. Prepare all document references
        for (const item of data.items) {
          for (const lotToMove of item.suggestedLots) {
            const lotRef = doc(db, 'lots', lotToMove.lotId);
            lotRefsAndData.push({ lotRef, lotToMove });
          }
        }

        // 2. Read all documents first
        const lotDocs = await Promise.all(
          lotRefsAndData.map(item => transaction.get(item.lotRef))
        );

        // 3. Perform all writes
        lotDocs.forEach((lotDoc, index) => {
          if (!lotDoc.exists()) {
            throw new Error(`Lot ${lotRefsAndData[index].lotToMove.lotId} not found`);
          }
          const currentData = lotDoc.data();
          const currentReserved = currentData.reservedQuantity || 0;
          const { lotRef, lotToMove } = lotRefsAndData[index];
          
          if (currentData.quantity < currentReserved + lotToMove.quantityToMove) {
             throw new Error(`Estoque insuficiente para reservar no lote ${lotToMove.lotNumber}. Disponível: ${currentData.quantity - currentReserved}, Necessário: ${lotToMove.quantityToMove}`);
          }
          
          const newReserved = currentReserved + lotToMove.quantityToMove;
          transaction.update(lotRef, { reservedQuantity: newReserved });
        });
      });

      return activityRef.id;
    } catch (error) {
      console.error("Error creating reposition activity:", error);
      throw error;
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
    const activityToDelete = activities.find(a => a.id === activityId);
    if (!activityToDelete) return;
    
    if (activityToDelete.status === 'Aguardando despacho' || activityToDelete.status === 'Aguardando recebimento') {
      try {
        await runTransaction(db, async (transaction) => {
          const lotUpdates = new Map<string, { lotRef: any, newReserved: number }>();
          const lotRefsToRead: any[] = [];
  
          // Prepare reads
          for (const item of activityToDelete.items) {
            for (const lotToMove of item.suggestedLots) {
              const lotRef = doc(db, 'lots', lotToMove.lotId);
              if (!lotRefsToRead.some(r => r.path === lotRef.path)) {
                lotRefsToRead.push(lotRef);
              }
            }
          }
  
          const lotDocs = await Promise.all(lotRefsToRead.map(ref => transaction.get(ref)));
          const lotDataMap = new Map(lotDocs.map(doc => [doc.id, doc.data()]));
  
          // Calculate new reserved quantities
          for (const item of activityToDelete.items) {
            for (const lotToMove of item.suggestedLots) {
              const lotRef = doc(db, 'lots', lotToMove.lotId);
              const currentData = lotDataMap.get(lotToMove.lotId);
              if (currentData) {
                const currentReserved = lotUpdates.get(lotToMove.lotId)?.newReserved ?? (currentData.reservedQuantity || 0);
                const quantityToUnreserve = lotToMove.quantityToMove || 0;
                
                // Sanitize newReserved to ensure it doesn't go below zero or exceed total quantity
                let newReserved = Math.max(0, currentReserved - quantityToUnreserve);
                newReserved = Math.min(newReserved, currentData.quantity || 0);

                lotUpdates.set(lotToMove.lotId, { lotRef, newReserved });
              }
            }
          }
  
          // Apply writes
          for (const [, { lotRef, newReserved }] of lotUpdates) {
            transaction.update(lotRef, { reservedQuantity: newReserved });
          }
        });
      } catch (error) {
        console.error("Error un-reserving stock during activity deletion:", error);
      }
    }
  
    // Always delete the activity itself
    await deleteDoc(doc(db, 'repositionActivities', activityId));
  
  }, [activities]);
  
  const finalizeRepositionActivity = useCallback(async (activity: RepositionActivity) => {
    if (!user) throw new Error("Usuário não autenticado.");
    if (!activity.items) return;

    const itemsToMove = activity.items.flatMap(item => 
      (item.receivedLots || item.suggestedLots).map(lot => ({
        lotId: lot.lotId,
        productId: lot.productId,
        productName: lot.productName,
        lotNumber: lot.lotNumber,
        quantityToMove: (lot as any).receivedQuantity ?? lot.quantityToMove,
        fromKioskId: activity.kioskOriginId,
        fromKioskName: activity.kioskOriginName,
        toKioskId: activity.kioskDestinationId,
        toKioskName: activity.kioskDestinationName,
      }))
    ).filter(lot => lot.quantityToMove > 0);
    
    if (itemsToMove.length > 0) {
      const results = await moveMultipleLots(itemsToMove, user, { 
        isFinalizingReposition: true,
        allowPartialOnFinalize: true, // Allow moving what's possible, even if less than reserved
        activityId: activity.id
      }); 

      const pendingSum = results.reduce((acc, r) => acc + r.pending, 0);
      if (pendingSum > 0) {
        // Handle partial finalization (e.g., create new task, update activity status)
        console.warn(`Atividade ${activity.id} finalizada parcialmente. Pendente: ${pendingSum}`);
        await updateRepositionActivity(activity.id, { status: 'Concluído' }); // Or a custom "partial" status
      } else {
        await updateRepositionActivity(activity.id, { status: 'Concluído' });
      }

    } else {
      await updateRepositionActivity(activity.id, { status: 'Concluído' });
    }

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
