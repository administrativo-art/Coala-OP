"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, serverTimestamp } from 'firebase/firestore';
import { type GoalTemplate, type GoalPeriodDoc, type EmployeeGoal } from '@/types';
import { GoalsContext } from '@/contexts/goals-context';

export function GoalsProvider({ children }: { children: React.ReactNode }) {
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [periods, setPeriods] = useState<GoalPeriodDoc[]>([]);
  const [employeeGoals, setEmployeeGoals] = useState<EmployeeGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Só abre subscriptions quando o usuário estiver autenticado.
    // Isso evita que os onSnapshot disparem antes do token estar pronto e
    // morram silenciosamente com permission-denied.
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setTemplates([]);
        setPeriods([]);
        setEmployeeGoals([]);
        setLoading(false);
        return;
      }

      let loadedCount = 0;
      const checkDone = () => { loadedCount++; if (loadedCount >= 3) setLoading(false); };

      const unsubTemplates = onSnapshot(collection(db, 'goalTemplates'), snap => {
        setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoalTemplate)));
        checkDone();
      }, err => { console.warn('[GoalsProvider] goalTemplates:', err.code, err.message); checkDone(); });

      const unsubPeriods = onSnapshot(collection(db, 'goalPeriods'), snap => {
        setPeriods(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoalPeriodDoc)));
        checkDone();
      }, err => { console.warn('[GoalsProvider] goalPeriods:', err.code, err.message); checkDone(); });

      const unsubEmp = onSnapshot(collection(db, 'employeeGoals'), snap => {
        setEmployeeGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as EmployeeGoal)));
        checkDone();
      }, err => { console.warn('[GoalsProvider] employeeGoals:', err.code, err.message); checkDone(); });

      // Retorna cleanup das subscriptions Firestore quando o auth mudar
      return () => { unsubTemplates(); unsubPeriods(); unsubEmp(); };
    });

    return () => unsubAuth();
  }, []);

  const addTemplate = useCallback(async (data: Omit<GoalTemplate, 'id' | 'createdAt'>): Promise<string | null> => {
    try {
      const ref = await addDoc(collection(db, 'goalTemplates'), { ...data, createdAt: serverTimestamp() });
      return ref.id;
    } catch (e) { console.error(e); return null; }
  }, []);

  const updateTemplate = useCallback(async (id: string, data: Partial<GoalTemplate>) => {
    try { await updateDoc(doc(db, 'goalTemplates', id), data); } catch (e) { console.error(e); }
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    try { await deleteDoc(doc(db, 'goalTemplates', id)); } catch (e) { console.error(e); }
  }, []);

  const addPeriod = useCallback(async (data: Omit<GoalPeriodDoc, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> => {
    try {
      const ref = await addDoc(collection(db, 'goalPeriods'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return ref.id;
    } catch (e) { console.error(e); return null; }
  }, []);

  const updatePeriod = useCallback(async (id: string, data: Partial<GoalPeriodDoc>) => {
    try { await updateDoc(doc(db, 'goalPeriods', id), { ...data, updatedAt: serverTimestamp() }); } catch (e) { console.error(e); }
  }, []);

  const deletePeriod = useCallback(async (id: string) => {
    try { await deleteDoc(doc(db, 'goalPeriods', id)); } catch (e) { console.error(e); }
  }, []);

  const closePeriod = useCallback(async (id: string, status: 'closed' | 'cancelled', closureNote: string, closedBy: string) => {
    try {
      await updateDoc(doc(db, 'goalPeriods', id), {
        status,
        closureNote,
        closedBy,
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error(e); }
  }, []);

  const reopenPeriod = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, 'goalPeriods', id), {
        status: 'active',
        closureNote: null,
        closedBy: null,
        closedAt: null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error(e); }
  }, []);

  const refreshEmployeeGoals = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'employeeGoals'));
      setEmployeeGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as EmployeeGoal)));
    } catch (e) { console.warn('[GoalsProvider] refreshEmployeeGoals:', e); }
  }, []);

  const addEmployeeGoal = useCallback(async (data: Omit<EmployeeGoal, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> => {
    try {
      const ref = await addDoc(collection(db, 'employeeGoals'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      // Atualização otimista imediata
      setEmployeeGoals(prev => {
        if (prev.some(eg => eg.id === ref.id)) return prev;
        return [...prev, { id: ref.id, ...data } as EmployeeGoal];
      });
      // Leitura forçada para garantir consistência mesmo se o onSnapshot estiver morto
      const snap = await getDocs(collection(db, 'employeeGoals'));
      setEmployeeGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as EmployeeGoal)));
      return ref.id;
    } catch (e) { console.error('[GoalsProvider] addEmployeeGoal:', e); return null; }
  }, []);

  const deleteEmployeeGoal = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, 'employeeGoals', id));
      // Atualização otimista imediata
      setEmployeeGoals(prev => prev.filter(eg => eg.id !== id));
      // Leitura forçada
      const snap = await getDocs(collection(db, 'employeeGoals'));
      setEmployeeGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as EmployeeGoal)));
    } catch (e) { console.error('[GoalsProvider] deleteEmployeeGoal:', e); }
  }, []);

  const value = useMemo(() => ({
    templates, periods, employeeGoals, loading,
    addTemplate, updateTemplate, deleteTemplate,
    addPeriod, updatePeriod, deletePeriod, closePeriod, reopenPeriod,
    addEmployeeGoal, deleteEmployeeGoal,
  }), [templates, periods, employeeGoals, loading, addTemplate, updateTemplate, deleteTemplate, addPeriod, updatePeriod, deletePeriod, closePeriod, reopenPeriod, addEmployeeGoal, deleteEmployeeGoal]);

  return <GoalsContext.Provider value={value}>{children}</GoalsContext.Provider>;
}
