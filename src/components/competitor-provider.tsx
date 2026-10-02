
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { 
    type Competitor, 
    type CompetitorProduct, 
    type CompetitorPrice,
    type CompetitorGroup
} from '@/types';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
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
  competitorGroups: CompetitorGroup[];
  competitorProducts: CompetitorProduct[];
  competitorPrices: CompetitorPrice[];
  loading: boolean;
  
  // Groups
  addCompetitorGroup: (data: Omit<CompetitorGroup, 'id'>) => Promise<string | null>;
  updateCompetitorGroup: (id: string, data: Partial<CompetitorGroup>) => Promise<void>;
  deleteCompetitorGroup: (id: string) => Promise<void>;

  // Competitors
  addCompetitor: (data: Omit<Competitor, 'id'>) => Promise<string | null>;
  updateCompetitor: (id: string, data: Partial<Competitor>) => Promise<void>;
  deleteCompetitor: (id: string) => Promise<void>;
  
  // Products
  addProduct: (product: Partial<Omit<CompetitorProduct, 'id'>> & { price?: number }) => Promise<string | null>;
  updateProduct: (id: string, data: Partial<CompetitorProduct>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  
  // Prices
  addPrice: (price: Omit<CompetitorPrice, 'id'>) => Promise<string | null>;
  updatePrice: (id: string, data: Partial<CompetitorPrice>) => Promise<void>;
  deletePrice: (id: string) => Promise<void>;
}

export const CompetitorContext = createContext<CompetitorContextType | undefined>(undefined);

