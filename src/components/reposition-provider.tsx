

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type RepositionActivity, type RepositionItem, type LotEntry } from '@/types';
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
        // 1. Read all lots first if activity is in a state where stock is reserved
        if (activityToCancel.status === 'Aguardando despacho' || activityToCancel.status === 'Aguardando recebimento') {
            const lotRefsToRead = activityToCancel.items.flatMap(item => 
              item.suggestedLots.map(lot => doc(db, 'lots', lot.lotId))
            );
            const uniqueLotRefs = Array.from(new Map(lotRefsToRead.map(ref => [ref.path, ref])).values());
            const lotDocs = await Promise.all(uniqueLotRefs.map(ref => transaction.get(ref)));
            const lotDataMap = new Map(lotDocs.map(doc => [doc.id, doc.data() as LotEntry]));
    
            // 2. Prepare updates to un-reserve stock
            const lotUpdates = new Map<string, { reservedQuantity: number }>();
            activityToCancel.items.forEach(item => {
              item.suggestedLots.forEach(lotToUnreserve => {
                const currentData = lotDataMap.get(lotToUnreserve.lotId);
                if (currentData) {
                  const currentReserved = currentData.reservedQuantity || 0;
                  const newReserved = Math.max(0, currentReserved - lotToUnreserve.quantityToMove);
                  lotUpdates.set(lotToUnreserve.lotId, { reservedQuantity: newReserved });
                }
              });
            });
    
            // 3. Write all lot updates
            for (const [lotId, updateData] of lotUpdates.entries()) {
              const lotRef = doc(db, 'lots', lotId);
              transaction.update(lotRef, updateData);
            }
        }

        // 4. Update the activity status to 'cancelada'
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
    
    // Determine the actual quantity moved for each lot based on receivedLots
    const itemsToMove = activity.items.flatMap(item => 
        (item.receivedLots && item.receivedLots.length > 0 ? item.receivedLots : item.suggestedLots).map(lot => ({
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
        await moveMultipleLots(itemsToMove, user, { 
            isFinalizingReposition: true,
            activityId: activity.id,
            allowPartialOnFinalize: true, // Always allow partial on finalization
        });
    } else {
         // Even if no items were received, we need to release the reservation
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
    if (!user) throw new Error("Usuário não autenticado.");
    const activityToRevert = activities.find(a => a.id === activityId);
    if (!activityToRevert) {
        throw new Error("Activity to revert not found.");
    }
    
    try {
        await runTransaction(db, async (transaction) => {
            const activityRef = doc(db, 'repositionActivities', activityId);

            // Step 1: Collect all necessary document references to read first
            const refsToRead: Map<string, ReturnType<typeof doc>> = new Map();
            const sourceLotIds = activityToRevert.items.flatMap(item => item.suggestedLots.map(l => l.lotId));
            sourceLotIds.forEach(id => {
                if (!refsToRead.has(id)) refsToRead.set(id, doc(db, 'lots', id));
            });

            // If the activity was completed, we also need to read the destination lots
            if (activityToRevert.status === 'Concluído') {
                const sourceLotsSnaps = await Promise.all(
                    activityToRevert.items.flatMap(i => i.suggestedLots.map(l => getDoc(doc(db, 'lots', l.lotId))))
                );
                const expiryMap = new Map(sourceLotsSnaps.map(snap => [snap.id, (snap.data() as LotEntry)?.expiryDate]));

                activityToRevert.items.forEach(item => {
                    (item.receivedLots || item.suggestedLots).forEach(lot => {
                        const destinationLotId = destLotIdKey({
                            productId: lot.productId,
                            kioskId: activityToRevert.kioskDestinationId,
                            lotNumber: lot.lotNumber,
                            expiryDate: expiryMap.get(lot.lotId),
                        });
                        if (!refsToRead.has(destinationLotId)) {
                            refsToRead.set(destinationLotId, doc(db, 'lots', destinationLotId));
                        }
                    });
                });
            }

            // Step 2: Execute all reads
            const readDocs = await Promise.all(Array.from(refsToRead.values()).map(ref => transaction.get(ref)));
            const docDataMap = new Map(readDocs.map(d => [d.id, d.data()]));


            // Step 3: Perform all writes
            // Reverse stock movement if activity was completed
            if (activityToRevert.status === 'Concluído') {
                const sourceLotsSnaps = await Promise.all(
                    activityToRevert.items.flatMap(i => i.suggestedLots.map(l => getDoc(doc(db, 'lots', l.lotId))))
                );
                const expiryMap = new Map(sourceLotsSnaps.map(snap => [snap.id, (snap.data() as LotEntry)?.expiryDate]));

                activityToRevert.items.forEach(item => {
                    const lotsToProcess = item.receivedLots && item.receivedLots.length > 0 ? item.receivedLots : item.suggestedLots;
                    lotsToProcess.forEach(lot => {
                        const receivedQty = (lot as any).receivedQuantity ?? lot.quantityToMove;
                        if (receivedQty > 0) {
                            const sourceLotRef = doc(db, 'lots', lot.lotId);
                            const destinationLotId = destLotIdKey({
                                productId: lot.productId,
                                kioskId: activityToRevert.kioskDestinationId,
                                lotNumber: lot.lotNumber,
                                expiryDate: expiryMap.get(lot.lotId),
                            });
                            const destLotRef = doc(db, 'lots', destinationLotId);

                            if (docDataMap.has(destinationLotId)) {
                                transaction.update(destLotRef, { quantity: increment(-receivedQty) });
                                transaction.update(sourceLotRef, { quantity: increment(receivedQty) });
                            }
                        }
                    });
                });
            }

            // Re-reserve stock for the activity
            activityToRevert.items.forEach(item => {
                item.suggestedLots.forEach(lotToReReserve => {
                    const lotRef = doc(db, 'lots', lotToReReserve.lotId);
                    if (docDataMap.has(lotToReReserve.lotId)) { // Ensure lot exists before trying to update
                         transaction.update(lotRef, { reservedQuantity: increment(lotToReReserve.quantityToMove) });
                    }
                });
            });
            
            // Finally, update the activity status back to pending
            transaction.update(activityRef, {
                status: 'Aguardando despacho',
                receiptNotes: '',
                receiptSignature: {},
                updatedAt: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error("Error reverting reposition activity:", error);
        throw error;
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

