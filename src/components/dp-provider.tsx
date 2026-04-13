"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, serverTimestamp, writeBatch, increment,
} from 'firebase/firestore';
import type {
  DPUnit, DPUnitGroup, DPShiftDefinition,
  DPSchedule, DPVacationRecord, DPCalendar, DPHoliday,
} from '@/types';
import { DPContext, type DPContextType } from '@/contexts/dp-context';
export type { DPContextType } from '@/contexts/dp-context';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Normaliza daysOfWeek: migração antiga usa strings ("monday"), tipo espera números (0–6)
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

// ─── Provider ────────────────────────────────────────────────────────────────

export function DPProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits] = useState<DPUnit[]>([]);
  const [unitGroups, setUnitGroups] = useState<DPUnitGroup[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);

  const [shiftDefinitions, setShiftDefinitions] = useState<DPShiftDefinition[]>([]);
  const [shiftDefsLoading, setShiftDefsLoading] = useState(true);

  const [schedules, setSchedules] = useState<DPSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  const [vacations, setVacations] = useState<DPVacationRecord[]>([]);
  const [vacationsLoading, setVacationsLoading] = useState(true);

  const [calendars, setCalendars] = useState<DPCalendar[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(true);

  // Unidades
  useEffect(() => {
    const unsubUnits = onSnapshot(
      query(collection(db, 'dp_units'), orderBy('name')),
      (snap) => { setUnits(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnit))); setUnitsLoading(false); },
      () => setUnitsLoading(false)
    );
    const unsubGroups = onSnapshot(
      query(collection(db, 'dp_unitGroups'), orderBy('name')),
      (snap) => { setUnitGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPUnitGroup))); },
    );
    return () => { unsubUnits(); unsubGroups(); };
  }, []);

  // Definições de turno
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'dp_shiftDefinitions'), orderBy('name')),
      (snap) => {
        setShiftDefinitions(snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek) } as DPShiftDefinition;
        }));
        setShiftDefsLoading(false);
      },
      () => setShiftDefsLoading(false)
    );
  }, []);

  // Escalas
  useEffect(() => {
    return onSnapshot(
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
        // Ordenar por ano desc, mês desc no cliente (evita índice composto)
        list.sort((a, b) => b.year - a.year || b.month - a.month);
        setSchedules(list);
        setSchedulesLoading(false);
      },
      () => setSchedulesLoading(false)
    );
  }, []);

  // Férias
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'dp_vacations'), orderBy('createdAt', 'desc')),
      (snap) => { setVacations(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPVacationRecord))); setVacationsLoading(false); },
      () => setVacationsLoading(false)
    );
  }, []);

  // Calendários
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'dp_calendars'), orderBy('createdAt', 'desc')),
      (snap) => { setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPCalendar))); setCalendarsLoading(false); },
      () => setCalendarsLoading(false)
    );
  }, []);

  // ─── Unidades ───────────────────────────────────────────────────────────────

  const addUnit = useCallback(async (data: Omit<DPUnit, 'id' | 'createdAt'>) => {
    await addDoc(collection(db, 'dp_units'), { ...data, createdAt: serverTimestamp() });
  }, []);

  const updateUnit = useCallback(async ({ id, ...data }: DPUnit) => {
    await updateDoc(doc(db, 'dp_units', id), data as any);
  }, []);

  const deleteUnit = useCallback(async (unitId: string) => {
    await deleteDoc(doc(db, 'dp_units', unitId));
  }, []);

  const addUnitGroup = useCallback(async (data: Omit<DPUnitGroup, 'id' | 'createdAt'>) => {
    await addDoc(collection(db, 'dp_unitGroups'), { ...data, unitCount: 0, createdAt: serverTimestamp() });
  }, []);

  const updateUnitGroup = useCallback(async ({ id, ...data }: DPUnitGroup) => {
    await updateDoc(doc(db, 'dp_unitGroups', id), data as any);
  }, []);

  const deleteUnitGroup = useCallback(async (groupId: string) => {
    await deleteDoc(doc(db, 'dp_unitGroups', groupId));
  }, []);

  // ─── Definições de turno ────────────────────────────────────────────────────

  const addShiftDefinition = useCallback(async (data: Omit<DPShiftDefinition, 'id' | 'createdAt'>) => {
    await addDoc(collection(db, 'dp_shiftDefinitions'), { ...data, createdAt: serverTimestamp() });
  }, []);

  const updateShiftDefinition = useCallback(async ({ id, ...data }: DPShiftDefinition) => {
    await updateDoc(doc(db, 'dp_shiftDefinitions', id), data as any);
  }, []);

  const deleteShiftDefinition = useCallback(async (defId: string) => {
    await deleteDoc(doc(db, 'dp_shiftDefinitions', defId));
  }, []);

  // ─── Escalas ────────────────────────────────────────────────────────────────

  const addSchedule = useCallback(async (data: Omit<DPSchedule, 'id' | 'createdAt' | 'shiftCount'>): Promise<string> => {
    const ref = await addDoc(collection(db, 'dp_schedules'), { ...data, shiftCount: 0, createdAt: serverTimestamp() });
    return ref.id;
  }, []);

  const updateSchedule = useCallback(async ({ id, ...data }: DPSchedule) => {
    await updateDoc(doc(db, 'dp_schedules', id), data as any);
  }, []);

  const deleteSchedule = useCallback(async (scheduleId: string) => {
    // Deleta todos os turnos da subcoleção antes de deletar a escala
    const shiftsSnap = await import('firebase/firestore').then(({ getDocs }) =>
      getDocs(collection(db, 'dp_schedules', scheduleId, 'shifts'))
    );
    const batch = writeBatch(db);
    shiftsSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'dp_schedules', scheduleId));
    await batch.commit();
  }, []);

  // ─── Férias ─────────────────────────────────────────────────────────────────

  const addVacation = useCallback(async (data: Omit<DPVacationRecord, 'id' | 'createdAt'>) => {
    await addDoc(collection(db, 'dp_vacations'), { ...data, createdAt: serverTimestamp() });
  }, []);

  const updateVacation = useCallback(async ({ id, ...data }: DPVacationRecord) => {
    await updateDoc(doc(db, 'dp_vacations', id), data as any);
  }, []);

  const deleteVacation = useCallback(async (vacationId: string) => {
    await deleteDoc(doc(db, 'dp_vacations', vacationId));
  }, []);

  // ─── Calendários ────────────────────────────────────────────────────────────

  const addCalendar = useCallback(async (data: Omit<DPCalendar, 'id' | 'createdAt' | 'holidayCount'>): Promise<string> => {
    const ref = await addDoc(collection(db, 'dp_calendars'), { ...data, holidayCount: 0, createdAt: serverTimestamp() });
    return ref.id;
  }, []);

  const updateCalendar = useCallback(async ({ id, ...data }: DPCalendar) => {
    await updateDoc(doc(db, 'dp_calendars', id), data as any);
  }, []);

  const deleteCalendar = useCallback(async (calendarId: string) => {
    const holidaysSnap = await import('firebase/firestore').then(({ getDocs }) =>
      getDocs(collection(db, 'dp_calendars', calendarId, 'holidays'))
    );
    const batch = writeBatch(db);
    holidaysSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'dp_calendars', calendarId));
    await batch.commit();
  }, []);

  const addHoliday = useCallback(async (calendarId: string, data: Omit<DPHoliday, 'id' | 'createdAt'>) => {
    const batch = writeBatch(db);
    const holidayRef = doc(collection(db, 'dp_calendars', calendarId, 'holidays'));
    batch.set(holidayRef, { ...data, createdAt: serverTimestamp() });
    batch.update(doc(db, 'dp_calendars', calendarId), { holidayCount: increment(1) });
    await batch.commit();
  }, []);

  const deleteHoliday = useCallback(async (calendarId: string, holidayId: string) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'dp_calendars', calendarId, 'holidays', holidayId));
    batch.update(doc(db, 'dp_calendars', calendarId), { holidayCount: increment(-1) });
    await batch.commit();
  }, []);

  // ─── Value ──────────────────────────────────────────────────────────────────

  const value = useMemo<DPContextType>(() => ({
    units, unitGroups, unitsLoading,
    addUnit, updateUnit, deleteUnit,
    addUnitGroup, updateUnitGroup, deleteUnitGroup,
    shiftDefinitions, shiftDefsLoading,
    addShiftDefinition, updateShiftDefinition, deleteShiftDefinition,
    schedules, schedulesLoading,
    addSchedule, updateSchedule, deleteSchedule,
    vacations, vacationsLoading,
    addVacation, updateVacation, deleteVacation,
    calendars, calendarsLoading,
    addCalendar, updateCalendar, deleteCalendar,
    addHoliday, deleteHoliday,
  }), [
    units, unitGroups, unitsLoading,
    addUnit, updateUnit, deleteUnit,
    addUnitGroup, updateUnitGroup, deleteUnitGroup,
    shiftDefinitions, shiftDefsLoading,
    addShiftDefinition, updateShiftDefinition, deleteShiftDefinition,
    schedules, schedulesLoading,
    addSchedule, updateSchedule, deleteSchedule,
    vacations, vacationsLoading,
    addVacation, updateVacation, deleteVacation,
    calendars, calendarsLoading,
    addCalendar, updateCalendar, deleteCalendar,
    addHoliday, deleteHoliday,
  ]);

  return <DPContext.Provider value={value}>{children}</DPContext.Provider>;
}
