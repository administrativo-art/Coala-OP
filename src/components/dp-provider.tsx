"use client";

import React, { useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import type {
  DPUnit, DPUnitGroup, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar,
} from '@/types';
import { useDPStore } from '@/store/use-dp-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOW_STRING_MAP: Record<string, number> = {
  sunday: 0, dom: 0,
  monday: 1, seg: 1,
  tuesday: 2, ter: 2,
  wednesday: 3, qua: 3,
  thursday: 4, qui: 4,
  friday: 5, sex: 5,
  saturday: 6, sáb: 6, sab: 6,
};

function normalizeDaysOfWeek(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(d => {
      if (typeof d === 'number') return d;
      if (typeof d === 'string') return DOW_STRING_MAP[d.toLowerCase()] ?? -1;
      return -1;
    })
    .filter(d => d >= 0 && d <= 6)
    .sort();
}

function logSubscriptionError(scope: string, error: unknown, stopLoading?: () => void) {
  console.error(`[DPProvider] Failed to subscribe to ${scope}.`, error);
  stopLoading?.();
}

// ─── Lifecycle Manager (Refactored DPProvider) ───────────────────────────────

export function DPProvider({ children }: { children: React.ReactNode }) {
  const store = useDPStore();

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        store.resetStore();
        return;
      }

      const unsubUnits = onSnapshot(
        query(collection(db, 'dp_units'), orderBy('name')),
        (snap) => { 
          store.setUnits(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit))); 
          store.setUnitsLoading(false); 
        },
        (error) => logSubscriptionError('dp_units', error, () => store.setUnitsLoading(false))
      );

      const unsubGroups = onSnapshot(
        query(collection(db, 'dp_unitGroups'), orderBy('name')),
        (snap) => { 
          store.setUnitGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnitGroup))); 
        },
        (error) => logSubscriptionError('dp_unitGroups', error)
      );

      const unsubShifts = onSnapshot(
        query(collection(db, 'dp_shiftDefinitions'), orderBy('name')),
        (snap) => {
          store.setShiftDefinitions(snap.docs.map(d => {
            const data = d.data();
            return { id: d.id, ...data, daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek) } as DPShiftDefinition;
          }));
          store.setShiftDefsLoading(false);
        },
        (error) => logSubscriptionError('dp_shiftDefinitions', error, () => store.setShiftDefsLoading(false))
      );

      const unsubSchedules = onSnapshot(
        query(collection(db, 'dp_schedules'), orderBy('createdAt', 'desc')),
        (snap) => {
          const list = snap.docs.map(d => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              month: Number(data.month),
              year: Number(data.year),
              shiftCount: Number(data.shiftCount ?? 0),
            } as DPSchedule;
          });
          list.sort((a, b) => b.year - a.year || b.month - a.month);
          store.setSchedules(list);
          store.setSchedulesLoading(false);
        },
        (error) => logSubscriptionError('dp_schedules', error, () => store.setSchedulesLoading(false))
      );

      const unsubVacations = onSnapshot(
        query(collection(db, 'dp_vacations'), orderBy('createdAt', 'desc')),
        (snap) => { 
          store.setVacations(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPVacationRecord))); 
          store.setVacationsLoading(false); 
        },
        (error) => logSubscriptionError('dp_vacations', error, () => store.setVacationsLoading(false))
      );

      const unsubCalendars = onSnapshot(
        query(collection(db, 'dp_calendars'), orderBy('createdAt', 'desc')),
        (snap) => { 
          store.setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPCalendar))); 
          store.setCalendarsLoading(false); 
        },
        (error) => logSubscriptionError('dp_calendars', error, () => store.setCalendarsLoading(false))
      );

      return () => {
        unsubUnits();
        unsubGroups();
        unsubShifts();
        unsubSchedules();
        unsubVacations();
        unsubCalendars();
      };
    });

    return () => unsubAuth();
  }, [store]);

  return <>{children}</>;
}
