
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Entity } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export interface EntitiesContextType {
  entities: Entity[];
  loading: boolean;
  addEntity: (entity: Omit<Entity, 'id'>) => Promise<string>;
  updateEntity: (entity: Entity) => Promise<void>;
  deleteEntity: (entityId: string) => Promise<void>;
}

export const EntitiesContext = createContext<EntitiesContextType | undefined>(undefined);

export function EntitiesProvider({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, permissions, loading: authLoading } = useAuth();
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
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch('/api/registry/entities', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(entity),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao adicionar pessoa ou empresa.');
    }
    const payload = await response.json();
    return String(payload.id);
  }, [firebaseUser]);

  const updateEntity = useCallback(async (entity: Entity) => {
    const { id, ...dataToUpdate } = entity;
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/registry/entities/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(dataToUpdate),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao atualizar pessoa ou empresa.');
    }
  }, [firebaseUser]);

  const deleteEntity = useCallback(async (entityId: string) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/registry/entities/${entityId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao excluir pessoa ou empresa.');
    }
  }, [firebaseUser]);
  
  const value: EntitiesContextType = useMemo(() => ({
    entities,
    loading,
    addEntity,
    updateEntity,
    deleteEntity,
  }), [entities, loading, addEntity, updateEntity, deleteEntity]);

  return <EntitiesContext.Provider value={value}>{children}</EntitiesContext.Provider>;
}
