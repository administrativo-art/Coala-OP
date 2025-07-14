
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type AnalysisProduct } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface StockAnalysisProductsContextType {
  analysisProducts: AnalysisProduct[];
  loading: boolean;
  addAnalysisProduct: (product: Omit<AnalysisProduct, 'id'>) => Promise<void>;
  updateMultipleAnalysisProducts: (products: AnalysisProduct[]) => Promise<void>;
  deleteAnalysisProduct: (productId: string) => Promise<void>;
}

export const StockAnalysisProductsContext = createContext<StockAnalysisProductsContextType | undefined>(undefined);

export function StockAnalysisProductsProvider({ children }: { children: React.ReactNode }) {
  const [analysisProducts, setAnalysisProducts] = useState<AnalysisProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockAnalysisProducts"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const productsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AnalysisProduct));
        setAnalysisProducts(productsData.sort((a,b) => a.itemName.localeCompare(b.itemName)));
        setLoading(false);
    }, (error) => {
        console.error("Error fetching stock analysis products from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addAnalysisProduct = useCallback(async (product: Omit<AnalysisProduct, 'id'>) => {
    try {
        await addDoc(collection(db, "stockAnalysisProducts"), product);
    } catch(error) {
        console.error("Error adding analysis product:", error);
    }
  }, []);
  
  const updateMultipleAnalysisProducts = useCallback(async (productsToUpdate: AnalysisProduct[]) => {
    const batch = writeBatch(db);
    productsToUpdate.forEach(product => {
      if(product.id) {
        const productRef = doc(db, "stockAnalysisProducts", product.id);
        const { id, ...dataToUpdate } = product;
        batch.update(productRef, dataToUpdate);
      }
    });
    try {
      await batch.commit();
    } catch(error) {
      console.error("Error updating multiple analysis products:", error);
      throw error;
    }
  }, []);

  const deleteAnalysisProduct = useCallback(async (productId: string) => {
    try {
        await deleteDoc(doc(db, "stockAnalysisProducts", productId));
    } catch (error) {
        console.error("Error deleting analysis product:", error);
        throw error;
    }
  }, []);
  
  const value: StockAnalysisProductsContextType = useMemo(() => ({
    analysisProducts,
    loading,
    addAnalysisProduct,
    updateMultipleAnalysisProducts,
    deleteAnalysisProduct,
  }), [analysisProducts, loading, addAnalysisProduct, updateMultipleAnalysisProducts, deleteAnalysisProduct]);

  return <StockAnalysisProductsContext.Provider value={value}>{children}</StockAnalysisProductsContext.Provider>;
}
