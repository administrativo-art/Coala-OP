
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { type DailySchedule } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, doc, updateDoc, setDoc, writeBatch } from 'firebase/firestore';
import { type MonthlyScheduleContextType } from '@/types';
import { getYear, getMonth, subMonths } from 'date-fns';

export const MonthlyScheduleContext = createContext<MonthlyScheduleContextType | undefined>(undefined);

export function MonthlyScheduleProvider({ children }: { children: React.ReactNode }) {
  const [schedule, setSchedule] = useState<DailySchedule[]>([]);
  const [previousMonthSchedule, setPreviousMonthSchedule] = useState<DailySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const prevUnsubscribeRef = useRef<(() => void) | null>(null);

  const fetchSchedule = useCallback((year: number, month: number) => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }
     if (prevUnsubscribeRef.current) {
      prevUnsubscribeRef.current();
    }
    
    setLoading(true);
    setCurrentYear(year);
    setCurrentMonth(month);
    
    const monthPadded = month.toString().padStart(2, '0');
    const scheduleCollectionPath = `escala/${year}-${monthPadded}/dias`;
    
    const q = query(collection(db, scheduleCollectionPath));
    unsubscribeRef.current = onSnapshot(q, (querySnapshot) => {
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

    const prevMonthDate = subMonths(new Date(year, month - 1, 15), 1);
    const prevYear = getYear(prevMonthDate);
    const prevMonth = getMonth(prevMonthDate) + 1;
    const prevMonthPadded = prevMonth.toString().padStart(2, '0');
    const prevScheduleCollectionPath = `escala/${prevYear}-${prevMonthPadded}/dias`;

    const prevQ = query(collection(db, prevScheduleCollectionPath));
    prevUnsubscribeRef.current = onSnapshot(prevQ, (querySnapshot) => {
      const prevScheduleData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailySchedule));
      setPreviousMonthSchedule(prevScheduleData);
    }, (error) => {
      console.error(`Error fetching schedule for ${prevYear}-${prevMonthPadded}: `, error);
      setPreviousMonthSchedule([]);
    });

  }, []);

  useEffect(() => {
    fetchSchedule(currentYear, currentMonth);
    
    // Cleanup on component unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      if (prevUnsubscribeRef.current) {
        prevUnsubscribeRef.current();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDailySchedule = useCallback(async (dayId: string, updates: Partial<DailySchedule>) => {
    const monthPadded = currentMonth.toString().padStart(2, '0');
    const scheduleDocPath = `escala/${currentYear}-${monthPadded}/dias/${dayId}`;
    const docRef = doc(db, scheduleDocPath);

    try {
        await setDoc(docRef, updates, { merge: true });
    } catch(error) {
        console.error("Error updating daily schedule:", error);
        throw error;
    }
  }, [currentYear, currentMonth]);

  const createFullMonthSchedule = useCallback(async (scheduleData: Record<string, any>, year: number, month: number) => {
    const monthPadded = month.toString().padStart(2, '0');
    const collectionPath = `escala/${year}-${monthPadded}/dias`;
    const batch = writeBatch(db);

    for (const dateId in scheduleData) {
        if (Object.prototype.hasOwnProperty.call(scheduleData, dateId)) {
            const daySchedule = scheduleData[dateId];
            const docRef = doc(db, collectionPath, dateId);
            batch.set(docRef, daySchedule);
        }
    }
    
    try {
      await batch.commit();
      console.log("Full month schedule successfully created.");
    } catch (error) {
      console.error("Error creating full month schedule:", error);
      throw error;
    }

  }, []);


  const value: MonthlyScheduleContextType = useMemo(() => ({
    schedule,
    previousMonthSchedule,
    loading,
    fetchSchedule,
    currentYear,
    currentMonth,
    updateDailySchedule,
    createFullMonthSchedule,
  }), [schedule, previousMonthSchedule, loading, fetchSchedule, currentYear, currentMonth, updateDailySchedule, createFullMonthSchedule]);

  return <MonthlyScheduleContext.Provider value={value}>{children}</MonthlyScheduleContext.Provider>;
}
