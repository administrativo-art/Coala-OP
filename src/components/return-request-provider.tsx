"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from "react";
import { type ReturnRequest } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import {
  createReturnRequest,
  deleteReturnRequestRequest,
  fetchReturnRequests,
  updateReturnRequestRequest,
} from "@/features/return-requests/lib/client";

export interface ReturnRequestContextType {
  requests: ReturnRequest[];
  loading: boolean;
  addReturnRequest: (data: {
    tipo: "devolucao" | "bonificacao";
    insumoId: string;
    lote: string;
    quantidade: number;
    motivo: string;
  }) => Promise<void>;
  updateReturnRequest: (
    requestId: string,
    payload: Partial<ReturnRequest>
  ) => Promise<void>;
  deleteReturnRequest: (requestId: string) => Promise<void>;
}

export const ReturnRequestContext = createContext<
  ReturnRequestContextType | undefined
>(undefined);

export function ReturnsProvider({ children }: { children: React.ReactNode }) {
  const { permissions, firebaseUser } = useAuth();
  const [requests, setRequests] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!(permissions?.stock?.returns?.view ?? false) || !firebaseUser) {
      setRequests([]);
      setLoading(false);
      return;
    }

    const currentFirebaseUser = firebaseUser;

    let isMounted = true;

    async function load() {
      try {
        const payload = await fetchReturnRequests(currentFirebaseUser);
        if (isMounted) {
          setRequests(payload.requests);
        }
      } catch (error) {
        console.error("Error fetching return requests:", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [permissions?.stock?.returns?.view, firebaseUser]);

  const addReturnRequest = useCallback(
    async (data: {
      tipo: "devolucao" | "bonificacao";
      insumoId: string;
      lote: string;
      quantidade: number;
      motivo: string;
    }) => {
      if (!firebaseUser) return;

      const payload = await createReturnRequest(firebaseUser, data);
      setRequests((current) =>
        [payload.request, ...current].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )
      );
    },
    [firebaseUser]
  );

  const updateReturnRequest = useCallback(
    async (requestId: string, payload: Partial<ReturnRequest>) => {
      if (!firebaseUser) return;

      const response = await updateReturnRequestRequest(
        firebaseUser,
        requestId,
        payload
      );
      setRequests((current) =>
        current.map((request) =>
          request.id === requestId ? response.request : request
        )
      );
    },
    [firebaseUser]
  );

  const deleteReturnRequest = useCallback(
    async (requestId: string) => {
      if (!firebaseUser) return;

      await deleteReturnRequestRequest(firebaseUser, requestId);
      setRequests((current) =>
        current.filter((request) => request.id !== requestId)
      );
    },
    [firebaseUser]
  );

  const value: ReturnRequestContextType = useMemo(
    () => ({
      requests,
      loading,
      addReturnRequest,
      updateReturnRequest,
      deleteReturnRequest,
    }),
    [requests, loading, addReturnRequest, updateReturnRequest, deleteReturnRequest]
  );

  return (
    <ReturnRequestContext.Provider value={value}>
      {children}
    </ReturnRequestContext.Provider>
  );
}
