"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type PredefinedList } from '@/types';

const STORAGE_KEY = 'smart-converter-predefined-lists';

export interface PredefinedListsContextType {
  lists: PredefinedList[];
  loading: boolean;
  addList: (list: Omit<PredefinedList, 'id'>) => void;
  updateList: (updatedList: PredefinedList) => void;
  deleteList: (listId: string) => void;
}

export const PredefinedListsContext = createContext<PredefinedListsContextType | undefined>(undefined);

export function PredefinedListsProvider({ children }: { children: React.ReactNode }) {
  const [lists, setLists] = useState<PredefinedList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const items = window.localStorage.getItem(STORAGE_KEY);
      if (items) {
        setLists(JSON.parse(items));
      }
    } catch (error) {
      console.error('Failed to load predefined lists from localStorage', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveLists = useCallback((newLists: PredefinedList[]) => {
    try {
      setLists(newLists);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newLists));
    } catch (error) {
      console.error('Failed to save predefined lists to localStorage', error);
    }
  }, []);

  const addList = useCallback((list: Omit<PredefinedList, 'id'>) => {
    const newList = { ...list, id: new Date().toISOString() };
    saveLists([...lists, newList]);
  }, [lists, saveLists]);

  const updateList = useCallback((updatedList: PredefinedList) => {
    const newLists = lists.map(l => l.id === updatedList.id ? updatedList : l);
    saveLists(newLists);
  }, [lists, saveLists]);

  const deleteList = useCallback((listId: string) => {
    const newLists = lists.filter(l => l.id !== listId);
    saveLists(newLists);
  }, [lists, saveLists]);

  const value: PredefinedListsContextType = {
    lists,
    loading,
    addList,
    updateList,
    deleteList,
  };

  return <PredefinedListsContext.Provider value={value}>{children}</PredefinedListsContext.Provider>;
}
