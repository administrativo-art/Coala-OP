
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PredefinedList } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface PredefinedListsContextType {
  lists: PredefinedList[];
  loading: boolean;
  addList: (list: Omit<PredefinedList, 'id'>) => Promise<void>;
  updateList: (updatedList: PredefinedList) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
}

export const PredefinedListsContext = createContext<PredefinedListsContextType | undefined>(undefined);

export function PredefinedListsProvider({ children }: { children: React.ReactNode }) {
  const [lists, setLists] = useState<PredefinedList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "predefinedLists"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const listsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PredefinedList));
      setLists(listsData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching predefined lists from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addList = useCallback(async (list: Omit<PredefinedList, 'id'>) => {
    try {
        await addDoc(collection(db, "predefinedLists"), list);
    } catch(error) {
        console.error("Error adding list:", error);
    }
  }, []);

  const updateList = useCallback(async (updatedList: PredefinedList) => {
    const listRef = doc(db, "predefinedLists", updatedList.id);
    const { id, ...dataToUpdate } = updatedList;
     try {
        await updateDoc(listRef, dataToUpdate);
    } catch(error) {
        console.error("Error updating list:", error);
    }
  }, []);

  const deleteList = useCallback(async (listId: string) => {
    try {
        await deleteDoc(doc(db, "predefinedLists", listId));
    } catch(error) {
        console.error("Error deleting list:", error);
        throw error;
    }
  }, []);

  const value: PredefinedListsContextType = useMemo(() => ({
    lists,
    loading,
    addList,
    updateList,
    deleteList,
  }), [lists, loading, addList, updateList, deleteList]);

  return <PredefinedListsContext.Provider value={value}>{children}</PredefinedListsContext.Provider>;
}
