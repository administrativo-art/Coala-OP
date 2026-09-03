import { create } from 'zustand';
import { auth, db } from '@/lib/firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, writeBatch, increment, getDocs, deleteField, runTransaction
} from 'firebase/firestore';
import type {
  DPUnit, DPUnitGroup, DPUnitOrganization, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar, DPHoliday,
} from '@/types';
import { canonicalOperationalUnitId } from '@/lib/dp-units';
import { buildDPScheduleDocumentId } from '@/lib/dp-schedule-periods';
import {
  authenticatedApiRequest,
  type AuthenticatedApiRequestInit,
} from '@/lib/authenticated-api-client';

async function dpApiRequest<T>(path: string, init: AuthenticatedApiRequestInit) {
  return authenticatedApiRequest<T>(path, {
    ...init,
    getIdToken: async () => auth.currentUser?.getIdToken() ?? null,
  });
}

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
  unitOrganizations: DPUnitOrganization[];
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
  setUnitOrganizations: (organizations: DPUnitOrganization[]) => void;
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
  addUnitOrganization: (data: Omit<DPUnitOrganization, 'id' | 'createdAt'>) => Promise<void>;
  updateUnitOrganization: (organization: DPUnitOrganization) => Promise<void>;
  deleteUnitOrganization: (organizationId: string) => Promise<void>;
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
  unitOrganizations: [],
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

async function requestFormUnitProjectSync() {
  try {
    if (typeof window === 'undefined') return;

    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();
    await fetch('/api/forms/projects/ensure-units', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch (error) {
    console.warn('[DP] Falha ao sincronizar projetos de formulários por unidade.', error);
  }
}

async function authorizedDpJson<T = Record<string, unknown>>(path: string, method: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');

  const token = await user.getIdToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body, (_key, value) => (value === undefined ? null : value)),
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? 'Falha ao salvar dados de unidades.');
  }

  return response.json().catch(() => ({})) as Promise<T>;
}

