
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type LotEntry, type MovementRecord } from '@/types';
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
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      // Seed initial data if collection is empty
      if (querySnapshot.empty && !localStorage.getItem('lots_seeded')) {
        console.log("No lots found. Seeding default lots...");
        const today = new Date();
        const dummyLots: Omit<LotEntry, 'id'>[] = [
           { productName: 'Leite Integral (1L)', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'tirirical', quantity: 50 },
           { productName: 'Leite Integral (1L)', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'joao-paulo', quantity: 25 },
           { productName: 'Ovomaltine (250g)', barcode: '7899876543210', lotNumber: 'OV250-1', expiryDate: new Date(new Date().setDate(today.getDate() + 30)).toISOString(), kioskId: 'matriz', quantity: 4 },
           { productName: 'Ovomaltine (750g)', barcode: '7899876543211', lotNumber: 'OV750-1', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'matriz', quantity: 2 },
           { productName: 'Ovomaltine (500g)', barcode: '7899876543212', lotNumber: 'OV500-1', expiryDate: new Date(new Date().setDate(today.getDate() + 25)).toISOString(), kioskId: 'matriz', quantity: 1 },
           { productName: 'Queijo Minas', barcode: '7891112223334', lotNumber: 'LT789', expiryDate: new Date(new Date().setDate(today.getDate() + 45)).toISOString(), kioskId: 'matriz', quantity: 15 },
        ];
        const batch = writeBatch(db);
        dummyLots.forEach(lot => {
            const docRef = doc(collection(db, "lots"));
            batch.set(docRef, lot);
        });
        try {
            await batch.commit();
            localStorage.setItem('lots_seeded', 'true');
        } catch(seedError) {
            console.error("Error seeding lots:", seedError);
        }
        return; // Listener will re-run with new data
      }
      
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
    const q = query(
      collection(db, "lots"),
      where("productName", "==", lot.productName),
      where("lotNumber", "==", lot.lotNumber),
      where("expiryDate", "==", lot.expiryDate),
      where("kioskId", "==", lot.kioskId)
    );

    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            const existingLot = existingDoc.data() as LotEntry;
            const lotRef = doc(db, "lots", existingDoc.id);
            await updateDoc(lotRef, {
                quantity: existingLot.quantity + lot.quantity,
                barcode: lot.barcode, 
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
    try {
        await deleteDoc(doc(db, "lots", lotId));
    } catch(error) {
        console.error("Error deleting lot:", error);
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
          where("productName", "==", sourceLot.productName),
          where("lotNumber", "==", sourceLot.lotNumber),
          where("expiryDate", "==", sourceLot.expiryDate),
          where("kioskId", "==", toKioskId)
      );
      const destSnap = await getDocs(destQuery);
      
      if (!destSnap.empty) {
          const destDoc = destSnap.docs[0];
          const newQuantity = destDoc.data().quantity + quantityToMove;
          batch.update(destDoc.ref, { quantity: newQuantity });
      } else {
          const newDestLotRef = doc(collection(db, "lots"));
          const newLotData: Omit<LotEntry, 'id'> = {
              productName: sourceLot.productName,
              barcode: sourceLot.barcode,
              lotNumber: sourceLot.lotNumber,
              expiryDate: sourceLot.expiryDate,
              kioskId: toKioskId,
              quantity: quantityToMove,
              imageUrl: sourceLot.imageUrl,
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
