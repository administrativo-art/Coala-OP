
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ProductSimulationCategory } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface ProductSimulationCategoryContextType {
  categories: ProductSimulationCategory[];
  loading: boolean;
  addCategory: (name: string) => Promise<void>;
  updateCategory: (id: string, name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

export const ProductSimulationCategoryContext = createContext<ProductSimulationCategoryContextType | undefined>(undefined);

export function ProductSimulationCategoryProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<ProductSimulationCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "productSimulationCategories"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulationCategory));
      setCategories(data.sort((a,b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching simulation categories:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addCategory = useCallback(async (name: string) => {
    if (!name.trim()) return;
    try {
      await addDoc(collection(db, "productSimulationCategories"), { name });
    } catch (error) {
      console.error("Error adding simulation category:", error);
    }
  }, []);

  const updateCategory = useCallback(async (id: string, name: string) => {
    if (!name.trim()) return;
    try {
      await updateDoc(doc(db, "productSimulationCategories", id), { name });
    } catch (error) {
      console.error("Error updating simulation category:", error);
    }
  }, []);
  
  const deleteCategory = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, "productSimulationCategories", id));
    } catch (error) {
      console.error("Error deleting simulation category:", error);
    }
  }, []);

  const value = useMemo(() => ({
    categories,
    loading,
    addCategory,
    updateCategory,
    deleteCategory,
  }), [categories, loading, addCategory, updateCategory, deleteCategory]);

  return <ProductSimulationCategoryContext.Provider value={value}>{children}</ProductSimulationCategoryContext.Provider>;
}
