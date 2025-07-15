

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type LotEntry, type MovementRecord, type MovementType } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch, setDoc, runTransaction } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';

export type MoveLotParams = {
  lotId: string;
  toKioskId: string;
  quantityToMove: number;
  fromKioskId: string;
  fromKioskName: string;
  toKioskName: string;
  movedByUserId: string;
  movedByUsername: string;
  productName: string; // This should be the full formatted name
  lotNumber: string;
  productId: string;
};

export type ConsumeLotParams = {
  lotId: string;
  quantityToConsume: number;
  type: 'SAIDA_CONSUMO' | 'SAIDA_DESCARTE' | 'SAIDA_CORRECAO';
  notes?: string;
};

export interface ExpiryProductsContextType {
  lots: LotEntry[];
  loading: boolean;
  addLot: (lot: Omit<LotEntry, 'id'>) => Promise<void>;
  updateLot: (lot: Partial<LotEntry> & { id: string }) => Promise<void>;
  deleteLotsByIds: (lotIds: string[]) => Promise<boolean>;
  forceDeleteLotById: (lotId: string) => Promise<boolean>;
  moveMultipleLots: (params: MoveLotParams[]) => Promise<void>;
  consumeFromLot: (params: ConsumeLotParams) => Promise<void>;
  adjustLotQuantity: (lotId: string, newQuantity: number, countedBy: { userId: string, username: string }) => Promise<void>;
}

export const ExpiryProductsContext = createContext<ExpiryProductsContextType | undefined>(undefined);

