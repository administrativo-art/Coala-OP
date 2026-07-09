

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type SimulationCategory } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';

export interface ProductSimulationCategoryContextType {
  categories: SimulationCategory[];
  loading: boolean;
  addCategory: (category: Omit<SimulationCategory, 'id'>) => Promise<string | null>;
  updateCategory: (category: SimulationCategory) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
}

export const ProductSimulationCategoryContext = createContext<ProductSimulationCategoryContextType | undefined>(undefined);

async function fetchCatalogLinesFallback(firebaseUser: { getIdToken: () => Promise<string> } | null): Promise<SimulationCategory[]> {
    if (!firebaseUser) return [];
    try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/catalogo', {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data?.lines)) return [];
        return data.lines.map((line: { id: string; name: string; color?: string }) => ({
            id: line.id,
            name: line.name,
            color: line.color ?? '',
            type: 'line' as const,
        }));
    } catch (error) {
        console.warn("Error fetching catalog lines fallback:", error);
        return [];
    }
}

export function ProductSimulationCategoryProvider({ children }: { children: React.ReactNode }) {
    const { firebaseUser } = useAuth();
    const [categories, setCategories] = useState<SimulationCategory[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const q = query(collection(db, "productSimulationCategories"));
        const unsubscribe = onSnapshot(q, async (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SimulationCategory));
            const hasLines = data.some(category => category.type === 'line');
            const fallbackLines = hasLines ? [] : await fetchCatalogLinesFallback(firebaseUser);
            const merged = [...data];
            fallbackLines.forEach((line) => {
                if (!merged.some(category => category.id === line.id)) {
                    merged.push(line);
                }
            });
            setCategories(merged.sort((a,b) => a.name.localeCompare(b.name)));
            setLoading(false);
        }, async (error) => {
            console.error("Error fetching simulation categories:", error);
            const fallbackLines = await fetchCatalogLinesFallback(firebaseUser);
            setCategories(fallbackLines.sort((a,b) => a.name.localeCompare(b.name)));
            setLoading(false);
        });
        return () => unsubscribe();
    }, [firebaseUser]);

    const addCategory = useCallback(async (category: Omit<SimulationCategory, 'id'>): Promise<string | null> => {
        try {
            const docRef = await addDoc(collection(db, "productSimulationCategories"), category);
            return docRef.id;
        } catch (error) {
            console.error("Error adding category:", error);
            return null;
        }
    }, []);

    const updateCategory = useCallback(async (category: SimulationCategory) => {
        const { id, ...data } = category;
        try {
            // Ensure color is not undefined
            const dataToUpdate = { ...data, color: data.color || '' };
            await updateDoc(doc(db, "productSimulationCategories", id), dataToUpdate);
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

    
