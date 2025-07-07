
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type DailySchedule } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, doc, updateDoc, setDoc } from 'firebase/firestore';
import { type MonthlyScheduleContextType } from '@/types';

export const MonthlyScheduleContext = createContext<MonthlyScheduleContextType | undefined>(undefined);

export function MonthlyScheduleProvider({ children }: { children: React.ReactNode }) {
  const [schedule, setSchedule] = useState<DailySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [unsubscribe, setUnsubscribe] = useState<(() => void) | null>(null);

  const fetchSchedule = useCallback((year: number, month: number) => {
    if (unsubscribe) {
      unsubscribe();
    }
    
    setLoading(true);
    setCurrentYear(year);
    setCurrentMonth(month);
    
    const monthPadded = month.toString().padStart(2, '0');
    const scheduleCollectionPath = `escala/${year}-${monthPadded}/dias`;
    
    const q = query(collection(db, scheduleCollectionPath));
    const newUnsubscribe = onSnapshot(q, (querySnapshot) => {
      const scheduleData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as DailySchedule));
      setSchedule(scheduleData);
      setLoading(false);
    }, (error) => {
      console.error(`Error fetching schedule for ${year}-${monthPadded}: `, error);
      setSchedule([]); // Clear schedule on error
      setLoading(false);
    });

    setUnsubscribe(() => newUnsubscribe);

  }, [unsubscribe]);

  useEffect(() => {
    fetchSchedule(currentYear, currentMonth);
    
    // Cleanup on component unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDailySchedule = useCallback(async (dayId: string, updates: Partial<DailySchedule>) => {
    const monthPadded = currentMonth.toString().padStart(2, '0');
    const scheduleDocPath = `escala/${currentYear}-${monthPadded}/dias/${dayId}`;
    const docRef = doc(db, scheduleDocPath);

    try {
        // Using set with merge: true will create the document if it doesn't exist,
        // which might be desirable if a day was missed in generation.
        // Or use updateDoc if you only want to update existing docs.
        await setDoc(docRef, updates, { merge: true });
    } catch(error) {
        console.error("Error updating daily schedule:", error);
        throw error;
    }
  }, [currentYear, currentMonth]);


  const value: MonthlyScheduleContextType = useMemo(() => ({
    schedule,
    loading,
    fetchSchedule,
    currentYear,
    currentMonth,
    updateDailySchedule,
  }), [schedule, loading, fetchSchedule, currentYear, currentMonth, updateDailySchedule]);

  return <MonthlyScheduleContext.Provider value={value}>{children}</MonthlyScheduleContext.Provider>;
}
