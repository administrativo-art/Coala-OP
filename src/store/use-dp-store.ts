import { create } from 'zustand';
import { db } from '@/lib/firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, writeBatch, increment, getDocs, deleteField
} from 'firebase/firestore';
import type {
  DPUnit, DPUnitGroup, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar, DPHoliday,
} from '@/types';

export type DPResourceKey = 'units' | 'shiftDefs' | 'schedules' | 'vacations' | 'calendars';
export type DPResourceSource = 'idle' | 'snapshot' | 'fallback' | 'error';

export type DPResourceMeta = Record<
  DPResourceKey,
  {
    source: DPResourceSource;
    lastResolvedAt: number | null;
  }
>;

export interface DPStoreState {
  // Dados
  units: DPUnit[];
  unitGroups: DPUnitGroup[];
  unitsLoading: boolean;
  unitsError: string | null;
  shiftDefinitions: DPShiftDefinition[];
  shiftDefsLoading: boolean;
  shiftDefsError: string | null;
  schedules: DPSchedule[];
  schedulesLoading: boolean;
  schedulesError: string | null;
  vacations: DPVacationRecord[];
  vacationsLoading: boolean;
  vacationsError: string | null;
  calendars: DPCalendar[];
  calendarsLoading: boolean;
  calendarsError: string | null;
  bootstrapError: string | null;
  resourceMeta: DPResourceMeta;

  // Actions (Setters para uso interno dos listeners)
  setUnits: (units: DPUnit[]) => void;
  setUnitGroups: (groups: DPUnitGroup[]) => void;
  setUnitsLoading: (loading: boolean) => void;
  setUnitsError: (error: string | null) => void;
  setShiftDefinitions: (defs: DPShiftDefinition[]) => void;
  setShiftDefsLoading: (loading: boolean) => void;
  setShiftDefsError: (error: string | null) => void;
  setSchedules: (schedules: DPSchedule[]) => void;
  setSchedulesLoading: (loading: boolean) => void;
  setSchedulesError: (error: string | null) => void;
  setVacations: (vacations: DPVacationRecord[]) => void;
  setVacationsLoading: (loading: boolean) => void;
  setVacationsError: (error: string | null) => void;
  setCalendars: (calendars: DPCalendar[]) => void;
  setCalendarsLoading: (loading: boolean) => void;
  setCalendarsError: (error: string | null) => void;
  setBootstrapError: (error: string | null) => void;
  setResourceError: (resource: DPResourceKey, error: string | null) => void;
  markResourceResolved: (resource: DPResourceKey, source: DPResourceSource) => void;
  resetResourceMeta: () => void;

  // CRUD Actions (Acessíveis pelos componentes)
  addUnit: (data: Omit<DPUnit, 'id' | 'createdAt'>) => Promise<void>;
  updateUnit: (unit: DPUnit) => Promise<void>;
  deleteUnit: (unitId: string) => Promise<void>;
  addUnitGroup: (data: Omit<DPUnitGroup, 'id' | 'createdAt'>) => Promise<void>;
  updateUnitGroup: (group: DPUnitGroup) => Promise<void>;
  deleteUnitGroup: (groupId: string) => Promise<void>;
  addShiftDefinition: (data: Omit<DPShiftDefinition, 'id' | 'createdAt'>) => Promise<void>;
  updateShiftDefinition: (def: DPShiftDefinition) => Promise<void>;
  deleteShiftDefinition: (defId: string) => Promise<void>;
  addSchedule: (data: Omit<DPSchedule, 'id' | 'createdAt' | 'shiftCount'>) => Promise<string>;
  updateSchedule: (schedule: DPSchedule) => Promise<void>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
  addVacation: (data: Omit<DPVacationRecord, 'id' | 'createdAt'>) => Promise<void>;
  updateVacation: (vacation: DPVacationRecord) => Promise<void>;
  deleteVacation: (vacationId: string) => Promise<void>;
  addCalendar: (data: Omit<DPCalendar, 'id' | 'createdAt' | 'holidayCount'>) => Promise<string>;
  updateCalendar: (calendar: DPCalendar) => Promise<void>;
  deleteCalendar: (calendarId: string) => Promise<void>;
  addHoliday: (calendarId: string, data: Omit<DPHoliday, 'id' | 'createdAt'>) => Promise<void>;
  deleteHoliday: (calendarId: string, holidayId: string) => Promise<void>;

