
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type LotEntry, type MovementRecord, type Product } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';

export type MoveLotParams = {
  lotId: string;
  toKioskId: string;
  quantityToMove: number;
  fromKioskId: string;
  fromKioskName: string;
  toKioskName: string;
  movedByUserId: string;
  movedByUsername: string;
  productName: string;
  lotNumber: string;
};

export interface ExpiryProductsContextType {
  lots: LotEntry[];
  loading: boolean;
  addLot: (lot: Omit<LotEntry, 'id'>) => Promise<void>;
  updateLot: (lot: LotEntry) => Promise<void>;
  deleteLot: (lotId: string) => Promise<void>;
  moveLot: (params: MoveLotParams) => Promise<void>;
  moveMultipleLots: (params: MoveLotParams[]) => Promise<void>;
}

export const ExpiryProductsContext = createContext<ExpiryProductsContextType | undefined>(undefined);

export function ExpiryProductsProvider({ children }: { children: React.ReactNode }) {
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

  const addLot = useCallback(async (lot: Omit<LotEntry, 'id'>) => {
    let q;
    // Firestore queries with `where` do not handle `undefined` values correctly. 
    // We must query for `null` if the locationId is not present.
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
  
  const updateLot = useCallback(async (updatedLot: LotEntry) => {
    const lotRef = doc(db, "lots", updatedLot.id);
    const { id, ...dataToUpdate } = updatedLot;
    if (dataToUpdate.quantity <= 0) {
        await deleteDoc(lotRef);
    } else {
        await updateDoc(lotRef, dataToUpdate);
    }
  }, []);

  const deleteLot = useCallback(async (lotId: string) => {
    if (!lotId || typeof lotId !== 'string' || lotId.trim() === '') {
      console.error("ID do lote é inválido. Ação cancelada.", lotId);
      throw new Error("ID do lote é inválido.");
    }
    const lotRef = doc(db, "lots", lotId);
    try {
      await deleteDoc(lotRef);
    } catch (error) {
      console.error(`Falha ao excluir lote com ID ${lotId}:`, error);
      throw error;
    }
  }, []);

  const executeMove = async (batch: any, params: MoveLotParams) => {
      const { lotId, toKioskId, quantityToMove, fromKioskId, productName, lotNumber, toKioskName, fromKioskName, movedByUserId, movedByUsername } = params;
      const sourceLotRef = doc(db, "lots", lotId);
      
      const sourceLotSnap = await getDocs(query(collection(db, "lots"), where("__name__", "==", lotId)));
      if (sourceLotSnap.empty) throw new Error(`Source lot ${lotId} not found`);

      const sourceLot = { id: sourceLotSnap.docs[0].id, ...sourceLotSnap.docs[0].data() } as LotEntry;

      if (sourceLot.kioskId === toKioskId || quantityToMove <= 0 || quantityToMove > sourceLot.quantity) {
          throw new Error(`Invalid move operation for lot ${lotId}`);
      }

      const newSourceQuantity = sourceLot.quantity - quantityToMove;
      if (newSourceQuantity > 0) {
          batch.update(sourceLotRef, { quantity: newSourceQuantity });
      } else {
          batch.delete(sourceLotRef);
      }

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

      const movementRecord: Omit<MovementRecord, 'id'> = {
          productName: productName,
          lotNumber: lotNumber,
          quantityMoved: quantityToMove,
          fromKioskId: fromKioskId,
          fromKioskName: fromKioskName,
          toKioskId: toKioskId,
          toKioskName: toKioskName,
          movedByUserId: movedByUserId,
          movedByUsername: movedByUsername,
          movedAt: new Date().toISOString(),
      };

      const movementHistoryRef = doc(collection(db, "movementHistory"));
      batch.set(movementHistoryRef, movementRecord);
  };

  const moveLot = useCallback(async (params: MoveLotParams) => {
    const batch = writeBatch(db);
    try {
        await executeMove(batch, params);
        await batch.commit();
    } catch (error) {
        console.error("Error moving lot:", error);
        throw error;
    }
  }, []);
  
  const moveMultipleLots = useCallback(async (paramsArray: MoveLotParams[]) => {
      const batch = writeBatch(db);
      try {
        await Promise.all(paramsArray.map(params => executeMove(batch, params)));
        await batch.commit();
      } catch (error) {
        console.error("Error moving multiple lots:", error);
        throw error;
      }
  }, []);

  const value: ExpiryProductsContextType = {
      lots,
      loading,
      addLot,
      updateLot,
      deleteLot,
      moveLot,
      moveMultipleLots
  };

  return <ExpiryProductsContext.Provider value={value}>{children}</ExpiryProductsContext.Provider>;
}
