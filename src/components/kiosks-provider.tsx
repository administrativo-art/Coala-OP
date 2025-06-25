"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type Kiosk } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, writeBatch, getDocs, query } from "firebase/firestore";

export interface KiosksContextType {
  kiosks: Kiosk[];
  loading: boolean;
  addKiosk: (kioskName: string) => Promise<void>;
  deleteKiosk: (kioskId: string) => Promise<void>;
}

export const KiosksContext = createContext<KiosksContextType | undefined>(undefined);

export function KiosksProvider({ children }: { children: React.ReactNode }) {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "kiosks"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      // If the collection is empty, seed it with default data.
      if (querySnapshot.empty && !localStorage.getItem('kiosks_seeded')) {
        console.log("No kiosks found. Seeding default kiosks...");
        const defaultKiosks = [
            { name: 'Centro de distribuição - Matriz' },
            { name: 'Quiosque Tirirical' },
            { name: 'Quiosque João Paulo' },
        ];
        const batch = writeBatch(db);
        // We need a stable ID for the 'matriz' kiosk for user assignment
        batch.set(doc(db, "kiosks", "matriz"), { name: 'Centro de distribuição - Matriz' });
        batch.set(doc(db, "kiosks", "tirirical"), { name: 'Quiosque Tirirical' });
        batch.set(doc(db, "kiosks", "joao-paulo"), { name: 'Quiosque João Paulo' });
        
        try {
          await batch.commit();
          localStorage.setItem('kiosks_seeded', 'true');
        } catch (seedError) {
          console.error("Error seeding kiosks:", seedError);
        }
        return; // Listener will re-run with new data.
      }
      
      const kiosksData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Kiosk));
      setKiosks(kiosksData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching kiosks from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  const addKiosk = useCallback(async (kioskName: string) => {
    if (kioskName && !kiosks.find(l => l.name.toLowerCase() === kioskName.toLowerCase())) {
        try {
            await addDoc(collection(db, "kiosks"), { name: kioskName });
        } catch(error) {
            console.error("Error adding kiosk:", error);
        }
    }
  }, [kiosks]);
  
  const deleteKiosk = useCallback(async (kioskId: string) => {
    try {
        await deleteDoc(doc(db, "kiosks", kioskId));
    } catch(error) {
        console.error("Error deleting kiosk:", error);
    }
  }, []);
  
  const value: KiosksContextType = {
    kiosks,
    loading,
    addKiosk,
    deleteKiosk,
  };

  return <KiosksContext.Provider value={value}>{children}</KiosksContext.Provider>;
}
