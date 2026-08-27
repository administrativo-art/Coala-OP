"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { type GoalTemplate, type GoalPeriodDoc, type EmployeeGoal } from '@/types';
import { GoalsContext } from '@/contexts/goals-context';
import { buildGoalClosureSnapshot, calculateScheduledEmployeeGoalTargets, loadGoalDistributionSnapshot } from '@/lib/goals-distribution';
import { fetchClientBootstrap } from '@/lib/client-bootstrap';

export function GoalsProvider({ children }: { children: React.ReactNode }) {
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [periods, setPeriods] = useState<GoalPeriodDoc[]>([]);
  const [employeeGoals, setEmployeeGoals] = useState<EmployeeGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Só abre subscriptions quando o usuário estiver autenticado.
    // Isso evita que os onSnapshot disparem antes do token estar pronto e
    // morram silenciosamente com permission-denied.
    let unsubscribeGoals: (() => void) | null = null;
    let active = true;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeGoals?.();
      unsubscribeGoals = null;

      if (!user) {
        setTemplates([]);
        setPeriods([]);
        setEmployeeGoals([]);
        setLoading(false);
        return;
      }

      let loadedCount = 0;
      let fallbackStarted = false;
      const checkDone = () => { loadedCount++; if (loadedCount >= 3) setLoading(false); };

      const loadFallback = async () => {
        if (fallbackStarted) return;
        fallbackStarted = true;

        try {
          const payload = await fetchClientBootstrap(user, ["goals"]);
          if (!active) return;
          setTemplates(payload.goalTemplates ?? []);
          setPeriods(payload.goalPeriods ?? []);
          setEmployeeGoals(payload.employeeGoals ?? []);
        } catch (fallbackError) {
          console.error("[GoalsProvider] API fallback failed:", fallbackError);
        } finally {
          if (active) setLoading(false);
        }
      };

      const unsubTemplates = onSnapshot(collection(db, 'goalTemplates'), snap => {
        if (!active) return;
        setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoalTemplate)));
        checkDone();
      }, err => { console.warn('[GoalsProvider] goalTemplates:', err.code, err.message); void loadFallback(); });

      const unsubPeriods = onSnapshot(collection(db, 'goalPeriods'), snap => {
        if (!active) return;
        setPeriods(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoalPeriodDoc)));
        checkDone();
      }, err => { console.warn('[GoalsProvider] goalPeriods:', err.code, err.message); void loadFallback(); });

      const unsubEmp = onSnapshot(collection(db, 'employeeGoals'), snap => {
        if (!active) return;
        setEmployeeGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as EmployeeGoal)));
        checkDone();
      }, err => { console.warn('[GoalsProvider] employeeGoals:', err.code, err.message); void loadFallback(); });

      // Retorna cleanup das subscriptions Firestore quando o auth mudar
      unsubscribeGoals = () => { unsubTemplates(); unsubPeriods(); unsubEmp(); };
    });

    return () => {
      active = false;
      unsubscribeGoals?.();
      unsubAuth();
    };
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
      const period = periods.find(item => item.id === id);
      const periodEmployeeGoals = employeeGoals.filter(goal => goal.periodId === id);
      const distributionSnapshot = period
        ? await loadGoalDistributionSnapshot([period], periodEmployeeGoals)
        : null;
      const closureSnapshot = period
        ? {
            ...buildGoalClosureSnapshot(period, periodEmployeeGoals, distributionSnapshot),
            capturedAt: serverTimestamp(),
          }
        : null;

      await updateDoc(doc(db, 'goalPeriods', id), {
        status,
        closureNote,
        closedBy,
        closedAt: serverTimestamp(),
        closureSnapshot,
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error(e); }
  }, [employeeGoals, periods]);

  const reopenPeriod = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, 'goalPeriods', id), {
        status: 'active',
        closureNote: null,
        closedBy: null,
        closedAt: null,
        closureSnapshot: null,
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

  const updateEmployeeGoal = useCallback(async (id: string, data: Partial<EmployeeGoal>) => {
    try {
      await updateDoc(doc(db, 'employeeGoals', id), { ...data, updatedAt: serverTimestamp() });
      setEmployeeGoals(prev => prev.map(goal => goal.id === id ? { ...goal, ...data } : goal));
    } catch (e) { console.error('[GoalsProvider] updateEmployeeGoal:', e); }
  }, []);

  const rebalancePeriodEmployeeGoals = useCallback(async (
    period: GoalPeriodDoc,
    periodEmployeeGoals: EmployeeGoal[],
    kioskNameById?: Record<string, string>
  ) => {
    if (period.version === 2) return;
    if (periodEmployeeGoals.length === 0) return;

    try {
      const snapshot = await loadGoalDistributionSnapshot([period], periodEmployeeGoals, kioskNameById);
      const targets = calculateScheduledEmployeeGoalTargets(period, periodEmployeeGoals, snapshot);
      const entries = Object.entries(targets);
      if (entries.length === 0) return;

      const batch = writeBatch(db);
      for (const [goalId, target] of entries) {
        batch.update(doc(db, 'employeeGoals', goalId), {
          targetValue: target.targetValue,
          fraction: target.fraction,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();

      setEmployeeGoals(prev => prev.map(goal => {
        const target = targets[goal.id];
        return target ? { ...goal, targetValue: target.targetValue, fraction: target.fraction } : goal;
      }));
    } catch (e) {
      console.error('[GoalsProvider] rebalancePeriodEmployeeGoals:', e);
    }
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
    addEmployeeGoal, updateEmployeeGoal, deleteEmployeeGoal, rebalancePeriodEmployeeGoals,
  }), [templates, periods, employeeGoals, loading, addTemplate, updateTemplate, deleteTemplate, addPeriod, updatePeriod, deletePeriod, closePeriod, reopenPeriod, addEmployeeGoal, updateEmployeeGoal, deleteEmployeeGoal, rebalancePeriodEmployeeGoals]);

  return <GoalsContext.Provider value={value}>{children}</GoalsContext.Provider>;
}
