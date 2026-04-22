"use client";

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type Query,
  type QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore';
import type {
  DPUnit,
  DPUnitGroup,
  DPShiftDefinition,
  DPSchedule,
  DPVacationRecord,
  DPCalendar,
} from '@/types';
import { useDPStore, type DPResourceKey, type DPResourceSource } from '@/store/use-dp-store';
import { useAuth } from '@/hooks/use-auth';

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
    .map((day) => {
      if (typeof day === 'number') return day;
      if (typeof day === 'string') return DOW_STRING_MAP[day.toLowerCase()] ?? -1;
      return -1;
    })
    .filter((day) => day >= 0 && day <= 6)
    .sort();
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

type DPScope = 'inactive' | 'dashboard' | 'settings' | 'schedules' | 'vacations' | 'collaborators';

const SCOPE_RESOURCES: Record<DPScope, DPResourceKey[]> = {
  inactive: [],
  dashboard: ['units', 'shiftDefs', 'schedules', 'vacations'],
  settings: ['units', 'shiftDefs', 'calendars'],
  schedules: ['units', 'shiftDefs', 'schedules', 'calendars'],
  vacations: ['units', 'vacations'],
  collaborators: ['shiftDefs'],
};

function getDPScope(pathname: string | null): DPScope {
  if (!pathname) return 'inactive';
  if (pathname.startsWith('/dashboard/settings')) return 'settings';
  if (pathname.startsWith('/dashboard/dp/settings')) return 'settings';
  if (pathname.startsWith('/dashboard/dp/schedules')) return 'schedules';
  if (pathname.startsWith('/dashboard/dp/ferias')) return 'vacations';
  if (pathname.startsWith('/dashboard/dp/collaborators')) return 'collaborators';
  if (pathname === '/dashboard/dp') return 'dashboard';
  return pathname.startsWith('/dashboard/dp') ? 'dashboard' : 'inactive';
}

function logSubscriptionError(scope: string, error: unknown) {
  console.error(`[DPProvider] Failed to subscribe to ${scope}.`, error);
}

function normalizeResourceError(scope: string, error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message) {
    return `${fallbackMessage} ${error.message}`;
  }
  return fallbackMessage;
}

