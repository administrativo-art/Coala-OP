

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ProductSimulationCategory } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface ProductSimulationCategoryContextType {
  categories: ProductSimulationCategory[];
  loading: boolean;
  addCategory: (category: Omit<ProductSimulationCategory, 'id'>) => Promise<string | null>;
  updateCategory: (category: ProductSimulationCategory) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
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

    const addCategory = useCallback(async (category: Omit<ProductSimulationCategory, 'id'>): Promise<string | null> => {
        try {
            const docRef = await addDoc(collection(db, "productSimulationCategories"), category);
            return docRef.id;
        } catch (error) {
            console.error("Error adding category:", error);
            return null;
        }
    }, []);

    const updateCategory = useCallback(async (category: ProductSimulationCategory) => {
        const { id, ...data } = category;
        try {
            await updateDoc(doc(db, "productSimulationCategories", id), data);
        } catch (error) {
            console.error("Error updating category:", error);
        }
    }, []);

    const deleteCategory = useCallback(async (categoryId: string) => {
        try {
            await deleteDoc(doc(db, "productSimulationCategories", categoryId));
        } catch (error) {
            console.error("Error deleting category:", error);
        }
    }, []);

    const value = useMemo(() => ({
        categories,
        loading,
        addCategory,
        updateCategory,
        deleteCategory
    }), [categories, loading, addCategory, updateCategory, deleteCategory]);

    return (
        <ProductSimulationCategoryContext.Provider value={value}>
            {children}
        </ProductSimulationCategoryContext.Provider>
    );
}