export function CompetitorProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const shouldLoad = pathname === '/dashboard/pricing/price-comparison' || pathname === '/dashboard/settings';
    const [competitors, setCompetitors] = useState<Competitor[]>([]);
    const [competitorGroups, setCompetitorGroups] = useState<CompetitorGroup[]>([]);
    const [competitorProducts, setCompetitorProducts] = useState<CompetitorProduct[]>([]);
    const [competitorPrices, setCompetitorPrices] = useState<CompetitorPrice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!shouldLoad) {
            setCompetitors([]);
            setCompetitorGroups([]);
            setCompetitorProducts([]);
            setCompetitorPrices([]);
            setLoading(false);
            return;
        }

        let active = true;
        let unsubscribeCollections: (() => void) | undefined;
        let authGeneration = 0;

        const unsubAuth = onAuthStateChanged(auth, (user) => {
            if (!active) return;
            const generation = ++authGeneration;
            // Auth callbacks can run again when the signed-in user changes.
            // Tear down the previous user's listeners before clearing or loading data.
            unsubscribeCollections?.();
            unsubscribeCollections = undefined;
            setCompetitors([]);
            setCompetitorGroups([]);
            setCompetitorProducts([]);
            setCompetitorPrices([]);
            setLoading(true);

            if (!user) {
                setLoading(false);
                return;
            }

            const pendingInitialSnapshots = new Set(['competitors', 'groups', 'products', 'prices']);
            const markInitialSnapshot = (key: string) => {
                if (!pendingInitialSnapshots.delete(key)) return;
                if (pendingInitialSnapshots.size === 0) setLoading(false);
            };

            const unsubCompetitors = onSnapshot(query(collection(db, "concorrentes")), (snapshot) => {
                if (generation !== authGeneration) return;
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Competitor));
                setCompetitors(data);
                markInitialSnapshot('competitors');
            }, (error) => {
                if (generation !== authGeneration) return;
                console.error("Error fetching competitors:", error);
                markInitialSnapshot('competitors');
            });

            const unsubGroups = onSnapshot(query(collection(db, "competitorGroups")), (snapshot) => {
                if (generation !== authGeneration) return;
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CompetitorGroup));
                setCompetitorGroups(data);
                markInitialSnapshot('groups');
            }, (error) => {
                if (generation !== authGeneration) return;
                console.error("Error fetching competitor groups:", error);
                markInitialSnapshot('groups');
            });

            const unsubProducts = onSnapshot(query(collection(db, "concorrente_produtos")), (snapshot) => {
                if (generation !== authGeneration) return;
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CompetitorProduct));
                setCompetitorProducts(data);
                markInitialSnapshot('products');
            }, (error) => {
                if (generation !== authGeneration) return;
                console.error("Error fetching competitor products:", error);
                markInitialSnapshot('products');
            });

            const unsubPrices = onSnapshot(query(collection(db, "concorrente_precos")), (snapshot) => {
                if (generation !== authGeneration) return;
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CompetitorPrice));
                setCompetitorPrices(data);
                markInitialSnapshot('prices');
            }, (error) => {
                if (generation !== authGeneration) return;
                console.error("Error fetching competitor prices:", error);
                markInitialSnapshot('prices');
            });

            unsubscribeCollections = () => {
                unsubCompetitors();
                unsubGroups();
                unsubProducts();
                unsubPrices();
            };
        });

        return () => {
            active = false;
            authGeneration += 1;
            unsubscribeCollections?.();
            unsubAuth();
        };
    }, [shouldLoad]);

    // Competitor Groups
    const addCompetitorGroup = useCallback(async (data: Omit<CompetitorGroup, 'id'>) => {
        try {
            const docRef = await addDoc(collection(db, "competitorGroups"), data);
            return docRef.id;
        } catch (error) {
            console.error("Error adding competitor group:", error);
            return null;
        }
    }, []);

    const updateCompetitorGroup = useCallback(async (id: string, data: Partial<CompetitorGroup>) => {
        await updateDoc(doc(db, "competitorGroups", id), data);
    }, []);

    const deleteCompetitorGroup = useCallback(async (id: string) => {
        const batch = writeBatch(db);
        
        // Delete the group itself
        batch.delete(doc(db, "competitorGroups", id));
        
        // Find all competitors in this group and delete them and their related items
        const competitorsQuery = query(collection(db, "concorrentes"), where("competitorGroupId", "==", id));
        const competitorsSnapshot = await getDocs(competitorsQuery);

        for (const competitorDoc of competitorsSnapshot.docs) {
            batch.delete(competitorDoc.ref); // Delete competitor
            
            // Delete products of this competitor
            const productsQuery = query(collection(db, "concorrente_produtos"), where("competitorId", "==", competitorDoc.id));
            const productsSnapshot = await getDocs(productsQuery);
            
            for (const productDoc of productsSnapshot.docs) {
                batch.delete(productDoc.ref); // Delete product
                
                // Delete prices of this product
                const pricesQuery = query(collection(db, "concorrente_precos"), where("competitorProductId", "==", productDoc.id));
                const pricesSnapshot = await getDocs(pricesQuery);
                pricesSnapshot.forEach(priceDoc => batch.delete(priceDoc.ref));
            }
        }

        await batch.commit();
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
    const addProduct = useCallback(async (productData: Partial<Omit<CompetitorProduct, 'id'>> & { price?: number }) => {
        const { price, ...product } = productData;
        const batch = writeBatch(db);
        try {
            const productRef = doc(collection(db, "concorrente_produtos"));
            batch.set(productRef, product);

            if(price) {
                const priceRef = doc(collection(db, "concorrente_precos"));
                const newPrice: Omit<CompetitorPrice, 'id'> = {
                    competitorProductId: productRef.id,
                    price,
                    data_coleta: new Date().toISOString(),
                    fonte: 'Cadastro inicial',
                    promocional: false,
                };
                batch.set(priceRef, newPrice);
            }
            
            await batch.commit();
            return productRef.id;
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
        competitorGroups,
        competitorProducts,
        competitorPrices,
        loading,
        addCompetitorGroup,
        updateCompetitorGroup,
        deleteCompetitorGroup,
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
        competitors, competitorGroups, competitorProducts, competitorPrices, loading, 
        addCompetitorGroup, updateCompetitorGroup, deleteCompetitorGroup,
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
