

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Kiosk } from '@/types';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, doc, writeBatch, query, updateDoc } from "firebase/firestore";

export interface KiosksContextType {
  kiosks: Kiosk[];
  loading: boolean;
  addKiosk: (kioskData: Partial<Kiosk>) => Promise<void>;
  updateKiosk: (kiosk: Kiosk) => Promise<void>;
  deleteKiosk: (kioskId: string) => Promise<void>;
}

export const KiosksContext = createContext<KiosksContextType | undefined>(undefined);

export function KiosksProvider({ children }: { children: React.ReactNode }) {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setKiosks([]);
        setLoading(false);
        return;
      }

      const q = query(collection(db, "kiosks"));
      const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        // If the collection is empty, seed it with default data.
        if (querySnapshot.empty && !localStorage.getItem('kiosks_seeded')) {
          console.log("No kiosks found. Seeding default kiosks...");
          const batch = writeBatch(db);
          
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
    });

    return () => unsubAuth();
  }, []);
  
  const addKiosk = useCallback(async (kioskData: Partial<Kiosk>) => {
    if (kioskData.name && !kiosks.find(l => l.name.toLowerCase() === kioskData.name!.toLowerCase())) {
        try {
            await addDoc(collection(db, "kiosks"), kioskData);
        } catch(error) {
            console.error("Error adding kiosk:", error);
        }
    }
  }, [kiosks]);

  const updateKiosk = useCallback(async (kioskData: Kiosk) => {
    const { id, ...data } = kioskData;
    const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    try {
        await updateDoc(doc(db, "kiosks", id), cleanData);
    } catch(error) {
        console.error("Error updating kiosk:", error);
    }
  }, []);
  
  const deleteKiosk = useCallback(async (kioskId: string) => {
    try {
        await deleteDoc(doc(db, "kiosks", kioskId));
    } catch(error) {
        console.error("Error deleting kiosk:", error);
        throw error;
    }
  }, []);
  
  const value: KiosksContextType = useMemo(() => ({
    kiosks,
    loading,
    addKiosk,
    updateKiosk,
    deleteKiosk,
  }), [kiosks, loading, addKiosk, updateKiosk, deleteKiosk]);

  return <KiosksContext.Provider value={value}>{children}</KiosksContext.Provider>;
}
