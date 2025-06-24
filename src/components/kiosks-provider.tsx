"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type Kiosk } from '@/types';

const STORAGE_KEY = 'smart-converter-kiosks';

export interface KiosksContextType {
  kiosks: Kiosk[];
  loading: boolean;
  addKiosk: (kioskName: string) => void;
  deleteKiosk: (kioskId: string) => void;
}

export const KiosksContext = createContext<KiosksContextType | undefined>(undefined);

export function KiosksProvider({ children }: { children: React.ReactNode }) {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const items = window.localStorage.getItem(STORAGE_KEY);
      if (items) {
        setKiosks(JSON.parse(items));
      } else {
        const defaultKiosks: Kiosk[] = [
            { id: 'matriz', name: 'Centro de distribuição - Matriz' },
            { id: 'tirirical', name: 'Quiosque Tirirical' },
            { id: 'joao-paulo', name: 'Quiosque João Paulo' },
        ];
        setKiosks(defaultKiosks);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultKiosks));
      }
    } catch (error) {
      console.error('Failed to load kiosks from localStorage', error);
    } finally {
        setLoading(false);
    }
  }, []);

  const saveKiosks = useCallback((newKiosks: Kiosk[]) => {
    try {
      setKiosks(newKiosks);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newKiosks));
    } catch (error) {
      console.error('Failed to save kiosks to localStorage', error);
    }
  }, []);

  const addKiosk = useCallback((kioskName: string) => {
    if (kioskName && !kiosks.find(l => l.name.toLowerCase() === kioskName.toLowerCase())) {
        const newKiosk = { name: kioskName, id: new Date().toISOString() };
        saveKiosks([...kiosks, newKiosk]);
    }
  }, [kiosks, saveKiosks]);
  
  const deleteKiosk = useCallback((kioskId: string) => {
    const newKiosks = kiosks.filter(l => l.id !== kioskId);
    saveKiosks(newKiosks);
  }, [kiosks, saveKiosks]);
  
  const value: KiosksContextType = {
    kiosks,
    loading,
    addKiosk,
    deleteKiosk,
  };

  return <KiosksContext.Provider value={value}>{children}</KiosksContext.Provider>;
}
