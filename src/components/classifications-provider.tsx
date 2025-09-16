
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { type Classification } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';

// Helper functions for normalization
function normalizeName(s: string): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ");
}
function toSlug(s: string): string {
  return normalizeName(s).toLowerCase();
}

export interface ClassificationsContextType {
  classifications: Classification[];
  loading: boolean;
  addClassification: (name: string) => Promise<Classification>;
  renameClassification: (id: string, newName: string) => Promise<void>;
  deleteClassification: (id: string) => Promise<void>;
}

export const ClassificationsContext = createContext<ClassificationsContextType | undefined>(undefined);

export function ClassificationsProvider({ children }: { children: React.ReactNode }) {
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { baseProducts, updateMultipleBaseProducts } = useBaseProducts();

  useEffect(() => {
    const q = query(collection(db, "classifications"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Classification));
      setClassifications(data.sort((a,b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching classifications:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addClassification = useCallback(async (name: string): Promise<Classification> => {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error("O nome não pode ser vazio.");
    
    const slug = toSlug(cleanName);
    const q = query(collection(db, "classifications"), where("slug", "==", slug));
    const existing = await getDocs(q);
    if (!existing.empty) {
      throw new Error("Esta classificação já existe.");
    }
    
    const now = Date.now();
    const newDoc: Omit<Classification, 'id'> = { name: cleanName, slug, createdAt: now, updatedAt: now, usageCount: 0 };
    const docRef = await addDoc(collection(db, "classifications"), newDoc);
    return { id: docRef.id, ...newDoc };
  }, []);

  const renameClassification = useCallback(async (id: string, newName: string) => {
    const cleanName = normalizeName(newName);
    if (!cleanName) throw new Error("O nome não pode ser vazio.");
    
    const slug = toSlug(cleanName);
    const q = query(collection(db, "classifications"), where("slug", "==", slug));
    const existing = await getDocs(q);
    if (!existing.empty && existing.docs[0].id !== id) {
      throw new Error("Já existe uma classificação com esse nome.");
    }

    const docRef = doc(db, "classifications", id);
    await updateDoc(docRef, { name: cleanName, slug, updatedAt: Date.now() });
  }, []);

  const deleteClassification = useCallback(async (id: string) => {
    await deleteDoc(doc(db, "classifications", id));
  }, []);

  const value = useMemo(() => ({
    classifications,
    loading,
    addClassification,
    renameClassification,
    deleteClassification
  }), [classifications, loading, addClassification, renameClassification, deleteClassification]);

  return (
    <ClassificationsContext.Provider value={value}>
      {children}
    </ClassificationsContext.Provider>
  );
}

    
