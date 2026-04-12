"use client";

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, serverTimestamp, writeBatch, increment,
} from 'firebase/firestore';
import type { DPShift } from '@/types';

export interface DPShiftsHookResult {
  shifts: DPShift[];
  loading: boolean;
  addShift: (data: Omit<DPShift, 'id' | 'createdAt'>) => Promise<void>;
  addShiftsBatch: (data: Omit<DPShift, 'id' | 'createdAt'>[]) => Promise<void>;
  updateShift: (shift: DPShift) => Promise<void>;
  deleteShift: (shiftId: string) => Promise<void>;
  clearAllShifts: () => Promise<void>;
}

export function useDPShifts(scheduleId: string | null): DPShiftsHookResult {
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scheduleId) { setShifts([]); setLoading(false); return; }

    setLoading(true);
    return onSnapshot(
      query(
        collection(db, 'dp_schedules', scheduleId, 'shifts'),
        orderBy('date'),
      ),
      (snap) => {
        setShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPShift)));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [scheduleId]);

  const addShift = useCallback(async (data: Omit<DPShift, 'id' | 'createdAt'>) => {
    if (!scheduleId) return;
    const batch = writeBatch(db);
    const shiftRef = doc(collection(db, 'dp_schedules', scheduleId, 'shifts'));
    batch.set(shiftRef, { ...data, createdAt: serverTimestamp() });
    batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: increment(1) });
    await batch.commit();
  }, [scheduleId]);

  const addShiftsBatch = useCallback(async (data: Omit<DPShift, 'id' | 'createdAt'>[]) => {
    if (!scheduleId || data.length === 0) return;
    // Firestore permite no máximo 500 operações por batch
    const chunks = [];
    for (let i = 0; i < data.length; i += 499) chunks.push(data.slice(i, i + 499));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(item => {
        const ref = doc(collection(db, 'dp_schedules', scheduleId, 'shifts'));
        batch.set(ref, { ...item, createdAt: serverTimestamp() });
      });
      batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: increment(chunk.length) });
      await batch.commit();
    }
  }, [scheduleId]);

  const updateShift = useCallback(async ({ id, ...data }: DPShift) => {
    if (!scheduleId) return;
    await updateDoc(doc(db, 'dp_schedules', scheduleId, 'shifts', id), data as any);
  }, [scheduleId]);

  const deleteShift = useCallback(async (shiftId: string) => {
    if (!scheduleId) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, 'dp_schedules', scheduleId, 'shifts', shiftId));
    batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: increment(-1) });
    await batch.commit();
  }, [scheduleId]);

  const clearAllShifts = useCallback(async () => {
    if (!scheduleId || shifts.length === 0) return;
    const chunks = [];
    for (let i = 0; i < shifts.length; i += 499) chunks.push(shifts.slice(i, i + 499));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(s => batch.delete(doc(db, 'dp_schedules', scheduleId, 'shifts', s.id)));
      if (chunk === chunks[chunks.length - 1]) {
        batch.update(doc(db, 'dp_schedules', scheduleId), { shiftCount: 0 });
      }
      await batch.commit();
    }
  }, [scheduleId, shifts]);

  return { shifts, loading, addShift, addShiftsBatch, updateShift, deleteShift, clearAllShifts };
}
