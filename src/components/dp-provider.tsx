"use client";

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection, getDocs, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import type {
  DPUnit, DPUnitGroup, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar,
} from '@/types';
import { useDPStore } from '@/store/use-dp-store';
import { useAuth } from '@/hooks/use-auth';

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

// ─── Lifecycle Manager (Refactored DPProvider) ───────────────────────────────

export function DPProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { firebaseUser, loading: authLoading } = useAuth();
  const isDPRoute =
    pathname?.startsWith('/dashboard/dp') ||
    pathname?.startsWith('/dashboard/settings');
  const isSettingsLikeRoute =
    pathname?.startsWith('/dashboard/settings') ||
    pathname?.startsWith('/dashboard/dp/settings') ||
    pathname === '/dashboard/dp/collaborators';

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
    let unitsFallbackTimeout: number | undefined;
    let shiftsFallbackTimeout: number | undefined;
    let calendarsFallbackTimeout: number | undefined;
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
      if (unitsFallbackTimeout !== undefined) window.clearTimeout(unitsFallbackTimeout);
      if (shiftsFallbackTimeout !== undefined) window.clearTimeout(shiftsFallbackTimeout);
      if (calendarsFallbackTimeout !== undefined) window.clearTimeout(calendarsFallbackTimeout);
      if (schedulesFallbackTimeout !== undefined) window.clearTimeout(schedulesFallbackTimeout);
      if (vacationsFallbackTimeout !== undefined) window.clearTimeout(vacationsFallbackTimeout);
      unitsFallbackTimeout = undefined;
      shiftsFallbackTimeout = undefined;
      calendarsFallbackTimeout = undefined;
      schedulesFallbackTimeout = undefined;
      vacationsFallbackTimeout = undefined;
    };

    cleanupSubscriptions();

    // Only wait for auth when firebaseUser hasn't resolved yet.
    // Ignoring the compound authLoading (which includes profilesLoading and !permissionsReady)
    // prevents oscillation from cancelling Firestore subscriptions while the user is already authed.
    if (!firebaseUser && authLoading) {
      return () => {
        cleanupSubscriptions();
      };
    }

    if (!firebaseUser) {
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
      return () => {
        cleanupSubscriptions();
      };
    }

    store.setUnitsLoading(true);
    store.setShiftDefsLoading(true);
    store.setSchedulesLoading(!isSettingsLikeRoute);
    store.setVacationsLoading(!isSettingsLikeRoute);
    store.setCalendarsLoading(true);
    store.setBootstrapError(null);

    if (isSettingsLikeRoute) {
      store.setSchedules([]);
      store.setVacations([]);
      store.setSchedulesLoading(false);
      store.setVacationsLoading(false);
    }

    let schedulesResolved = false;
    let vacationsResolved = false;
    let unitsResolved = false;
    let shiftsResolved = false;
    let calendarsResolved = false;
    const unitsQuery = query(collection(db, 'dp_units'), orderBy('name'));
    const unitGroupsQuery = query(collection(db, 'dp_unitGroups'), orderBy('name'));
    const shiftsQuery = query(collection(db, 'dp_shiftDefinitions'), orderBy('name'));
    const schedulesQuery = query(collection(db, 'dp_schedules'), orderBy('createdAt', 'desc'));
    const vacationsQuery = query(collection(db, 'dp_vacations'), orderBy('createdAt', 'desc'));
    const calendarsQuery = query(collection(db, 'dp_calendars'), orderBy('createdAt', 'desc'));

    unitsFallbackTimeout = window.setTimeout(async () => {
      if (unitsResolved) return;

      try {
        const [unitsSnap, groupsSnap] = await Promise.all([
          getDocs(unitsQuery),
          getDocs(unitGroupsQuery),
        ]);
        store.setUnits(unitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit)));
        store.setUnitGroups(groupsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnitGroup)));
      } catch (error) {
        console.error('[DPProvider] Fallback fetch for dp_units/dp_unitGroups failed.', error);
      } finally {
        unitsResolved = true;
        store.setUnitsLoading(false);
      }
    }, 4000);

    shiftsFallbackTimeout = window.setTimeout(async () => {
      if (shiftsResolved) return;

      try {
        const snap = await getDocs(shiftsQuery);
        store.setShiftDefinitions(
          snap.docs.map(d => {
            const data = d.data();
            return { id: d.id, ...data, daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek) } as DPShiftDefinition;
          })
        );
      } catch (error) {
        console.error('[DPProvider] Fallback fetch for dp_shiftDefinitions failed.', error);
      } finally {
        shiftsResolved = true;
        store.setShiftDefsLoading(false);
      }
    }, 4000);

    calendarsFallbackTimeout = window.setTimeout(async () => {
      if (calendarsResolved) return;

      try {
        const snap = await getDocs(calendarsQuery);
        store.setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPCalendar)));
      } catch (error) {
        console.error('[DPProvider] Fallback fetch for dp_calendars failed.', error);
      } finally {
        calendarsResolved = true;
        store.setCalendarsLoading(false);
      }
    }, 4000);

    if (!isSettingsLikeRoute) {
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
    }

    unsubUnits = onSnapshot(
      unitsQuery,
      (snap) => { 
        unitsResolved = true;
        if (unitsFallbackTimeout !== undefined) window.clearTimeout(unitsFallbackTimeout);
        store.setUnits(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit))); 
        store.setUnitsLoading(false); 
      },
      (error) => {
        unitsResolved = true;
        if (unitsFallbackTimeout !== undefined) window.clearTimeout(unitsFallbackTimeout);
        store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar unidades do DP.');
        logSubscriptionError('dp_units', error, () => store.setUnitsLoading(false));
      }
    );

    unsubGroups = onSnapshot(
      unitGroupsQuery,
      (snap) => { 
        store.setUnitGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnitGroup))); 
      },
      (error) => {
        store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar grupos do DP.');
        logSubscriptionError('dp_unitGroups', error);
      }
    );

    unsubShifts = onSnapshot(
      shiftsQuery,
      (snap) => {
        shiftsResolved = true;
        if (shiftsFallbackTimeout !== undefined) window.clearTimeout(shiftsFallbackTimeout);
        store.setShiftDefinitions(snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek) } as DPShiftDefinition;
        }));
        store.setShiftDefsLoading(false);
      },
      (error) => {
        shiftsResolved = true;
        if (shiftsFallbackTimeout !== undefined) window.clearTimeout(shiftsFallbackTimeout);
        store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar turnos do DP.');
        logSubscriptionError('dp_shiftDefinitions', error, () => store.setShiftDefsLoading(false));
      }
    );

    if (!isSettingsLikeRoute) {
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
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar escalas do DP.');
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
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar férias do DP.');
          logSubscriptionError('dp_vacations', error, () => store.setVacationsLoading(false));
        }
      );
    }

    unsubCalendars = onSnapshot(
      calendarsQuery,
      (snap) => { 
        calendarsResolved = true;
        if (calendarsFallbackTimeout !== undefined) window.clearTimeout(calendarsFallbackTimeout);
        store.setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPCalendar))); 
        store.setCalendarsLoading(false); 
      },
      (error) => {
        calendarsResolved = true;
        if (calendarsFallbackTimeout !== undefined) window.clearTimeout(calendarsFallbackTimeout);
        store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar calendários do DP.');
        logSubscriptionError('dp_calendars', error, () => store.setCalendarsLoading(false));
      }
    );

    return () => {
      cleanupSubscriptions();
    };
  // authLoading intentionally excluded: when firebaseUser is set, subscriptions must not be
  // cancelled by permission-computation oscillations in the compound loading state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, isDPRoute, isSettingsLikeRoute]);

  return <>{children}</>;
}
