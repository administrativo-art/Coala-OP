

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { type RepositionActivity, type RepositionItem, type LotEntry, type MovementRecord, type RepositionContextType } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, runTransaction, type DocumentSnapshot, getDoc, where, getDocs, increment, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useExpiryProducts } from '@/hooks/use-expiry-products';

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
  const { moveMultipleLots, optimisticallyUpdateLots } = useExpiryProducts();

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
    const activityRef = doc(collection(db, 'repositionActivities'));
    
    const newActivityData: RepositionActivity = {
      ...data,
      id: activityRef.id,
      status: 'Aguardando despacho',
      isSeparated: false,
      requestedBy: {
        userId: user.id,
        username: user.username,
      },
      createdAt: now,
      updatedAt: now,
    } as RepositionActivity;

    try {
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
        
        transaction.set(activityRef, newActivityData);

        for (const item of data.items) {
            for (const lotToMove of item.suggestedLots) {
                const lotRef = doc(db, 'lots', lotToMove.lotId);
                transaction.update(lotRef, { 
                    reservedQuantity: increment(lotToMove.quantityToMove)
                });
            }
        }
      });

      // Optimistic UI updates after successful transaction
      setActivities(prev => [newActivityData, ...prev].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      
      const lotUpdates = data.items.flatMap(item => 
        item.suggestedLots.map(lot => ({
          lotId: lot.lotId,
          quantityToReserve: lot.quantityToMove
        }))
      );
      optimisticallyUpdateLots(lotUpdates);

      return activityRef.id;
    } catch (error) {
      console.error("Error creating reposition activity:", error);
      throw error;
    }
  }, [user, optimisticallyUpdateLots]);

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
  
    // Prepare lot updates for optimistic UI
    const lotUpdates: { lotId: string; quantityToReserve: number }[] = [];
    if (activityToCancel.status === 'Aguardando despacho' || activityToCancel.status === 'Aguardando recebimento') {
        activityToCancel.items.forEach(item => {
            item.suggestedLots.forEach(lot => {
                lotUpdates.push({
                    lotId: lot.lotId,
                    quantityToReserve: -lot.quantityToMove // Negative to release reservation
                });
            });
        });
    }

    try {
      await runTransaction(db, async (transaction) => {
        const activityRef = doc(db, 'repositionActivities', activityId);
        transaction.update(activityRef, { status: 'Cancelada', updatedAt: new Date().toISOString() });
        
        if (activityToCancel.status === 'Aguardando despacho' || activityToCancel.status === 'Aguardando recebimento') {
            for (const item of activityToCancel.items) {
                for (const lot of item.suggestedLots) {
                    const lotRef = doc(db, 'lots', lot.lotId);
                    transaction.update(lotRef, {
                        reservedQuantity: increment(-lot.quantityToMove)
                    });
                }
            }
        }
      });

      // Optimistic UI updates
      if (lotUpdates.length > 0) {
        optimisticallyUpdateLots(lotUpdates);
      }
      setActivities(prev => prev.map(act => act.id === activityId ? { ...act, status: 'Cancelada' } : act));

    } catch (error) {
      console.error("Error cancelling reposition activity:", error);
      throw error;
    }
  }, [activities, optimisticallyUpdateLots]);
  
  const finalizeRepositionActivity = useCallback(async (activity: RepositionActivity, resolution: 'trust_receipt' | 'trust_dispatch' = 'trust_receipt') => {
    if (!user) throw new Error("Usuário não autenticado.");
    if (!activity.items) return;

    const itemsToMove: MoveLotParams[] = [];
    const itemsToReleaseReservation: { lotId: string, quantityToRelease: number }[] = [];

    activity.items.forEach(item => {
        item.suggestedLots.forEach(sentLot => {
            const receivedLot = (activity.status === 'Recebido com divergência' && item.receivedLots) 
                ? item.receivedLots.find(rl => rl.lotId === sentLot.lotId) 
                : undefined;
            
            const receivedQty = receivedLot !== undefined ? (receivedLot as any).receivedQuantity : sentLot.quantityToMove;

            const qtyToActuallyMove = resolution === 'trust_receipt' ? receivedQty : sentLot.quantityToMove;

            if (qtyToActuallyMove > 0) {
                 itemsToMove.push({
                    lotId: sentLot.lotId,
                    productId: sentLot.productId,
                    productName: sentLot.productName,
                    lotNumber: sentLot.lotNumber,
                    quantityToMove: qtyToActuallyMove,
                    originalSentQuantity: sentLot.quantityToMove,
                    fromKioskId: activity.kioskOriginId,
                    fromKioskName: activity.kioskOriginName,
                    toKioskId: activity.kioskDestinationId,
                    toKioskName: activity.kioskDestinationName,
                });
            }

            if (sentLot.quantityToMove > qtyToActuallyMove) {
                const diff = sentLot.quantityToMove - qtyToActuallyMove;
                itemsToReleaseReservation.push({ lotId: sentLot.lotId, quantityToRelease: diff });
            }
        });
    });

    if (itemsToMove.length > 0) {
        await moveMultipleLots(itemsToMove, user, { 
            isFinalizingReposition: true,
            activityId: activity.id,
            allowPartialOnFinalize: true, 
        });
    }

    if (itemsToReleaseReservation.length > 0) {
        await runTransaction(db, async (transaction) => {
            for (const item of itemsToReleaseReservation) {
                const lotRef = doc(db, 'lots', item.lotId);
                transaction.update(lotRef, { reservedQuantity: increment(-item.quantityToRelease) });
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
                where('reverted', '!=', true)
            );
            const movementDocs = (await getDocs(movementsQuery)).docs;
            const entryMovements = movementDocs.map(d => ({id: d.id, ...d.data()} as MovementRecord)).filter(m => m.type === 'TRANSFERENCIA_ENTRADA');

            if (entryMovements.length === 0) {
                 console.log("No entry movements found to revert for this activity. Updating status only.");
            }
            
            for (const entryMovement of entryMovements) {
                const destLotRef = doc(db, 'lots', entryMovement.lotId);
                transaction.update(destLotRef, { quantity: increment(-entryMovement.quantityChange) });

                const sourceLotRef = doc(db, 'lots', entryMovement.revertedFromId!);
                transaction.update(sourceLotRef, { quantity: increment(entryMovement.quantityChange) });

                const now = new Date().toISOString();
                const reversalNotes = `Estorno da atividade de reposição ${activityId}`;
                
                const addMovementRecord = (tx: any, record: Omit<MovementRecord, 'id'>) => {
                    const movementHistoryRef = doc(collection(db, "movementHistory"));
                    tx.set(movementHistoryRef, record);
                  };

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
                
                const originalEntryRef = doc(db, 'movementHistory', entryMovement.id);
                const originalExitRef = doc(db, 'movementHistory', entryMovement.revertedFromId!);
                transaction.update(originalEntryRef, { reverted: true });
                transaction.update(originalExitRef, { reverted: true });
            }
            
            for (const item of activityToRevert.items) {
                for (const lot of item.suggestedLots) {
                     const lotRef = doc(db, 'lots', lot.lotId);
                     transaction.update(lotRef, { reservedQuantity: increment(lot.quantityToMove) });
                }
            }

            const activityRef = doc(db, 'repositionActivities', activityId);
            transaction.update(activityRef, {
                status: 'Aguardando despacho',
                isSeparated: false,
                receiptNotes: '',
                receiptSignature: {},
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
  
  return (
    <RepositionContext.Provider value={value}>
      {children}
    </RepositionContext.Provider>
  );
}
