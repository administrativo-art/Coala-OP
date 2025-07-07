
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Shift } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';

export interface ScheduleContextType {
  shifts: Shift[];
  loading: boolean;
  addShift: (shift: Omit<Shift, 'id'>) => Promise<void>;
  updateShift: (shift: Shift) => Promise<void>;
  deleteShift: (shiftId: string) => Promise<void>;
}

export const ScheduleContext = createContext<ScheduleContextType | undefined>(undefined);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "schedules"), (querySnapshot) => {
      const shiftsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
      setShifts(shiftsData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching schedules from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addShift = useCallback(async (shift: Omit<Shift, 'id'>) => {
    try {
        await addDoc(collection(db, "schedules"), shift);
    } catch(error) {
        console.error("Error adding shift:", error);
    }
  }, []);

  const updateShift = useCallback(async (updatedShift: Shift) => {
    const shiftRef = doc(db, "schedules", updatedShift.id);
    const { id, ...dataToUpdate } = updatedShift;
     try {
        await updateDoc(shiftRef, dataToUpdate);
    } catch(error) {
        console.error("Error updating shift:", error);
    }
  }, []);

  const deleteShift = useCallback(async (shiftId: string) => {
    try {
        await deleteDoc(doc(db, "schedules", shiftId));
    } catch(error) {
        console.error("Error deleting shift:", error);
        throw error;
    }
  }, []);

  const value: ScheduleContextType = useMemo(() => ({
    shifts,
    loading,
    addShift,
    updateShift,
    deleteShift,
  }), [shifts, loading, addShift, updateShift, deleteShift]);

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}
