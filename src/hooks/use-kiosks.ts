"use client";

import { useState, useEffect, useCallback } from 'react';
import { type Kiosk } from '@/types';

const STORAGE_KEY = 'smart-converter-kiosks';

export function useKiosks() {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const items = window.localStorage.getItem(STORAGE_KEY);
      if (items) {
        setKiosks(JSON.parse(items));
      } else {
        const defaultKiosks: Kiosk[] = [
            { id: '1', name: 'Quiosque Principal' },
            { id: '2', name: 'Quiosque Praia' },
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

  return { kiosks, loading, addKiosk, deleteKiosk };
}
