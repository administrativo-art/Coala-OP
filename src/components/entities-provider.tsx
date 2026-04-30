
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Entity } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export interface EntitiesContextType {
  entities: Entity[];
  loading: boolean;
  addEntity: (entity: Omit<Entity, 'id'>) => Promise<void>;
  updateEntity: (entity: Entity) => Promise<void>;
  deleteEntity: (entityId: string) => Promise<void>;
}

export const EntitiesContext = createContext<EntitiesContextType | undefined>(undefined);

export function EntitiesProvider({ children }: { children: React.ReactNode }) {
  const { user, permissions, loading: authLoading } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const canRead =
    Boolean(permissions?.registration?.view) ||
    canViewPurchasing(permissions);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user || !canRead) {
      setEntities([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, "entities"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const entitiesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Entity));
        setEntities(entitiesData.sort((a,b) => a.name.localeCompare(b.name)));
        setLoading(false);
    }, (error) => {
        console.error("Error fetching entities from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [authLoading, canRead, user]);

  const addEntity = useCallback(async (entity: Omit<Entity, 'id'>) => {
    try {
        await addDoc(collection(db, "entities"), entity);
    } catch(error) {
        console.error("Error adding entity:", error);
    }
  }, []);

  const updateEntity = useCallback(async (entity: Entity) => {
    const entityRef = doc(db, "entities", entity.id);
    const { id, ...dataToUpdate } = entity;
    try {
        await updateDoc(entityRef, dataToUpdate);
    } catch (error) {
        console.error("Error updating entity:", error);
        throw error;
    }
  }, []);

  const deleteEntity = useCallback(async (entityId: string) => {
    try {
        await deleteDoc(doc(db, "entities", entityId));
    } catch (error) {
        console.error("Error deleting entity:", error);
        throw error;
    }
  }, []);
  
  const value: EntitiesContextType = useMemo(() => ({
    entities,
    loading,
    addEntity,
    updateEntity,
    deleteEntity,
  }), [entities, loading, addEntity, updateEntity, deleteEntity]);

  return <EntitiesContext.Provider value={value}>{children}</EntitiesContext.Provider>;
}
