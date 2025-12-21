

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ItemAdditionRequest, type Task } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, runTransaction, writeBatch, getDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useTasks } from '@/hooks/use-tasks';
import { useProfiles } from '@/hooks/use-profiles';

export interface ItemAdditionContextType {
  requests: ItemAdditionRequest[];
  loading: boolean;
  addRequest: (data: Partial<Omit<ItemAdditionRequest, 'id' | 'kioskName' | 'requestedBy' | 'status' | 'createdAt' | 'taskId'>>) => Promise<void>;
  updateRequestStatus: (requestId: string, status: 'completed' | 'rejected') => Promise<void>;
  deleteRequest: (requestId: string) => Promise<void>;
}

export const ItemAdditionContext = createContext<ItemAdditionContextType | undefined>(undefined);

export function ItemAdditionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { kiosks } = useKiosks();
  const { addTask } = useTasks();
  const { adminProfileId } = useProfiles();
  const [requests, setRequests] = useState<ItemAdditionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "itemAdditionRequests"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ItemAdditionRequest));
      setRequests(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching item addition requests from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addRequest = useCallback(async (data: Partial<Omit<ItemAdditionRequest, 'id' | 'kioskName' | 'requestedBy' | 'status' | 'createdAt' | 'taskId'>>) => {
    if (!user || !adminProfileId || !data.kioskId) throw new Error("Dados de usuário ou quiosque insuficientes.");
    
    const kiosk = kiosks.find(k => k.id === data.kioskId);
    if (!kiosk) throw new Error("Quiosque não encontrado.");

    const now = new Date().toISOString();

    const requestRef = doc(collection(db, "itemAdditionRequests"));
    const taskRef = doc(collection(db, "tasks"));

    const newRequest: Omit<ItemAdditionRequest, 'id'> = {
      kioskId: data.kioskId,
      productName: data.productName!,
      brand: data.brand,
      lote: data.lote,
      barcode: data.barcode,
      expiryDate: data.expiryDate,
      notes: data.notes,
      kioskName: kiosk.name,
      requestedBy: {
        userId: user.id,
        username: user.username,
      },
      status: 'pending',
      createdAt: now,
      taskId: taskRef.id,
    };

    const newTask: Omit<Task, 'id'> = {
        title: `Nova solicitação de cadastro: ${data.productName}`,
        description: `Solicitado por ${user.username} para o quiosque ${kiosk.name}.`,
        status: 'pending',
        assigneeType: 'profile',
        assigneeId: adminProfileId,
        requiresApproval: false,
        origin: {
            type: 'item_addition_request',
            id: requestRef.id,
        },
        history: [{
            timestamp: now,
            author: { id: user.id, name: user.username },
            action: 'created',
            details: 'Tarefa criada automaticamente via solicitação de cadastro.'
        }],
        createdAt: now,
        updatedAt: now,
    };

    try {
        const batch = writeBatch(db);
        batch.set(requestRef, newRequest);
        batch.set(taskRef, newTask);
        await batch.commit();
    } catch (error) {
      console.error("Error adding item request and task:", error);
      throw error;
    }
  }, [user, kiosks, adminProfileId, addTask]);

  const updateRequestStatus = useCallback(async (requestId: string, status: 'completed' | 'rejected') => {
    if (!user) throw new Error("Usuário não autenticado.");

    const requestRef = doc(db, "itemAdditionRequests", requestId);
    const requestDoc = requests.find(r => r.id === requestId);
    
    if (!requestDoc) {
      console.error("Request not found for update");
      return;
    }

    const now = new Date().toISOString();
    const updatePayload: Partial<ItemAdditionRequest> = {
      status,
      reviewedBy: {
        userId: user.id,
        username: user.username,
      },
      reviewedAt: now,
    };
    
    const taskUpdates: Partial<Task> = {
      status: 'completed',
      completedAt: now,
      history: [
        ...(requestDoc.taskId ? (await getDoc(doc(db, 'tasks', requestDoc.taskId))).data()?.history || [] : []),
        {
          timestamp: now,
          author: { id: user.id, name: user.username },
          action: 'completed',
          details: `Solicitação marcada como '${status === 'completed' ? 'Concluída' : 'Rejeitada'}'.`
        }
      ]
    };

    try {
      const batch = writeBatch(db);
      batch.update(requestRef, updatePayload);
      if (requestDoc.taskId) {
        batch.update(doc(db, 'tasks', requestDoc.taskId), taskUpdates);
      }
      await batch.commit();

    } catch (error) {
      console.error("Error updating item request status:", error);
      throw error;
    }
  }, [user, requests]);
  
  const deleteRequest = useCallback(async (requestId: string) => {
    try {
        await deleteDoc(doc(db, "itemAdditionRequests", requestId));
    } catch (error) {
        console.error("Error deleting item request:", error);
        throw error;
    }
  }, []);

  const value: ItemAdditionContextType = useMemo(() => ({
    requests,
    loading,
    addRequest,
    updateRequestStatus,
    deleteRequest,
  }), [requests, loading, addRequest, updateRequestStatus, deleteRequest]);

  return <ItemAdditionContext.Provider value={value}>{children}</ItemAdditionContext.Provider>;
}
