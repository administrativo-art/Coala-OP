
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
                transaction.update(lotRef, { 
                    reservedQuantity: increment(lotToMove.quantityToMove)
                });
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
        // 1. Mark the activity as cancelled
        const activityRef = doc(db, 'repositionActivities', activityId);
        transaction.update(activityRef, { status: 'Cancelada', updatedAt: new Date().toISOString() });
        
        // 2. Release reserved stock if the activity was pending
        if (activityToCancel.status === 'Aguardando despacho' || activityToCancel.status === 'Aguardando recebimento') {
            for (const item of activityToCancel.items) {
                for (const lot of item.suggestedLots) {
                    const lotRef = doc(db, 'lots', lot.lotId);
                    // Simply subtract the quantity this activity was reserving
                    transaction.update(lotRef, {
                        reservedQuantity: increment(-lot.quantityToMove)
                    });
                }
            }
        }
      });
    } catch (error) {
      console.error("Error cancelling reposition activity:", error);
      throw error;
    }
  }, [activities]);
  
  const finalizeRepositionActivity = useCallback(async (activity: RepositionActivity) => {
    if (!user) throw new Error("Usuário não autenticado.");
    if (!activity.items) return;

    const itemsToMove = activity.items.flatMap(item => 
        (item.receivedLots && item.receivedLots.length > 0 ? item.receivedLots : item.suggestedLots).map(lot => {
            const receivedQty = (lot as any).receivedQuantity === undefined ? lot.quantityToMove : (lot as any).receivedQuantity;
            
            return {
                lotId: lot.lotId,
                productId: lot.productId,
                productName: lot.productName,
                lotNumber: lot.lotNumber,
                quantityToMove: receivedQty,
                originalSentQuantity: lot.quantityToMove, // Pass the original sent quantity
                fromKioskId: activity.kioskOriginId,
                fromKioskName: activity.kioskOriginName,
                toKioskId: activity.kioskDestinationId,
                toKioskName: activity.kioskDestinationName,
            };
        })
    );

    const validItemsToMove = itemsToMove.filter(item => item.quantityToMove > 0);

    if (validItemsToMove.length > 0) {
        await moveMultipleLots(validItemsToMove, user, { 
            isFinalizingReposition: true,
            activityId: activity.id,
            allowPartialOnFinalize: true, 
        });
    }

    // For items with zero quantity received, just release the reservation.
    const zeroQuantityItems = itemsToMove.filter(item => item.quantityToMove === 0);
    if (zeroQuantityItems.length > 0) {
        await runTransaction(db, async (transaction) => {
            for (const item of zeroQuantityItems) {
                const lotRef = doc(db, 'lots', item.lotId);
                transaction.update(lotRef, { reservedQuantity: increment(-item.originalSentQuantity) });
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
             // 1. Find all movements related to this activity
            const movementsQuery = query(
                collection(db, 'movementHistory'),
                where('activityId', '==', activityId),
                where('reverted', '!=', true) // Only find non-reverted movements
            );
            const movementDocs = (await getDocs(movementsQuery)).docs;
            const entryMovements = movementDocs.map(d => d.data() as MovementRecord).filter(m => m.type === 'TRANSFERENCIA_ENTRADA');

            if (entryMovements.length === 0) {
                 console.log("No entry movements found to revert for this activity. Updating status only.");
            }

            // 2. For each entry movement, perform the reverse operation
            for (const entryMovement of entryMovements) {
                 // Debit from destination
                const destLotRef = doc(db, 'lots', entryMovement.lotId);
                transaction.update(destLotRef, { quantity: increment(-entryMovement.quantityChange) });

                // Find the corresponding source lot and credit it back
                const sourceLotRef = doc(db, 'lots', entryMovement.revertedFromId!);
                transaction.update(sourceLotRef, { quantity: increment(entryMovement.quantityChange) });

                 // Create reversal movement records for audit trail
                const now = new Date().toISOString();
                const reversalNotes = `Estorno da atividade de reposição ${activityId}`;
                
                const sourceReversal: Omit<MovementRecord, 'id'> = {
                    ...entryMovement,
                    lotId: sourceLotRef.id,
                    type: 'ENTRADA_ESTORNO',
                    toKioskId: entryMovement.fromKioskId,
                    toKioskName: entryMovement.fromKioskName,
                    fromKioskId: entryMovement.toKioskId,
                    fromKioskName: entryMovement.toKioskName,
                    timestamp: now,
                    notes: reversalNotes,
                    revertedFromId: entryMovement.id,
                };
                 const destReversal: Omit<MovementRecord, 'id'> = {
                    ...entryMovement,
                    lotId: destLotRef.id,
                    type: 'SAIDA_ESTORNO',
                    timestamp: now,
                    notes: reversalNotes,
                    revertedFromId: entryMovement.id,
                };

                const sourceMovementRef = doc(collection(db, "movementHistory"));
                const destMovementRef = doc(collection(db, "movementHistory"));
                transaction.set(sourceMovementRef, sourceReversal);
                transaction.set(destMovementRef, destReversal);
                
                // Mark original movements as reverted
                const originalEntryRef = doc(db, 'movementHistory', entryMovement.id);
                const originalExitRef = doc(db, 'movementHistory', entryMovement.revertedFromId!);
                transaction.update(originalEntryRef, { reverted: true });
                transaction.update(originalExitRef, { reverted: true });
            }
            
            // 3. Re-reserve the original quantities
            for (const item of activityToRevert.items) {
                for (const lot of item.suggestedLots) {
                     const lotRef = doc(db, 'lots', lot.lotId);
                     transaction.update(lotRef, { reservedQuantity: increment(lot.quantityToMove) });
                }
            }

            // 4. Update the activity status back to 'Aguardando despacho'
            const activityRef = doc(db, 'repositionActivities', activityId);
            transaction.update(activityRef, {
                status: 'Aguardando despacho',
                receiptNotes: '',
                receiptSignature: {}, // Clear signatures
                transportSignature: {},
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
