

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type RepositionActivity, type RepositionItem, type LotEntry, type MovementRecord } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, runTransaction, type DocumentSnapshot, getDoc, where, getDocs, increment } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useExpiryProducts } from '@/hooks/use-expiry-products';

export interface RepositionContextType {
  activities: RepositionActivity[];
  loading: boolean;
  createRepositionActivity: (data: Omit<RepositionActivity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'requestedBy'>) => Promise<string | null>;
  updateRepositionActivity: (activityId: string, updates: Partial<RepositionActivity>) => Promise<void>;
  cancelRepositionActivity: (activityId: string) => Promise<void>;
  finalizeRepositionActivity: (activity: RepositionActivity) => Promise<void>;
  revertRepositionActivity: (activityId: string) => Promise<void>;
}

export const RepositionContext = createContext<RepositionContextType | undefined>(undefined);

// Helper to generate the unique key for a lot
const destLotIdKey = (params: {
  productId: string;
  kioskId: string;
  expiryDate?: string | null;
  lotNumber: string;
}) => {
  const { productId, kioskId, lotNumber, expiryDate = 'null' } = params;
  const cleanLotNumber = lotNumber.replace(/[\/\s]/g, '_');
  return `prod_${productId}__kiosk_${kioskId}__lot_${cleanLotNumber}__exp_${expiryDate}`;
};

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
      
      await runTransaction(db, async (transaction) => {
        const lotRefsToRead = data.items.flatMap(item => item.suggestedLots.map(lot => doc(db, 'lots', lot.lotId)));
        const uniqueLotRefs = Array.from(new Map(lotRefsToRead.map(ref => [ref.path, ref])).values());
        const lotDocs = await Promise.all(uniqueLotRefs.map(ref => transaction.get(ref)));
        const lotDataMap = new Map(lotDocs.map(doc => [doc.id, doc.data()]));

        for (const item of data.items) {
          for (const lotToMove of item.suggestedLots) {
            const currentData = lotDataMap.get(lotToMove.lotId);
            if (!currentData) {
              throw new Error(`Lote ${lotToMove.lotId} não encontrado`);
            }
            
            const currentReserved = currentData.reservedQuantity || 0;
            const availableQuantity = currentData.quantity - currentReserved;

            if (availableQuantity < lotToMove.quantityToMove) {
               throw new Error(`Estoque insuficiente para reservar no lote ${lotToMove.lotNumber}. Disponível: ${availableQuantity}, Necessário: ${lotToMove.quantityToMove}`);
            }
          }
        }
        
        for (const item of data.items) {
            for (const lotToMove of item.suggestedLots) {
                const lotRef = doc(db, 'lots', lotToMove.lotId);
                const currentData = lotDataMap.get(lotToMove.lotId)!;
                const currentReserved = currentData.reservedQuantity || 0;
                const newReserved = currentReserved + lotToMove.quantityToMove;
                transaction.update(lotRef, { reservedQuantity: newReserved });
            }
        }
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
  
  const cancelRepositionActivity = useCallback(async (activityId: string) => {
    const activityToCancel = activities.find(a => a.id === activityId);
    if (!activityToCancel || activityToCancel.status === 'Concluído' || activityToCancel.status === 'Cancelada') {
        console.warn("Activity cannot be cancelled or not found.");
        return;
    }
  
    try {
      await runTransaction(db, async (transaction) => {
        if (activityToCancel.status === 'Aguardando despacho' || activityToCancel.status === 'Aguardando recebimento') {
            for (const item of activityToCancel.items) {
                for (const lotToUnreserve of item.suggestedLots) {
                    const lotRef = doc(db, 'lots', lotToUnreserve.lotId);
                    transaction.update(lotRef, {
                        reservedQuantity: increment(-lotToUnreserve.quantityToMove)
                    });
                }
            }
        }

        const activityRef = doc(db, 'repositionActivities', activityId);
        transaction.update(activityRef, { status: 'Cancelada', updatedAt: new Date().toISOString() });
      });
    } catch (error) {
      console.error("Error cancelling reposition activity:", error);
      throw error;
    }
  }, [activities]);
  
 const finalizeRepositionActivity = useCallback(async (activity: RepositionActivity) => {
    if (!user) throw new Error("Usuário não autenticado.");
    if (!activity.items) return;

    // Determine the actual quantity received for each lot.
    const itemsToMove = activity.items.flatMap(item => 
        (item.receivedLots && item.receivedLots.length > 0 ? item.receivedLots : item.suggestedLots).map(lot => {
            const receivedQty = (lot as any).receivedQuantity;
            
            return {
                lotId: lot.lotId,
                productId: lot.productId,
                productName: lot.productName,
                lotNumber: lot.lotNumber,
                quantityToMove: receivedQty, // This is the key change: use received quantity
                fromKioskId: activity.kioskOriginId,
                fromKioskName: activity.kioskOriginName,
                toKioskId: activity.kioskDestinationId,
                toKioskName: activity.kioskDestinationName,
            };
        })
    ).filter(lot => lot.quantityToMove > 0);

    if (itemsToMove.length > 0) {
        await moveMultipleLots(itemsToMove, user, { 
            isFinalizingReposition: true,
            activityId: activity.id,
            allowPartialOnFinalize: true, 
        });
    } else {
        await runTransaction(db, async (transaction) => {
            for (const item of activity.items) {
                for (const lot of item.suggestedLots) {
                    const lotRef = doc(db, 'lots', lot.lotId);
                    transaction.update(lotRef, { reservedQuantity: increment(-lot.quantityToMove) });
                }
            }
        });
    }
    
    await updateRepositionActivity(activity.id, { status: 'Concluído' });

}, [user, moveMultipleLots, updateRepositionActivity]);
  
  const revertRepositionActivity = useCallback(async (activityId: string) => {
    if (!user) throw new Error("User not authenticated.");
    const activityToRevert = activities.find(a => a.id === activityId);
    if (!activityToRevert) {
        throw new Error("Atividade para reverter não encontrada.");
    }
    if (activityToRevert.status !== 'Concluído') {
        throw new Error("Só é possível reverter atividades concluídas.");
    }

    try {
        await runTransaction(db, async (transaction) => {
            const movementsQuery = query(
                collection(db, 'movementHistory'),
                where('activityId', '==', activityId),
                where('type', 'in', ['TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA'])
            );
            const movementDocs = await getDocs(movementsQuery);
            if (movementDocs.empty) {
                console.log("No movements to revert, just updating status.");
            }

            for (const movementDoc of movementDocs.docs) {
                const movement = movementDoc.data() as MovementRecord;
                
                if (movement.type === 'TRANSFERENCIA_ENTRADA') {
                    const lotRef = doc(db, 'lots', movement.lotId);
                    transaction.update(lotRef, { quantity: increment(-movement.quantityChange) });
                } else if (movement.type === 'TRANSFERENCIA_SAIDA') {
                    const lotRef = doc(db, 'lots', movement.lotId);
                    transaction.update(lotRef, {
                        quantity: increment(movement.quantityChange),
                        reservedQuantity: increment(movement.quantityChange)
                    });
                }
            }
            
            const activityRef = doc(db, 'repositionActivities', activityId);
            transaction.update(activityRef, {
                status: 'Aguardando despacho',
                receiptNotes: '',
                receiptSignature: {},
                updatedAt: new Date().toISOString()
            });
        });
    } catch (error: any) {
        console.error("Error reverting reposition activity:", error);
        throw new Error(error.message || "Ocorreu um erro desconhecido ao reverter.");
    }
  }, [user, activities]);

  const value = useMemo(() => ({
    activities,
    loading,
    createRepositionActivity,
    updateRepositionActivity,
    cancelRepositionActivity,
    finalizeRepositionActivity,
    revertRepositionActivity
  }), [activities, loading, createRepositionActivity, updateRepositionActivity, cancelRepositionActivity, finalizeRepositionActivity, revertRepositionActivity]);

  return <RepositionContext.Provider value={value}>{children}</RepositionContext.Provider>;
}




