"use client";

import { useState, useEffect, useCallback } from 'react';
import { type LotEntry } from '@/types';

const STORAGE_KEY = 'smart-converter-expiry-lots';

const generateId = () => new Date().toISOString() + Math.random();

export function useExpiryProducts() {
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
           { id: generateId(), productName: 'Leite Integral', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), locationId: '1', quantity: 50 },
           { id: generateId(), productName: 'Leite Integral', barcode: '7890123456789', lotNumber: 'LT123', expiryDate: new Date(new Date().setDate(today.getDate() + 10)).toISOString(), locationId: '2', quantity: 25 },
           { id: generateId(), productName: 'Iogurte Natural', barcode: '7899876543210', lotNumber: 'LT456', expiryDate: new Date(new Date().setDate(today.getDate() - 5)).toISOString(), locationId: '1', quantity: 30 },
           { id: generateId(), productName: 'Queijo Minas', barcode: '7891112223334', lotNumber: 'LT789', expiryDate: new Date(new Date().setDate(today.getDate() + 45)).toISOString(), locationId: '2', quantity: 15 },
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
    const existingLotIndex = lots.findIndex(l => 
        l.productName === lot.productName &&
        l.lotNumber === lot.lotNumber &&
        l.locationId === lot.locationId
    );

    if (existingLotIndex > -1) {
        const newLots = [...lots];
        newLots[existingLotIndex].quantity += lot.quantity;
        newLots[existingLotIndex].expiryDate = lot.expiryDate;
        newLots[existingLotIndex].barcode = lot.barcode;
        saveLots(newLots);
    } else {
        const newLot = { ...lot, id: generateId() };
        saveLots([...lots, newLot]);
    }
  }, [lots, saveLots]);
  
  const updateLot = useCallback((updatedLot: LotEntry) => {
    const newLots = lots.map(l => l.id === updatedLot.id ? updatedLot : l);
    saveLots(newLots);
  }, [lots, saveLots]);

  const deleteLot = useCallback((lotId: string) => {
    const newLots = lots.filter(l => l.id !== lotId);
    saveLots(newLots);
  }, [lots, saveLots]);

  const moveLot = useCallback((lotId: string, toLocationId: string, quantityToMove: number) => {
    const sourceLot = lots.find(l => l.id === lotId);
    if (!sourceLot || sourceLot.locationId === toLocationId || quantityToMove <= 0) {
      return;
    }

    const newLots = [...lots];
    
    const sourceLotIndex = newLots.findIndex(l => l.id === lotId);
    let destinationLotIndex = newLots.findIndex(l => 
        l.productName === sourceLot.productName &&
        l.lotNumber === sourceLot.lotNumber &&
        l.locationId === toLocationId
    );

    newLots[sourceLotIndex].quantity -= quantityToMove;

    if (destinationLotIndex > -1) {
        newLots[destinationLotIndex].quantity += quantityToMove;
    } else {
        const newDestinationEntry: LotEntry = {
            ...sourceLot,
            id: generateId(),
            locationId: toLocationId,
            quantity: quantityToMove,
        };
        newLots.push(newDestinationEntry);
    }
    
    saveLots(newLots);
  }, [lots, saveLots]);

  return { lots, loading, addLot, updateLot, deleteLot, moveLot };
}
