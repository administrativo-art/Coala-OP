
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { 
    type Competitor, 
    type CompetitorProduct, 
    type CompetitorPrice 
} from '@/types';
import { db } from '@/lib/firebase';
import { 
    collection, 
    onSnapshot, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc, 
    query,
    writeBatch,
    where,
    getDocs
} from 'firebase/firestore';

export interface CompetitorContextType {
  competitors: Competitor[];
  competitorProducts: CompetitorProduct[];
  competitorPrices: CompetitorPrice[];
  loading: boolean;
  addCompetitor: (data: Omit<Competitor, 'id'>) => Promise<string | null>;
  updateCompetitor: (id: string, data: Partial<Competitor>) => Promise<void>;
  deleteCompetitor: (id: string) => Promise<void>;
  addProduct: (product: Omit<CompetitorProduct, 'id'>) => Promise<string | null>;
  updateProduct: (id: string, data: Partial<CompetitorProduct>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addPrice: (price: Omit<CompetitorPrice, 'id'>) => Promise<string | null>;
  updatePrice: (id: string, data: Partial<CompetitorPrice>) => Promise<void>;
  deletePrice: (id: string) => Promise<void>;
}

export const CompetitorContext = createContext<CompetitorContextType | undefined>(undefined);

export function CompetitorProvider({ children }: { children: React.ReactNode }) {
    const [competitors, setCompetitors] = useState<Competitor[]>([]);
    const [competitorProducts, setCompetitorProducts] = useState<CompetitorProduct[]>([]);
    const [competitorPrices, setCompetitorPrices] = useState<CompetitorPrice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubCompetitors = onSnapshot(query(collection(db, "concorrentes")), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Competitor));
            setCompetitors(data);
        }, (error) => console.error("Error fetching competitors:", error));

        const unsubProducts = onSnapshot(query(collection(db, "concorrente_produtos")), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CompetitorProduct));
            setCompetitorProducts(data);
        }, (error) => console.error("Error fetching competitor products:", error));

        const unsubPrices = onSnapshot(query(collection(db, "concorrente_precos")), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CompetitorPrice));
            setCompetitorPrices(data);
        }, (error) => console.error("Error fetching competitor prices:", error));

        setLoading(false);

        return () => {
            unsubCompetitors();
            unsubProducts();
            unsubPrices();
        };
    }, []);

    // Competitors
    const addCompetitor = useCallback(async (data: Omit<Competitor, 'id'>) => {
        try {
            const docRef = await addDoc(collection(db, "concorrentes"), data);
            return docRef.id;
        } catch (error) {
            console.error("Error adding competitor:", error);
            return null;
        }
    }, []);

    const updateCompetitor = useCallback(async (id: string, data: Partial<Competitor>) => {
        await updateDoc(doc(db, "concorrentes", id), data);
    }, []);

    const deleteCompetitor = useCallback(async (id: string) => {
        const batch = writeBatch(db);
        batch.delete(doc(db, "concorrentes", id));
        
        const productsQuery = query(collection(db, "concorrente_produtos"), where("competitorId", "==", id));
        const productsSnapshot = await getDocs(productsQuery);
        
        for (const productDoc of productsSnapshot.docs) {
            batch.delete(productDoc.ref);
            const pricesQuery = query(collection(db, "concorrente_precos"), where("competitorProductId", "==", productDoc.id));
            const pricesSnapshot = await getDocs(pricesQuery);
            pricesSnapshot.forEach(priceDoc => batch.delete(priceDoc.ref));
        }

        await batch.commit();
    }, []);

    // Competitor Products
    const addProduct = useCallback(async (product: Omit<CompetitorProduct, 'id'>) => {
        try {
            const docRef = await addDoc(collection(db, "concorrente_produtos"), product);
            return docRef.id;
        } catch (error) {
            console.error("Error adding competitor product:", error);
            return null;
        }
    }, []);
    
    const updateProduct = useCallback(async (id: string, data: Partial<CompetitorProduct>) => {
        await updateDoc(doc(db, "concorrente_produtos", id), data);
    }, []);

    const deleteProduct = useCallback(async (id: string) => {
        const batch = writeBatch(db);
        batch.delete(doc(db, "concorrente_produtos", id));

        const pricesQuery = query(collection(db, "concorrente_precos"), where("competitorProductId", "==", id));
        const pricesSnapshot = await getDocs(pricesQuery);
        pricesSnapshot.forEach(priceDoc => batch.delete(priceDoc.ref));

        await batch.commit();
    }, []);

    // Competitor Prices
    const addPrice = useCallback(async (price: Omit<CompetitorPrice, 'id'>) => {
         try {
            const docRef = await addDoc(collection(db, "concorrente_precos"), price);
            return docRef.id;
        } catch (error) {
            console.error("Error adding competitor price:", error);
            return null;
        }
    }, []);

    const updatePrice = useCallback(async (id: string, data: Partial<CompetitorPrice>) => {
        await updateDoc(doc(db, "concorrente_precos", id), data);
    }, []);

    const deletePrice = useCallback(async (id: string) => {
        await deleteDoc(doc(db, "concorrente_precos", id));
    }, []);

    const value = useMemo(() => ({
        competitors,
        competitorProducts,
        competitorPrices,
        loading,
        addCompetitor,
        updateCompetitor,
        deleteCompetitor,
        addProduct,
        updateProduct,
        deleteProduct,
        addPrice,
        updatePrice,
        deletePrice
    }), [
        competitors, competitorProducts, competitorPrices, loading, 
        addCompetitor, updateCompetitor, deleteCompetitor,
        addProduct, updateProduct, deleteProduct,
        addPrice, updatePrice, deletePrice
    ]);

    return (
        <CompetitorContext.Provider value={value}>
            {children}
        </CompetitorContext.Provider>
    );
}