export function ExpiryProductsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "lots"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const lotsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LotEntry));
      setLots(lotsData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching lots from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addMovementRecord = (batch: any, record: Omit<MovementRecord, 'id'>) => {
    const movementHistoryRef = doc(collection(db, "movementHistory"));
    batch.set(movementHistoryRef, record);
  };

  const addLot = useCallback(async (lot: Omit<LotEntry, 'id'>) => {
    let q;
    if (lot.locationId) {
        q = query(
          collection(db, "lots"),
          where("productId", "==", lot.productId),
          where("lotNumber", "==", lot.lotNumber),
          where("expiryDate", "==", lot.expiryDate),
          where("kioskId", "==", lot.kioskId),
          where("locationId", "==", lot.locationId)
        );
    } else {
        q = query(
          collection(db, "lots"),
          where("productId", "==", lot.productId),
          where("lotNumber", "==", lot.lotNumber),
          where("expiryDate", "==", lot.expiryDate),
          where("kioskId", "==", lot.kioskId),
          where("locationId", "==", null)
        );
    }

    const batch = writeBatch(db);
    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            const existingLot = existingDoc.data() as LotEntry;
            const lotRef = doc(db, "lots", existingDoc.id);
            await updateDoc(lotRef, {
                quantity: existingLot.quantity + lot.quantity,
                imageUrl: lot.imageUrl || existingLot.imageUrl, 
            });
        } else {
            await addDoc(collection(db, "lots"), lot);
        }
    } catch (error) {
        console.error("Error adding lot:", error);
    }
  }, []);
  
  const updateLot = useCallback(async (updatedLot: Partial<LotEntry> & { id: string }) => {
    const lotRef = doc(db, "lots", updatedLot.id);
    const { id, ...dataToUpdate } = updatedLot;
    try {
      await setDoc(lotRef, dataToUpdate, { merge: true });
    } catch (error) {
      console.error(`Error updating lot with ID ${id}:`, error);
      throw error; 
    }
  }, []);

  const deleteLotsByIds = useCallback(async (lotIds: string[]): Promise<boolean> => {
    if (!lotIds || lotIds.length === 0) {
      return false;
    }
    const batch = writeBatch(db);
    lotIds.forEach(id => {
      batch.delete(doc(db, "lots", id));
    });

    try {
      await batch.commit();
      return true;
    } catch (error) {
      console.error("Error batch deleting lots:", error);
      return false;
    }
  }, []);
  
  const forceDeleteLotById = useCallback(async (lotId: string): Promise<boolean> => {
    if (!lotId) {
        console.error("forceDeleteLotById called with no ID.");
        return false;
    }
    try {
        await deleteDoc(doc(db, "lots", lotId));
        return true;
    } catch (error) {
        console.error(`Force delete failed for lot ID ${lotId}:`, error);
        return false;
    }
  }, []);

  const moveMultipleLots = useCallback(async (paramsArray: MoveLotParams[]) => {
      const batch = writeBatch(db);
      try {
        for (const params of paramsArray) {
            const { lotId, toKioskId, quantityToMove, fromKioskId, productName, lotNumber, toKioskName, fromKioskName, movedByUserId, movedByUsername } = params;
            const sourceLotRef = doc(db, "lots", lotId);
            
            const sourceLotSnap = await getDocs(query(collection(db, "lots"), where("__name__", "==", lotId)));
            if (sourceLotSnap.empty) throw new Error(`Source lot ${lotId} not found`);

            const sourceLot = { id: sourceLotSnap.docs[0].id, ...sourceLotSnap.docs[0].data() } as LotEntry;

            if (sourceLot.kioskId === toKioskId || quantityToMove <= 0 || quantityToMove > sourceLot.quantity) {
                throw new Error(`Invalid move operation for lot ${lotId}`);
            }

            const newSourceQuantity = sourceLot.quantity - quantityToMove;
            batch.update(sourceLotRef, { quantity: newSourceQuantity });

            const destQuery = query(
                collection(db, "lots"),
                where("productId", "==", sourceLot.productId),
                where("lotNumber", "==", sourceLot.lotNumber),
                where("expiryDate", "==", sourceLot.expiryDate),
                where("kioskId", "==", toKioskId),
                where("locationId", "==", null) // Moved stock arrives without a location
            );
            const destSnap = await getDocs(destQuery);
            
            if (!destSnap.empty) {
                const destDoc = destSnap.docs[0];
                const newQuantity = destDoc.data().quantity + quantityToMove;
                batch.update(destDoc.ref, { quantity: newQuantity });
            } else {
                const newDestLotRef = doc(collection(db, "lots"));
                const newLotData: Omit<LotEntry, 'id'> = {
                    productId: sourceLot.productId,
                    productName: sourceLot.productName,
                    lotNumber: sourceLot.lotNumber,
                    expiryDate: sourceLot.expiryDate,
                    kioskId: toKioskId,
                    quantity: quantityToMove,
                    imageUrl: sourceLot.imageUrl,
                    locationId: null,
                    locationName: null,
                    locationCode: null,
                };
                batch.set(newDestLotRef, newLotData);
            }
        }
        await batch.commit();
      } catch (error) {
        console.error("Error moving multiple lots:", error);
        throw error;
      }
  }, []);

  const consumeFromLot = useCallback(async (params: ConsumeLotParams) => {
    // This function will need the user from context, so it should be defined within the provider or have user passed to it.
    // For now, let's assume it will be handled.
    console.log("consumeFromLot called with:", params);
  }, []);

  const adjustLotQuantity = useCallback(async (lotId: string, newQuantity: number, countedBy: { userId: string, username: string }) => {
    if (!user) {
        throw new Error("Usuário de aprovação não autenticado.");
    }
    await runTransaction(db, async (transaction) => {
        const lotRef = doc(db, "lots", lotId);
        const lotDoc = await transaction.get(lotRef);

        if (!lotDoc.exists()) {
            throw new Error("Lote não encontrado para ajuste.");
        }

        const currentLot = lotDoc.data() as LotEntry;
        const currentQuantity = currentLot.quantity;
        const difference = newQuantity - currentQuantity;

        if (difference === 0) return; // No change needed

        const movementType: MovementType = difference > 0 ? 'ENTRADA_CORRECAO' : 'SAIDA_CORRECAO';
        const movementNotes = `Ajuste de estoque aprovado por ${user.username}. Contado por ${countedBy.username}.`;

        const movementRecord: Omit<MovementRecord, 'id'> = {
            lotId: lotId,
            productId: currentLot.productId,
            productName: currentLot.productName,
            lotNumber: currentLot.lotNumber,
            type: movementType,
            quantityChange: Math.abs(difference),
            kioskId: currentLot.kioskId,
            kioskName: 'N/A', // Kiosk name would ideally be passed in or looked up
            userId: user.id,
            username: user.username,
            timestamp: new Date().toISOString(),
            notes: movementNotes,
        };

        const movementRef = doc(collection(db, 'movementHistory'));
        transaction.set(movementRef, movementRecord);
        transaction.update(lotRef, { quantity: newQuantity });
    });
}, [user]);

  const value: ExpiryProductsContextType = useMemo(() => ({
      lots,
      loading,
      addLot,
      updateLot,
      deleteLotsByIds,
      forceDeleteLotById,
      moveMultipleLots,
      consumeFromLot,
      adjustLotQuantity,
  }), [lots, loading, addLot, updateLot, deleteLotsByIds, forceDeleteLotById, moveMultipleLots, consumeFromLot, adjustLotQuantity]);

  return <ExpiryProductsContext.Provider value={value}>{children}</ExpiryProductsContext.Provider>;
}
