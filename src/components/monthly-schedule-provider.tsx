
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type DailySchedule } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
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
  }, []); // Run only on initial mount

  const value: MonthlyScheduleContextType = {
    schedule,
    loading,
    fetchSchedule,
    currentYear,
    currentMonth
  };

  return <MonthlyScheduleContext.Provider value={value}>{children}</MonthlyScheduleContext.Provider>;
}
