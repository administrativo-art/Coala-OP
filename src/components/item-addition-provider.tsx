"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from "react";
import { type ItemAdditionRequest } from "@/types";
import { useProfiles } from "@/hooks/use-profiles";
import { useAuth } from "@/hooks/use-auth";
import {
  createItemRequest,
  deleteItemRequest,
  fetchItemRequests,
  updateItemRequestStatus,
} from "@/features/item-requests/lib/client";

export interface ItemAdditionContextType {
  requests: ItemAdditionRequest[];
  loading: boolean;
  addRequest: (
    data: Partial<
      Omit<
        ItemAdditionRequest,
        "id" | "kioskName" | "requestedBy" | "status" | "createdAt" | "taskId"
      >
    >
  ) => Promise<void>;
  updateRequestStatus: (
    requestId: string,
    status: "completed" | "rejected"
  ) => Promise<void>;
  deleteRequest: (requestId: string) => Promise<void>;
}

export const ItemAdditionContext = createContext<
  ItemAdditionContextType | undefined
>(undefined);

export function ItemAdditionProvider({ children }: { children: React.ReactNode }) {
  const { adminProfileId } = useProfiles();
  const { firebaseUser } = useAuth();
  const [requests, setRequests] = useState<ItemAdditionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseUser) {
      setRequests([]);
      setLoading(false);
      return;
    }

    const currentFirebaseUser = firebaseUser;

    let isMounted = true;

    async function load() {
      try {
        const payload = await fetchItemRequests(currentFirebaseUser);
        if (isMounted) {
          setRequests(payload.requests);
        }
      } catch (error) {
        console.error("Error fetching item addition requests:", error);
        if (isMounted) {
          setRequests([]);
        }
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
  }, [firebaseUser]);

  const addRequest = useCallback(
    async (
      data: Partial<
        Omit<
          ItemAdditionRequest,
          "id" | "kioskName" | "requestedBy" | "status" | "createdAt" | "taskId"
        >
      >
    ) => {
      if (!firebaseUser) return;

      const payload = await createItemRequest(firebaseUser, {
        ...data,
        assigneeProfileId: adminProfileId,
      });
      setRequests((current) =>
        [payload.request, ...current].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
    },
    [adminProfileId, firebaseUser]
  );

  const updateRequestStatus = useCallback(
    async (requestId: string, status: "completed" | "rejected") => {
      if (!firebaseUser) return;

      const payload = await updateItemRequestStatus(firebaseUser, requestId, status);
      setRequests((current) =>
        current.map((request) =>
          request.id === requestId ? payload.request : request
        )
      );
    },
    [firebaseUser]
  );

  const deleteRequest = useCallback(
    async (requestId: string) => {
      if (!firebaseUser) return;

      await deleteItemRequest(firebaseUser, requestId);
      setRequests((current) =>
        current.filter((request) => request.id !== requestId)
      );
    },
    [firebaseUser]
  );

  const value: ItemAdditionContextType = useMemo(
    () => ({
      requests,
      loading,
      addRequest,
      updateRequestStatus,
      deleteRequest,
    }),
    [requests, loading, addRequest, updateRequestStatus, deleteRequest]
  );

  return (
    <ItemAdditionContext.Provider value={value}>
      {children}
    </ItemAdditionContext.Provider>
  );
}
