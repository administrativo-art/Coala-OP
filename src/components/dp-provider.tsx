"use client";

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, getDocs, onSnapshot, query, orderBy,
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

function normalizeSchedule(doc: { id: string; data: () => Record<string, unknown> }): DPSchedule {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    month: Number(data.month),
    year: Number(data.year),
    shiftCount: Number(data.shiftCount ?? 0),
  } as DPSchedule;
}

function normalizeVacation(doc: { id: string; data: () => Record<string, unknown> }): DPVacationRecord {
  return { id: doc.id, ...doc.data() } as DPVacationRecord;
}

function normalizeScheduleRecord(data: any): DPSchedule {
  return {
    ...data,
    month: Number(data.month),
    year: Number(data.year),
    shiftCount: Number(data.shiftCount ?? 0),
  } as DPSchedule;
}

async function fetchDPBootstrap(user: NonNullable<typeof auth.currentUser>) {
  const token = await user.getIdToken();
  const res = await fetch('/api/dp/bootstrap', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error ? ` - ${data.error}` : '';
    } catch {}
    throw new Error(`DP bootstrap failed: ${res.status}${detail}`);
  }

  return res.json();
}

// ─── Lifecycle Manager (Refactored DPProvider) ───────────────────────────────

export function DPProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDPRoute = pathname?.startsWith('/dashboard/dp') || pathname === '/dashboard/settings/units';

  useEffect(() => {
    const store = useDPStore.getState();

    if (!isDPRoute) {
      store.resetStore();
      store.setUnitsLoading(false);
      store.setShiftDefsLoading(false);
      store.setSchedulesLoading(false);
      store.setVacationsLoading(false);
      store.setCalendarsLoading(false);
      return;
    }

    let unsubUnits: (() => void) | undefined;
    let unsubGroups: (() => void) | undefined;
    let unsubShifts: (() => void) | undefined;
    let unsubSchedules: (() => void) | undefined;
    let unsubVacations: (() => void) | undefined;
    let unsubCalendars: (() => void) | undefined;
    let schedulesFallbackTimeout: number | undefined;
    let vacationsFallbackTimeout: number | undefined;

    const cleanupSubscriptions = () => {
      unsubUnits?.();
      unsubGroups?.();
      unsubShifts?.();
      unsubSchedules?.();
      unsubVacations?.();
      unsubCalendars?.();
      unsubUnits = undefined;
      unsubGroups = undefined;
      unsubShifts = undefined;
      unsubSchedules = undefined;
      unsubVacations = undefined;
      unsubCalendars = undefined;
      if (schedulesFallbackTimeout !== undefined) window.clearTimeout(schedulesFallbackTimeout);
      if (vacationsFallbackTimeout !== undefined) window.clearTimeout(vacationsFallbackTimeout);
      schedulesFallbackTimeout = undefined;
      vacationsFallbackTimeout = undefined;
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      const store = useDPStore.getState();
      cleanupSubscriptions();

      if (!user) {
        store.setUnits([]);
        store.setUnitGroups([]);
        store.setShiftDefinitions([]);
        store.setSchedules([]);
        store.setVacations([]);
        store.setCalendars([]);
        store.setUnitsLoading(false);
        store.setShiftDefsLoading(false);
        store.setSchedulesLoading(false);
        store.setVacationsLoading(false);
        store.setCalendarsLoading(false);
        return;
      }

      store.setUnitsLoading(true);
      store.setShiftDefsLoading(true);
      store.setSchedulesLoading(true);
      store.setVacationsLoading(true);
      store.setCalendarsLoading(true);
      store.setBootstrapError(null);

      fetchDPBootstrap(user).then((payload) => {
        store.setUnits((payload.units ?? []) as DPUnit[]);
        store.setUnitGroups((payload.unitGroups ?? []) as DPUnitGroup[]);
        store.setShiftDefinitions((payload.shiftDefinitions ?? []).map((item: any) => ({
          ...item,
          daysOfWeek: normalizeDaysOfWeek(item.daysOfWeek),
        })) as DPShiftDefinition[]);
        store.setSchedules((payload.schedules ?? []).map(normalizeScheduleRecord).sort((a: DPSchedule, b: DPSchedule) => b.year - a.year || b.month - a.month));
        store.setVacations((payload.vacations ?? []) as DPVacationRecord[]);
        store.setCalendars((payload.calendars ?? []) as DPCalendar[]);
        store.setUnitsLoading(false);
        store.setShiftDefsLoading(false);
        store.setSchedulesLoading(false);
        store.setVacationsLoading(false);
        store.setCalendarsLoading(false);
      }).catch((error) => {
        console.error('[DPProvider] Bootstrap fetch failed.', error);
        store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar bootstrap do DP.');
      });

      let schedulesResolved = false;
      let vacationsResolved = false;
      const schedulesQuery = query(collection(db, 'dp_schedules'), orderBy('createdAt', 'desc'));
      const vacationsQuery = query(collection(db, 'dp_vacations'), orderBy('createdAt', 'desc'));
      schedulesFallbackTimeout = window.setTimeout(async () => {
        if (schedulesResolved) return;

        try {
          const snap = await getDocs(schedulesQuery);
          const list = snap.docs.map(normalizeSchedule);
          list.sort((a, b) => b.year - a.year || b.month - a.month);
          store.setSchedules(list);
        } catch (error) {
          console.error('[DPProvider] Fallback fetch for dp_schedules failed.', error);
        } finally {
          schedulesResolved = true;
          store.setSchedulesLoading(false);
        }
      }, 4000);
      vacationsFallbackTimeout = window.setTimeout(async () => {
        if (vacationsResolved) return;

        try {
          const snap = await getDocs(vacationsQuery);
          store.setVacations(snap.docs.map(normalizeVacation));
        } catch (error) {
          console.error('[DPProvider] Fallback fetch for dp_vacations failed.', error);
        } finally {
          vacationsResolved = true;
          store.setVacationsLoading(false);
        }
      }, 4000);

      unsubUnits = onSnapshot(
        query(collection(db, 'dp_units'), orderBy('name')),
        (snap) => { 
          store.setUnits(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit))); 
          store.setUnitsLoading(false); 
        },
        (error) => logSubscriptionError('dp_units', error, () => store.setUnitsLoading(false))
      );

      unsubGroups = onSnapshot(
        query(collection(db, 'dp_unitGroups'), orderBy('name')),
        (snap) => { 
          store.setUnitGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnitGroup))); 
        },
        (error) => logSubscriptionError('dp_unitGroups', error)
      );

      unsubShifts = onSnapshot(
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

      unsubSchedules = onSnapshot(
        schedulesQuery,
        (snap) => {
          schedulesResolved = true;
          if (schedulesFallbackTimeout !== undefined) window.clearTimeout(schedulesFallbackTimeout);
          const list = snap.docs.map(normalizeSchedule);
          list.sort((a, b) => b.year - a.year || b.month - a.month);
          store.setSchedules(list);
          store.setSchedulesLoading(false);
        },
        (error) => {
          schedulesResolved = true;
          if (schedulesFallbackTimeout !== undefined) window.clearTimeout(schedulesFallbackTimeout);
          logSubscriptionError('dp_schedules', error, () => store.setSchedulesLoading(false));
        }
      );

      unsubVacations = onSnapshot(
        vacationsQuery,
        (snap) => { 
          vacationsResolved = true;
          if (vacationsFallbackTimeout !== undefined) window.clearTimeout(vacationsFallbackTimeout);
          store.setVacations(snap.docs.map(normalizeVacation)); 
          store.setVacationsLoading(false); 
        },
        (error) => {
          vacationsResolved = true;
          if (vacationsFallbackTimeout !== undefined) window.clearTimeout(vacationsFallbackTimeout);
          logSubscriptionError('dp_vacations', error, () => store.setVacationsLoading(false));
        }
      );

      unsubCalendars = onSnapshot(
        query(collection(db, 'dp_calendars'), orderBy('createdAt', 'desc')),
        (snap) => { 
          store.setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPCalendar))); 
          store.setCalendarsLoading(false); 
        },
        (error) => logSubscriptionError('dp_calendars', error, () => store.setCalendarsLoading(false))
      );
    });

    return () => {
      cleanupSubscriptions();
      unsubAuth();
    };
  }, [isDPRoute]);

  return <>{children}</>;
}