  resetStore: () => void;
}

const initialResourceMeta: DPResourceMeta = {
  units: { source: 'idle', lastResolvedAt: null },
  shiftDefs: { source: 'idle', lastResolvedAt: null },
  schedules: { source: 'idle', lastResolvedAt: null },
  vacations: { source: 'idle', lastResolvedAt: null },
  calendars: { source: 'idle', lastResolvedAt: null },
};

const initialState = {
  units: [],
  unitGroups: [],
  unitsLoading: true,
  unitsError: null,
  shiftDefinitions: [],
  shiftDefsLoading: true,
  shiftDefsError: null,
  schedules: [],
  schedulesLoading: true,
  schedulesError: null,
  vacations: [],
  vacationsLoading: true,
  vacationsError: null,
  calendars: [],
  calendarsLoading: true,
  calendarsError: null,
  bootstrapError: null,
  resourceMeta: initialResourceMeta,
};

function selectBootstrapError(state: Pick<
  DPStoreState,
  'unitsError' | 'shiftDefsError' | 'schedulesError' | 'vacationsError' | 'calendarsError'
>) {
  return (
    state.unitsError ??
    state.shiftDefsError ??
    state.schedulesError ??
    state.vacationsError ??
    state.calendarsError ??
    null
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function stripUndefinedForCreate(value: unknown): unknown {
  if (value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value
      .map(item => stripUndefinedForCreate(item))
      .filter(item => item !== undefined);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        const sanitized = stripUndefinedForCreate(entry);
        return sanitized === undefined ? [] : [[key, sanitized]];
      })
    );
  }

  return value;
}

function sanitizeFirestoreUpdate(value: unknown): unknown {
  if (value === undefined) {
    return deleteField();
  }

  if (Array.isArray(value)) {
    return value
      .map(item => stripUndefinedForCreate(item))
      .filter(item => item !== undefined);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeFirestoreUpdate(entry)])
    );
  }

  return value;
}

