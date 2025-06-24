"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type LotEntry } from '@/types';

const STORAGE_KEY = 'smart-converter-expiry-lots';

const generateId = () => new Date().toISOString() + Math.random();

export interface ExpiryProductsContextType {
  lots: LotEntry[];
  loading: boolean;
  addLot: (lot: Omit<LotEntry, 'id'>) => void;
  updateLot: (lot: LotEntry) => void;
  deleteLot: (lotId: string) => void;
  moveLot: (lotId: string, toKioskId: string, quantityToMove: number) => void;
}

export const ExpiryProductsContext = createContext<ExpiryProductsContextType | undefined>(undefined);

export function ExpiryProductsProvider({ children }: { children: React.ReactNode }) {
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const items = window.localStorage.getItem(STORAGE_KEY);
      if (items) {
        setLots(JSON.parse(items));
      } else {
         const today = new Date();
         const dummyLots: LotEntry[] = [
           { id: generateId(), productName: 'Leite Integral', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'tirirical', quantity: 50 },
           { id: generateId(), productName: 'Leite Integral', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), kioskId: 'joao-paulo', quantity: 25 },
           { id: generateId(), productName: 'Iogurte Natural', barcode: '7899876543210', lotNumber: 'LT456', expiryDate: new Date(new Date().setDate(today.getDate() - 5)).toISOString(), kioskId: 'tirirical', quantity: 30 },
           { id: generateId(), productName: 'Queijo Minas', barcode: '7891112223334', lotNumber: 'LT789', expiryDate: new Date(new Date().setDate(today.getDate() + 45)).toISOString(), kioskId: 'matriz', quantity: 15 },
         ];
         setLots(dummyLots);
         window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dummyLots));
      }
    } catch (error) {
      console.error('Failed to load lots from localStorage', error);
    } finally {
        setLoading(false);
    }
  }, []);

  const saveLots = useCallback((newLots: LotEntry[]) => {
    try {
      const validLots = newLots.filter(lot => lot.quantity > 0);
      setLots(validLots);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validLots));
    } catch (error) {
      console.error('Failed to save lots to localStorage', error);
    }
  }, []);

  const addLot = useCallback((lot: Omit<LotEntry, 'id'>) => {
    setLots(prevLots => {
        const existingLotIndex = prevLots.findIndex(l => 
            l.productName === lot.productName &&
            l.lotNumber === lot.lotNumber &&
            l.kioskId === lot.kioskId
        );

        let newLots;
        if (existingLotIndex > -1) {
            newLots = [...prevLots];
            newLots[existingLotIndex].quantity += lot.quantity;
            newLots[existingLotIndex].expiryDate = lot.expiryDate;
            newLots[existingLotIndex].barcode = lot.barcode;
        } else {
            const newLot = { ...lot, id: generateId() };
            newLots = [...prevLots, newLot];
        }
        saveLots(newLots);
        return newLots;
    });
  }, [saveLots]);
  
  const updateLot = useCallback((updatedLot: LotEntry) => {
    setLots(prevLots => {
        const newLots = prevLots.map(l => l.id === updatedLot.id ? updatedLot : l);
        saveLots(newLots);
        return newLots;
    });
  }, [saveLots]);

  const deleteLot = useCallback((lotId: string) => {
    setLots(prevLots => {
        const newLots = prevLots.filter(l => l.id !== lotId);
        saveLots(newLots);
        return newLots;
    });
  }, [saveLots]);

  const moveLot = useCallback((lotId: string, toKioskId: string, quantityToMove: number) => {
    setLots(prevLots => {
        const sourceLot = prevLots.find(l => l.id === lotId);
        if (!sourceLot || sourceLot.kioskId === toKioskId || quantityToMove <= 0) {
          return prevLots;
        }

        let newLots = [...prevLots];
        
        const sourceLotIndex = newLots.findIndex(l => l.id === lotId);
        let destinationLotIndex = newLots.findIndex(l => 
            l.productName === sourceLot.productName &&
            l.lotNumber === sourceLot.lotNumber &&
            l.kioskId === toKioskId
        );

        newLots[sourceLotIndex].quantity -= quantityToMove;

        if (destinationLotIndex > -1) {
            newLots[destinationLotIndex].quantity += quantityToMove;
        } else {
            const newDestinationEntry: LotEntry = {
                ...sourceLot,
                id: generateId(),
                kioskId: toKioskId,
                quantity: quantityToMove,
            };
            newLots.push(newDestinationEntry);
        }
        
        const finalLots = newLots.filter(l => l.quantity > 0);
        saveLots(finalLots);
        return finalLots;
    });
  }, [saveLots]);

  const value: ExpiryProductsContextType = {
      lots,
      loading,
      addLot,
      updateLot,
      deleteLot,
      moveLot
  };

  return <ExpiryProductsContext.Provider value={value}>{children}</ExpiryProductsContext.Provider>;
}
