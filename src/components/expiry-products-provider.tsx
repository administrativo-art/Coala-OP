"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type LotEntry } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';

export interface ExpiryProductsContextType {
  lots: LotEntry[];
  loading: boolean;
  addLot: (lot: Omit<LotEntry, 'id'>) => Promise<void>;
  updateLot: (lot: LotEntry) => Promise<void>;
  deleteLot: (lotId: string) => Promise<void>;
  moveLot: (lotId: string, toKioskId: string, quantityToMove: number) => Promise<void>;
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
           { productName: 'Leite Integral', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'tirirical', quantity: 50 },
           { productName: 'Leite Integral', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'joao-paulo', quantity: 25 },
           { productName: 'Iogurte Natural', barcode: '7899876543210', lotNumber: 'LT456', expiryDate: new Date(new Date().setDate(today.getDate() - 5)).toISOString(), kioskId: 'tirirical', quantity: 30 },
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
    // Check if a lot with the same product, lot number, and kiosk already exists
    const q = query(
      collection(db, "lots"),
      where("productName", "==", lot.productName),
      where("lotNumber", "==", lot.lotNumber),
      where("kioskId", "==", lot.kioskId)
    );

    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            // Update existing lot
            const existingDoc = querySnapshot.docs[0];
            const existingLot = existingDoc.data() as LotEntry;
            const lotRef = doc(db, "lots", existingDoc.id);
            await updateDoc(lotRef, {
                quantity: existingLot.quantity + lot.quantity,
                expiryDate: lot.expiryDate, // Update expiry date and barcode as well
                barcode: lot.barcode,
            });
        } else {
            // Add new lot
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

  const moveLot = useCallback(async (lotId: string, toKioskId: string, quantityToMove: number) => {
    const sourceLotRef = doc(db, "lots", lotId);

    try {
        const sourceLotSnap = await getDocs(query(collection(db, "lots"), where("__name__", "==", lotId)));
        if (sourceLotSnap.empty) throw new Error("Source lot not found");
        
        const sourceLot = { id: sourceLotSnap.docs[0].id, ...sourceLotSnap.docs[0].data() } as LotEntry;

        if (sourceLot.kioskId === toKioskId || quantityToMove <= 0 || quantityToMove > sourceLot.quantity) {
          console.warn("Invalid move operation");
          return;
        }

        const batch = writeBatch(db);

        // Decrease quantity of source lot
        const newSourceQuantity = sourceLot.quantity - quantityToMove;
        if (newSourceQuantity > 0) {
            batch.update(sourceLotRef, { quantity: newSourceQuantity });
        } else {
            batch.delete(sourceLotRef);
        }

        // Find or create destination lot
        const destQuery = query(
            collection(db, "lots"),
            where("productName", "==", sourceLot.productName),
            where("lotNumber", "==", sourceLot.lotNumber),
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
                ...sourceLot,
                kioskId: toKioskId,
                quantity: quantityToMove,
            };
            batch.set(newDestLotRef, newLotData);
        }

        await batch.commit();

    } catch (error) {
        console.error("Error moving lot:", error);
    }
  }, []);

  const value: ExpiryProductsContextType = {
      lots,
      loading,
      addLot,
      updateLot,
      deleteLot,
      moveLot
  };

  return <ExpiryProductsContext.Provider value={value}>{children}</ExpiryProductsContext.Provider>;
}
