
"use client"

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type ReturnRequest, type ReturnRequestHistoricoItem } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, runTransaction } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { format, addDays } from 'date-fns';

export interface ReturnRequestContextType {
  requests: ReturnRequest[];
  loading: boolean;
  addReturnRequest: (data: { tipo: 'devolucao' | 'bonificacao'; insumoId: string; lote: string; quantidade: number; motivo: string; }) => Promise<void>;
  updateReturnRequest: (requestId: string, payload: Partial<ReturnRequest>) => Promise<void>;
  deleteReturnRequest: (requestId: string) => Promise<void>;
}

export const ReturnRequestContext = createContext<ReturnRequestContextType | undefined>(undefined);

export function ReturnsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { products, getProductFullName } = useProducts();
  const [requests, setRequests] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "returnRequests"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReturnRequest));
      setRequests(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
        console.error("Error fetching return requests from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addReturnRequest = useCallback(async (data: { tipo: 'devolucao' | 'bonificacao'; insumoId: string; lote: string; quantidade: number; motivo: string; }) => {
    if (!user) throw new Error("Usuário não autenticado.");
    const product = products.find(p => p.id === data.insumoId);
    if (!product) throw new Error("Produto não encontrado.");

    const today = format(new Date(), 'yyyy-MM-dd');
    const counterRef = doc(db, 'counters', `returnRequests_${today}`);

    try {
        const newNumero = await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            const newCount = (counterDoc.data()?.count || 0) + 1;
            transaction.set(counterRef, { count: newCount }, { merge: true });
            
            const prefix = data.tipo === 'devolucao' ? 'DEV' : 'BON';
            const dateStr = today.replace(/-/g, '');
            const sequence = newCount.toString().padStart(4, '0');
            return `${prefix}-${dateStr}-${sequence}`;
        });

        const now = new Date();
        const dataPrevisaoRetorno = addDays(now, 45);

        const newRequest: Omit<ReturnRequest, 'id'> = {
            ...data,
            numero: newNumero,
            insumoNome: getProductFullName(product),
            status: 'em_andamento',
            dataPrevisaoRetorno: dataPrevisaoRetorno.toISOString(),
            historico: [{
                statusAnterior: 'em_andamento',
                statusNovo: 'em_andamento',
                changedBy: { userId: user.id, username: user.username },
                changedAt: now.toISOString(),
                detalhes: "Chamado criado."
            }],
            checklist: {},
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            createdBy: { userId: user.id, username: user.username },
        };
        
        await addDoc(collection(db, "returnRequests"), newRequest);

    } catch (error) {
        console.error("Error creating return request:", error);
    }
  }, [user, products, getProductFullName]);
  
  const updateReturnRequest = useCallback(async (requestId: string, payload: Partial<ReturnRequest>) => {
    if (!user) throw new Error("Usuário não autenticado.");
    const requestRef = doc(db, "returnRequests", requestId);
    
    try {
        await runTransaction(db, async (transaction) => {
            const requestDoc = await transaction.get(requestRef);
            if (!requestDoc.exists()) {
                throw "Document does not exist!";
            }
            
            const currentRequest = requestDoc.data() as ReturnRequest;
            const now = new Date().toISOString();
            
            const updateData: Partial<ReturnRequest> = {
                ...payload,
                updatedAt: now,
            };

            if (payload.status && payload.status !== currentRequest.status) {
                const historyItem: ReturnRequestHistoricoItem = {
                    statusAnterior: currentRequest.status,
                    statusNovo: payload.status,
                    changedBy: { userId: user.id, username: user.username },
                    changedAt: now,
                };
                
                if (payload.detalhesResultado) {
                    historyItem.detalhes = payload.detalhesResultado;
                }

                updateData.historico = [...currentRequest.historico, historyItem];
            } else if (currentRequest.historico) {
                updateData.historico = currentRequest.historico;
            }

            // Firestore does not allow `undefined` values. We need to clean them up.
            Object.keys(updateData).forEach(keyStr => {
              const key = keyStr as keyof typeof updateData;
              if (updateData[key] === undefined) {
                delete updateData[key];
              }
            });

            transaction.update(requestRef, updateData);
        });
    } catch(error) {
        console.error("Error updating return request:", error);
    }
  }, [user]);

  const deleteReturnRequest = useCallback(async (requestId: string) => {
    try {
        await deleteDoc(doc(db, "returnRequests", requestId));
    } catch (error) {
        console.error("Error deleting return request:", error);
        throw error;
    }
  }, []);

  const value: ReturnRequestContextType = {
    requests,
    loading,
    addReturnRequest,
    updateReturnRequest,
    deleteReturnRequest,
  };

  return <ReturnRequestContext.Provider value={value}>{children}</ReturnRequestContext.Provider>;
}