export const useDPStore = create<DPStoreState>((set) => ({
  ...initialState,

  // Setters
  setUnits: (units) => set({ units }),
  setUnitGroups: (unitGroups) => set({ unitGroups }),
  setUnitsLoading: (unitsLoading) => set({ unitsLoading }),
  setUnitsError: (unitsError) => set((state) => ({ unitsError, bootstrapError: selectBootstrapError({ ...state, unitsError }) })),
  setShiftDefinitions: (shiftDefinitions) => set({ shiftDefinitions }),
  setShiftDefsLoading: (shiftDefsLoading) => set({ shiftDefsLoading }),
  setShiftDefsError: (shiftDefsError) => set((state) => ({ shiftDefsError, bootstrapError: selectBootstrapError({ ...state, shiftDefsError }) })),
  setSchedules: (schedules) => set({ schedules }),
  setSchedulesLoading: (schedulesLoading) => set({ schedulesLoading }),
  setSchedulesError: (schedulesError) => set((state) => ({ schedulesError, bootstrapError: selectBootstrapError({ ...state, schedulesError }) })),
  setVacations: (vacations) => set({ vacations }),
  setVacationsLoading: (vacationsLoading) => set({ vacationsLoading }),
  setVacationsError: (vacationsError) => set((state) => ({ vacationsError, bootstrapError: selectBootstrapError({ ...state, vacationsError }) })),
  setCalendars: (calendars) => set({ calendars }),
  setCalendarsLoading: (calendarsLoading) => set({ calendarsLoading }),
  setCalendarsError: (calendarsError) => set((state) => ({ calendarsError, bootstrapError: selectBootstrapError({ ...state, calendarsError }) })),
  setBootstrapError: (bootstrapError) => set({ bootstrapError }),
  setResourceError: (resource, error) => set((state) => {
    const nextState = {
      unitsError: resource === 'units' ? error : state.unitsError,
      shiftDefsError: resource === 'shiftDefs' ? error : state.shiftDefsError,
      schedulesError: resource === 'schedules' ? error : state.schedulesError,
      vacationsError: resource === 'vacations' ? error : state.vacationsError,
      calendarsError: resource === 'calendars' ? error : state.calendarsError,
    };

    return {
      ...nextState,
      bootstrapError: selectBootstrapError(nextState),
      resourceMeta: {
        ...state.resourceMeta,
        [resource]: {
          source: error ? 'error' : state.resourceMeta[resource].source,
          lastResolvedAt: error ? Date.now() : state.resourceMeta[resource].lastResolvedAt,
        },
      },
    };
  }),
  markResourceResolved: (resource, source) => set((state) => ({
    resourceMeta: {
      ...state.resourceMeta,
      [resource]: {
        source,
        lastResolvedAt: Date.now(),
      },
    },
  })),
  resetResourceMeta: () => set({ resourceMeta: initialResourceMeta }),

  resetStore: () => set({
    ...initialState,
    resourceMeta: initialResourceMeta,
  }),

  // CRUD Implementation
  addUnit: async (data) => {
    await addDoc(collection(db, 'dp_units'), stripUndefinedForCreate({ ...data, createdAt: serverTimestamp() }) as Record<string, unknown>);
  },
  updateUnit: async ({ id, ...data }) => {
    await updateDoc(doc(db, 'dp_units', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteUnit: async (unitId) => {
    await deleteDoc(doc(db, 'dp_units', unitId));
  },
  addUnitGroup: async (data) => {
    await addDoc(collection(db, 'dp_unitGroups'), stripUndefinedForCreate({ ...data, unitCount: 0, createdAt: serverTimestamp() }) as Record<string, unknown>);
  },
  updateUnitGroup: async ({ id, ...data }) => {
    await updateDoc(doc(db, 'dp_unitGroups', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteUnitGroup: async (groupId) => {
    await deleteDoc(doc(db, 'dp_unitGroups', groupId));
  },
  addShiftDefinition: async (data) => {
    await addDoc(collection(db, 'dp_shiftDefinitions'), stripUndefinedForCreate({ ...data, createdAt: serverTimestamp() }) as Record<string, unknown>);
  },
  updateShiftDefinition: async ({ id, ...data }) => {
    await updateDoc(doc(db, 'dp_shiftDefinitions', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteShiftDefinition: async (defId) => {
    await deleteDoc(doc(db, 'dp_shiftDefinitions', defId));
  },
  addSchedule: async (data) => {
    const ref = await addDoc(collection(db, 'dp_schedules'), stripUndefinedForCreate({ ...data, shiftCount: 0, createdAt: serverTimestamp() }) as Record<string, unknown>);
    return ref.id;
  },
  updateSchedule: async ({ id, ...data }) => {
    await updateDoc(doc(db, 'dp_schedules', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteSchedule: async (scheduleId) => {
    const shiftsSnap = await getDocs(collection(db, 'dp_schedules', scheduleId, 'shifts'));
    const batch = writeBatch(db);
    shiftsSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'dp_schedules', scheduleId));
    await batch.commit();
  },
  addVacation: async (data) => {
    await addDoc(collection(db, 'dp_vacations'), stripUndefinedForCreate({ ...data, createdAt: serverTimestamp() }) as Record<string, unknown>);
  },
  updateVacation: async ({ id, ...data }) => {
    await updateDoc(doc(db, 'dp_vacations', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteVacation: async (vacationId) => {
    await deleteDoc(doc(db, 'dp_vacations', vacationId));
  },
  addCalendar: async (data) => {
    const ref = await addDoc(collection(db, 'dp_calendars'), stripUndefinedForCreate({ ...data, holidayCount: 0, createdAt: serverTimestamp() }) as Record<string, unknown>);
    return ref.id;
  },
  updateCalendar: async ({ id, ...data }) => {
    await updateDoc(doc(db, 'dp_calendars', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteCalendar: async (calendarId) => {
    const holidaysSnap = await getDocs(collection(db, 'dp_calendars', calendarId, 'holidays'));
    const batch = writeBatch(db);
    holidaysSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'dp_calendars', calendarId));
    await batch.commit();
  },
  addHoliday: async (calendarId, data) => {
    const batch = writeBatch(db);
    const holidayRef = doc(collection(db, 'dp_calendars', calendarId, 'holidays'));
    batch.set(holidayRef, stripUndefinedForCreate({ ...data, createdAt: serverTimestamp() }) as Record<string, unknown>);
    batch.update(doc(db, 'dp_calendars', calendarId), { holidayCount: increment(1) });
    await batch.commit();
  },
  deleteHoliday: async (calendarId, holidayId) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'dp_calendars', calendarId, 'holidays', holidayId));
    batch.update(doc(db, 'dp_calendars', calendarId), { holidayCount: increment(-1) });
    await batch.commit();
  },
}));
