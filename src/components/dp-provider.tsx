"use client";

import { useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import type {
  DPUnit, DPUnitGroup, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar,
} from '@/types';
import { useDPStore } from '@/store/use-dp-store';

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

export function DPProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let unsubs: Array<() => void> = [];

    const cleanupSubscriptions = () => {
      unsubs.forEach(u => u());
      unsubs = [];
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      cleanupSubscriptions();
      const store = useDPStore.getState();

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
        store.setBootstrapError(null);
        return;
      }

      store.setUnitsLoading(true);
      store.setShiftDefsLoading(true);
      store.setSchedulesLoading(true);
      store.setVacationsLoading(true);
      store.setCalendarsLoading(true);
      store.setBootstrapError(null);

      const unitsQuery = query(collection(db, 'dp_units'), orderBy('name'));
      const unitGroupsQuery = query(collection(db, 'dp_unitGroups'), orderBy('name'));
      const shiftsQuery = query(collection(db, 'dp_shiftDefinitions'), orderBy('name'));
      const schedulesQuery = query(collection(db, 'dp_schedules'), orderBy('createdAt', 'desc'));
      const vacationsQuery = query(collection(db, 'dp_vacations'), orderBy('createdAt', 'desc'));
      const calendarsQuery = query(collection(db, 'dp_calendars'), orderBy('createdAt', 'desc'));

      unsubs.push(onSnapshot(
        unitsQuery,
        (snap) => {
          store.setUnits(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit)));
          store.setUnitsLoading(false);
        },
        (error) => {
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar unidades do DP.');
          logSubscriptionError('dp_units', error, () => store.setUnitsLoading(false));
        }
      ));

      unsubs.push(onSnapshot(
        unitGroupsQuery,
        (snap) => {
          store.setUnitGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnitGroup)));
        },
        (error) => {
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar grupos do DP.');
          logSubscriptionError('dp_unitGroups', error);
        }
      ));

      unsubs.push(onSnapshot(
        shiftsQuery,
        (snap) => {
          store.setShiftDefinitions(snap.docs.map(d => {
            const data = d.data();
            return { id: d.id, ...data, daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek) } as DPShiftDefinition;
          }));
          store.setShiftDefsLoading(false);
        },
        (error) => {
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar turnos do DP.');
          logSubscriptionError('dp_shiftDefinitions', error, () => store.setShiftDefsLoading(false));
        }
      ));

      unsubs.push(onSnapshot(
        schedulesQuery,
        (snap) => {
          const list = snap.docs.map(normalizeSchedule);
          list.sort((a, b) => b.year - a.year || b.month - a.month);
          store.setSchedules(list);
          store.setSchedulesLoading(false);
        },
        (error) => {
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar escalas do DP.');
          logSubscriptionError('dp_schedules', error, () => store.setSchedulesLoading(false));
        }
      ));

      unsubs.push(onSnapshot(
        vacationsQuery,
        (snap) => {
          store.setVacations(snap.docs.map(normalizeVacation));
          store.setVacationsLoading(false);
        },
        (error) => {
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar férias do DP.');
          logSubscriptionError('dp_vacations', error, () => store.setVacationsLoading(false));
        }
      ));

      unsubs.push(onSnapshot(
        calendarsQuery,
        (snap) => {
          store.setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPCalendar)));
          store.setCalendarsLoading(false);
        },
        (error) => {
          store.setBootstrapError(error instanceof Error ? error.message : 'Falha ao carregar calendários do DP.');
          logSubscriptionError('dp_calendars', error, () => store.setCalendarsLoading(false));
        }
      ));
    });

    return () => {
      cleanupSubscriptions();
      unsubAuth();
    };
  }, []);

  return <>{children}</>;
}