export const useDPStore = create<DPStoreState>((set, get) => ({
  ...initialState,

  // Setters
  setUnits: (units) => set({ units }),
  setUnitGroups: (unitGroups) => set({ unitGroups }),
  setUnitOrganizations: (unitOrganizations) => set({ unitOrganizations }),
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
    const payload = await authorizedDpJson<{ unit?: DPUnit }>('/api/dp/units', 'POST', data);
    if (payload.unit) {
      set((state) => ({ units: [...state.units, payload.unit!] }));
    }
    void requestFormUnitProjectSync();
  },
  updateUnit: async ({ id, createdAt: _createdAt, ...data }) => {
    await authorizedDpJson(`/api/dp/units/${encodeURIComponent(id)}`, 'PATCH', data);
    set((state) => ({
      units: state.units.map((unit) => (unit.id === id ? { ...unit, ...data, id } : unit)),
    }));
    void requestFormUnitProjectSync();
  },
  deleteUnit: async (unitId) => {
    await authorizedDpJson(`/api/dp/units/${encodeURIComponent(unitId)}`, 'DELETE');
    set((state) => ({ units: state.units.filter((unit) => unit.id !== unitId) }));
  },
  addUnitOrganization: async (data) => {
    const payload = await authorizedDpJson<{ organization?: DPUnitOrganization }>('/api/dp/unit-organizations', 'POST', data);
    if (payload.organization) {
      set((state) => ({ unitOrganizations: [...state.unitOrganizations, payload.organization!] }));
    }
  },
  updateUnitOrganization: async ({ id, createdAt: _createdAt, ...data }) => {
    await authorizedDpJson(`/api/dp/unit-organizations/${encodeURIComponent(id)}`, 'PATCH', data);
    set((state) => ({
      unitOrganizations: state.unitOrganizations.map((organization) =>
        organization.id === id ? { ...organization, ...data, id } : organization
      ),
    }));
  },
  deleteUnitOrganization: async (organizationId) => {
    await authorizedDpJson(`/api/dp/unit-organizations/${encodeURIComponent(organizationId)}`, 'DELETE');
    set((state) => ({
      unitOrganizations: state.unitOrganizations.filter((organization) => organization.id !== organizationId),
    }));
  },
  addUnitGroup: async (data) => {
    const payload = await authorizedDpJson<{ group?: DPUnitGroup }>('/api/dp/unit-groups', 'POST', data);
    if (payload.group) {
      set((state) => ({ unitGroups: [...state.unitGroups, payload.group!] }));
    }
    void requestFormUnitProjectSync();
  },
  updateUnitGroup: async ({ id, createdAt: _createdAt, ...data }) => {
    await authorizedDpJson(`/api/dp/unit-groups/${encodeURIComponent(id)}`, 'PATCH', data);
    set((state) => ({
      unitGroups: state.unitGroups.map((group) => (group.id === id ? { ...group, ...data, id } : group)),
    }));
    void requestFormUnitProjectSync();
  },
  deleteUnitGroup: async (groupId) => {
    await authorizedDpJson(`/api/dp/unit-groups/${encodeURIComponent(groupId)}`, 'DELETE');
    set((state) => ({ unitGroups: state.unitGroups.filter((group) => group.id !== groupId) }));
    void requestFormUnitProjectSync();
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
    const state = get();
    const unit = data.unitId ? state.units.find((candidate) => candidate.id === data.unitId) : undefined;
    if (!unit || unit.isArchived === true) {
      throw new Error('Selecione uma unidade ativa para criar a escala.');
    }
    const canonicalUnitId = canonicalOperationalUnitId(unit.id, state.units);
    const duplicate = state.schedules.some((schedule) =>
      Number(schedule.year) === Number(data.year) &&
      Number(schedule.month) === Number(data.month) &&
      (!schedule.unitId || canonicalOperationalUnitId(schedule.unitId, state.units) === canonicalUnitId)
    );
    if (duplicate) {
      throw new Error('Já existe uma escala para esta unidade ou para uma unidade incorporada neste período.');
    }
    const scheduleRef = doc(
      db,
      'dp_schedules',
      buildDPScheduleDocumentId(data.year, data.month, canonicalUnitId ?? unit.id),
    );
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(scheduleRef);
      if (existing.exists()) {
        throw new Error('Já existe uma escala para esta unidade neste período.');
      }
      transaction.set(
        scheduleRef,
        stripUndefinedForCreate({ ...data, shiftCount: 0, createdAt: serverTimestamp() }) as Record<string, unknown>,
      );
    });
    return scheduleRef.id;
  },
  updateSchedule: async ({ id, ...data }) => {
    const existing = get().schedules.find((schedule) => schedule.id === id);
    const existingUnit = existing?.unitId ? get().units.find((unit) => unit.id === existing.unitId) : undefined;
    if (existingUnit?.isArchived === true) {
      throw new Error('Escalas históricas de unidades incorporadas são somente para leitura.');
    }
    await updateDoc(doc(db, 'dp_schedules', id), sanitizeFirestoreUpdate(data) as Record<string, unknown>);
  },
  deleteSchedule: async (scheduleId) => {
    const existing = get().schedules.find((schedule) => schedule.id === scheduleId);
    const existingUnit = existing?.unitId ? get().units.find((unit) => unit.id === existing.unitId) : undefined;
    if (existingUnit?.isArchived === true) {
      throw new Error('Escalas históricas de unidades incorporadas não podem ser excluídas.');
    }
    const shiftsSnap = await getDocs(collection(db, 'dp_schedules', scheduleId, 'shifts'));
    const batch = writeBatch(db);
    shiftsSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'dp_schedules', scheduleId));
    await batch.commit();
  },
  addVacation: async (data) => {
    await dpApiRequest('/api/dp/vacations', {
      method: 'POST',
      json: {
        userId: data.userId,
        status: data.status,
        vacation: {
          cycleId: data.cycleId,
          recordType: data.recordType,
          startDate: data.startDate,
          endDate: data.endDate,
          days: data.days,
          returnDate: data.returnDate,
        },
      },
      fallbackError: 'Falha ao registrar férias.',
    });
  },
  updateVacation: async ({ id, ...data }) => {
    const current = get().vacations.find((vacation) => vacation.id === id);
    const action = data.status === 'APPROVED' && current?.status !== 'APPROVED'
      ? 'approve'
      : data.status === 'REJECTED' && current?.status !== 'REJECTED'
        ? 'reject'
        : 'update_record';
    await dpApiRequest(`/api/dp/vacations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: action === 'update_record'
        ? {
            action,
            vacation: {
              cycleId: data.cycleId,
              recordType: data.recordType,
              startDate: data.startDate,
              endDate: data.endDate,
              days: data.days,
              returnDate: data.returnDate,
            },
          }
        : { action },
      fallbackError: 'Falha ao atualizar férias.',
    });
  },
  deleteVacation: async (vacationId) => {
    await dpApiRequest(`/api/dp/vacations/${encodeURIComponent(vacationId)}`, {
      method: 'DELETE',
      fallbackError: 'Falha ao excluir férias.',
    });
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
