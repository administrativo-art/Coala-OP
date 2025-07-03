
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type LotEntry, type MovementRecord, type Product } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch, setDoc } from 'firebase/firestore';

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
  deleteLotsByIds: (lotIds: string[]) => Promise<boolean>;
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
    try {
      await setDoc(lotRef, dataToUpdate, { merge: true });
    } catch (error) {
      console.error(`Error updating lot with ID ${id}:`, error);
      throw error; 
    }
  }, []);

  const deleteLotsByIds = useCallback(async (lotIds: string[]): Promise<boolean> => {
    if (!lotIds || lotIds.length === 0) {
      console.error("deleteLotsByIds called with an empty array.");
      return false;
    }
    
    // Using Promise.all with individual deleteDoc calls instead of a batch write.
    // This is a more direct approach that might either succeed where the batch failed,
    // or provide a more explicit error if one of the deletions fails.
    try {
      const deletePromises = lotIds.map(id => deleteDoc(doc(db, "lots", id)));
      await Promise.all(deletePromises);
      return true;
    } catch (error) {
      console.error("Error deleting lots by IDs with Promise.all:", error);
      return false;
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
      deleteLotsByIds,
      moveLot,
      moveMultipleLots
  };

  return <ExpiryProductsContext.Provider value={value}>{children}</ExpiryProductsContext.Provider>;
}