export function DPProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { firebaseUser, loading: authLoading } = useAuth();
  const scope = useMemo(() => getDPScope(pathname), [pathname]);
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const store = useDPStore.getState();
    const requiredResources = new Set<DPResourceKey>(SCOPE_RESOURCES[scope]);
    const subscriptions: Array<() => void> = [];
    const timeouts: number[] = [];

    const cleanup = () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };

    const deactivateResource = (resource: DPResourceKey) => {
      switch (resource) {
        case 'units':
          store.setUnitsLoading(false);
          store.setUnitsError(null);
          break;
        case 'shiftDefs':
          store.setShiftDefsLoading(false);
          store.setShiftDefsError(null);
          break;
        case 'schedules':
          store.setSchedulesLoading(false);
          store.setSchedulesError(null);
          break;
        case 'vacations':
          store.setVacationsLoading(false);
          store.setVacationsError(null);
          break;
        case 'calendars':
          store.setCalendarsLoading(false);
          store.setCalendarsError(null);
          break;
      }
    };

    if (scope === 'inactive') {
      (['units', 'shiftDefs', 'schedules', 'vacations', 'calendars'] as DPResourceKey[]).forEach(deactivateResource);
      return () => {
        cleanup();
      };
    }

    if (authLoading) {
      return () => {
        cleanup();
      };
    }

    if (!firebaseUser) {
      previousUserIdRef.current = null;
      store.resetStore();
      (['units', 'shiftDefs', 'schedules', 'vacations', 'calendars'] as DPResourceKey[]).forEach(deactivateResource);
      store.setUnits([]);
      store.setUnitGroups([]);
      store.setShiftDefinitions([]);
      store.setSchedules([]);
      store.setVacations([]);
      store.setCalendars([]);
      return () => {
        cleanup();
      };
    }

    if (previousUserIdRef.current && previousUserIdRef.current !== firebaseUser.uid) {
      store.resetStore();
    }
    previousUserIdRef.current = firebaseUser.uid;

    const currentState = useDPStore.getState();

    const prepareResource = (resource: DPResourceKey, loading: boolean) => {
      switch (resource) {
        case 'units':
          store.setUnitsError(null);
          store.setUnitsLoading(loading);
          break;
        case 'shiftDefs':
          store.setShiftDefsError(null);
          store.setShiftDefsLoading(loading);
          break;
        case 'schedules':
          store.setSchedulesError(null);
          store.setSchedulesLoading(loading);
          break;
        case 'vacations':
          store.setVacationsError(null);
          store.setVacationsLoading(loading);
          break;
        case 'calendars':
          store.setCalendarsError(null);
          store.setCalendarsLoading(loading);
          break;
      }
    };

    prepareResource('units', requiredResources.has('units') && currentState.units.length === 0 && currentState.unitGroups.length === 0);
    prepareResource('shiftDefs', requiredResources.has('shiftDefs') && currentState.shiftDefinitions.length === 0);
    prepareResource('schedules', requiredResources.has('schedules') && currentState.schedules.length === 0);
    prepareResource('vacations', requiredResources.has('vacations') && currentState.vacations.length === 0);
    prepareResource('calendars', requiredResources.has('calendars') && currentState.calendars.length === 0);

    (['units', 'shiftDefs', 'schedules', 'vacations', 'calendars'] as DPResourceKey[])
      .filter((resource) => !requiredResources.has(resource))
      .forEach(deactivateResource);

    const markResolved = (resource: DPResourceKey, source: DPResourceSource) => {
      store.markResourceResolved(resource, source);
      switch (resource) {
        case 'units':
          store.setUnitsLoading(false);
          store.setUnitsError(null);
          break;
        case 'shiftDefs':
          store.setShiftDefsLoading(false);
          store.setShiftDefsError(null);
          break;
        case 'schedules':
          store.setSchedulesLoading(false);
          store.setSchedulesError(null);
          break;
        case 'vacations':
          store.setVacationsLoading(false);
          store.setVacationsError(null);
          break;
        case 'calendars':
          store.setCalendarsLoading(false);
          store.setCalendarsError(null);
          break;
      }
    };

    const markFailed = (resource: DPResourceKey, message: string) => {
      store.setResourceError(resource, message);
      store.markResourceResolved(resource, 'error');
      switch (resource) {
        case 'units':
          store.setUnitsLoading(false);
          break;
        case 'shiftDefs':
          store.setShiftDefsLoading(false);
          break;
        case 'schedules':
          store.setSchedulesLoading(false);
          break;
        case 'vacations':
          store.setVacationsLoading(false);
          break;
        case 'calendars':
          store.setCalendarsLoading(false);
          break;
      }
    };

    const registerResource = <T extends DocumentData>({
      resource,
      queryRef,
      applySnapshot,
      errorMessage,
      timeoutMs = 4000,
    }: {
      resource: DPResourceKey;
      queryRef: Query<T>;
      applySnapshot: (snapshot: QuerySnapshot<T>) => void;
      errorMessage: string;
      timeoutMs?: number;
    }) => {
      if (!requiredResources.has(resource)) return;

      let resolved = false;
      const fallbackTimeoutId = window.setTimeout(async () => {
        if (resolved) return;
        try {
          const snapshot = await getDocs(queryRef);
          resolved = true;
          applySnapshot(snapshot);
          markResolved(resource, 'fallback');
        } catch (error) {
          const message = normalizeResourceError(resource, error, errorMessage);
          console.error(`[DPProvider] Fallback fetch failed for ${resource}.`, error);
          markFailed(resource, message);
        }
      }, timeoutMs);

      timeouts.push(fallbackTimeoutId);

      const unsubscribe = onSnapshot(
        queryRef,
        (snapshot) => {
          resolved = true;
          window.clearTimeout(fallbackTimeoutId);
          applySnapshot(snapshot);
          markResolved(resource, 'snapshot');
        },
        (error) => {
          window.clearTimeout(fallbackTimeoutId);
          const message = normalizeResourceError(resource, error, errorMessage);
          logSubscriptionError(resource, error);
          markFailed(resource, message);
        }
      );

      subscriptions.push(unsubscribe);
    };

    if (requiredResources.has('units')) {
      const unitsQuery = query(collection(db, 'dp_units'), orderBy('name'));
      const unitGroupsQuery = query(collection(db, 'dp_unitGroups'), orderBy('name'));

      registerResource({
        resource: 'units',
        queryRef: unitsQuery,
        applySnapshot: (snapshot) => {
          store.setUnits(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DPUnit)));
        },
        errorMessage: 'Falha ao carregar unidades do DP.',
      });

      const unsubscribeGroups = onSnapshot(
        unitGroupsQuery,
        (snapshot) => {
          store.setUnitGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DPUnitGroup)));
        },
        (error) => {
          console.error('[DPProvider] Failed to subscribe to dp_unitGroups.', error);
        }
      );

      subscriptions.push(unsubscribeGroups);

      const groupsFallbackTimeoutId = window.setTimeout(async () => {
        try {
          const snapshot = await getDocs(unitGroupsQuery);
          store.setUnitGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DPUnitGroup)));
        } catch (error) {
          console.error('[DPProvider] Fallback fetch failed for dp_unitGroups.', error);
        }
      }, 4000);

      timeouts.push(groupsFallbackTimeoutId);
    }

    registerResource({
      resource: 'shiftDefs',
      queryRef: query(collection(db, 'dp_shiftDefinitions'), orderBy('name')),
      applySnapshot: (snapshot) => {
        store.setShiftDefinitions(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek),
            } as DPShiftDefinition;
          })
        );
      },
      errorMessage: 'Falha ao carregar turnos do DP.',
    });

    registerResource({
      resource: 'schedules',
      queryRef: query(collection(db, 'dp_schedules'), orderBy('createdAt', 'desc')),
      applySnapshot: (snapshot) => {
        const schedules = snapshot.docs.map(normalizeSchedule);
        schedules.sort((a, b) => b.year - a.year || b.month - a.month);
        store.setSchedules(schedules);
      },
      errorMessage: 'Falha ao carregar escalas do DP.',
    });

    registerResource({
      resource: 'vacations',
      queryRef: query(collection(db, 'dp_vacations'), orderBy('createdAt', 'desc')),
      applySnapshot: (snapshot) => {
        store.setVacations(snapshot.docs.map(normalizeVacation));
      },
      errorMessage: 'Falha ao carregar férias do DP.',
    });

    registerResource({
      resource: 'calendars',
      queryRef: query(collection(db, 'dp_calendars'), orderBy('createdAt', 'desc')),
      applySnapshot: (snapshot) => {
        store.setCalendars(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DPCalendar)));
      },
      errorMessage: 'Falha ao carregar calendários do DP.',
    });

    return () => {
      cleanup();
    };
  }, [authLoading, firebaseUser?.uid, scope]);

  return <>{children}</>;
}
