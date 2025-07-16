
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type RepositionActivity, type RepositionItem } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';

export interface RepositionContextType {
  activities: RepositionActivity[];
  loading: boolean;
  createRepositionActivity: (data: Omit<RepositionActivity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'requestedBy'>) => Promise<string | null>;
  updateRepositionActivity: (activityId: string, updates: Partial<RepositionActivity>) => Promise<void>;
  deleteRepositionActivity: (activityId: string) => Promise<void>;
}

export const RepositionContext = createContext<RepositionContextType | undefined>(undefined);

export function RepositionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<RepositionActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "repositionActivities"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RepositionActivity));
      setActivities(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching reposition activities:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const createRepositionActivity = useCallback(async (data: Omit<RepositionActivity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'requestedBy'>): Promise<string | null> => {
    if (!user) {
      console.error("User not authenticated to create reposition activity.");
      return null;
    }

    const now = new Date().toISOString();
    const newActivity: Omit<RepositionActivity, 'id'> = {
      ...data,
      status: 'Aguardando despacho',
      requestedBy: {
        userId: user.id,
        username: user.username,
      },
      createdAt: now,
      updatedAt: now,
    };

    try {
      const docRef = await addDoc(collection(db, 'repositionActivities'), newActivity);
      return docRef.id;
    } catch (error) {
      console.error("Error creating reposition activity:", error);
      return null;
    }
  }, [user]);

  const updateRepositionActivity = useCallback(async (activityId: string, updates: Partial<RepositionActivity>) => {
    const activityRef = doc(db, 'repositionActivities', activityId);
    try {
      await updateDoc(activityRef, { ...updates, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Error updating reposition activity:", error);
    }
  }, []);
  
  const deleteRepositionActivity = useCallback(async (activityId: string) => {
    try {
      await deleteDoc(doc(db, 'repositionActivities', activityId));
    } catch (error) {
      console.error("Error deleting reposition activity:", error);
    }
  }, []);

  const value = useMemo(() => ({
    activities,
    loading,
    createRepositionActivity,
    updateRepositionActivity,
    deleteRepositionActivity,
  }), [activities, loading, createRepositionActivity, updateRepositionActivity, deleteRepositionActivity]);

  return <RepositionContext.Provider value={value}>{children}</RepositionContext.Provider>;
}
