
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type BaseProduct, type UnitCategory, unitCategories } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface BaseProductsContextType {
  baseProducts: BaseProduct[];
  loading: boolean;
  addBaseProduct: (product: Omit<BaseProduct, 'id'>) => Promise<void>;
  updateBaseProduct: (product: BaseProduct) => Promise<void>;
  updateMultipleBaseProducts: (products: BaseProduct[]) => Promise<void>;
  deleteBaseProduct: (productId: string) => Promise<void>;
}

export const BaseProductsContext = createContext<BaseProductsContextType | undefined>(undefined);

export function BaseProductsProvider({ children }: { children: React.ReactNode }) {
  const [baseProducts, setBaseProducts] = useState<BaseProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "baseProducts"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const productsData = querySnapshot.docs.map(doc => {
             const data = doc.data();
             const originalCategory = data.category as string | undefined;
            let category: UnitCategory = 'Unidade'; 

            if (originalCategory) {
                const formatted = originalCategory.charAt(0).toUpperCase() + originalCategory.slice(1).toLowerCase();
                if (unitCategories.includes(formatted as UnitCategory)) {
                    category = formatted as UnitCategory;
                }
            }

            return { 
                id: doc.id, 
                ...data,
                category,
             } as BaseProduct
        });
        setBaseProducts(productsData.sort((a,b) => (a.name || '').localeCompare(b.name || '')));
        setLoading(false);
    }, (error) => {
        console.error("Error fetching base products from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addBaseProduct = useCallback(async (product: Omit<BaseProduct, 'id'>) => {
    try {
        await addDoc(collection(db, "baseProducts"), product);
    } catch(error) {
        console.error("Error adding base product:", error);
    }
  }, []);

  const updateBaseProduct = useCallback(async (product: BaseProduct) => {
    const productRef = doc(db, "baseProducts", product.id);
    const { id, ...dataToUpdate } = product;
    try {
        await updateDoc(productRef, dataToUpdate);
    } catch (error) {
        console.error("Error updating base product:", error);
        throw error;
    }
  }, []);
  
  const updateMultipleBaseProducts = useCallback(async (productsToUpdate: BaseProduct[]) => {
    const batch = writeBatch(db);
    productsToUpdate.forEach(product => {
      if(product.id) {
        const productRef = doc(db, "baseProducts", product.id);
        const { id, ...dataToUpdate } = product;
        batch.update(productRef, dataToUpdate);
      }
    });
    try {
      await batch.commit();
    } catch(error) {
      console.error("Error updating multiple base products:", error);
      throw error;
    }
  }, []);

  const deleteBaseProduct = useCallback(async (productId: string) => {
    try {
        await deleteDoc(doc(db, "baseProducts", productId));
    } catch (error) {
        console.error("Error deleting base product:", error);
        throw error;
    }
  }, []);
  
  const value: BaseProductsContextType = useMemo(() => ({
    baseProducts,
    loading,
    addBaseProduct,
    updateBaseProduct,
    updateMultipleBaseProducts,
    deleteBaseProduct,
  }), [baseProducts, loading, addBaseProduct, updateBaseProduct, updateMultipleBaseProducts, deleteBaseProduct]);

  return <BaseProductsContext.Provider value={value}>{children}</BaseProductsContext.Provider>;
}
