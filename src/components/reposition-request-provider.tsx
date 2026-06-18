"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { type RepositionRequest, type RepositionRequestContextType } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import {
  createRepositionRequest,
  fetchRepositionRequests,
  updateRepositionRequestRequest,
} from "@/features/reposition-requests/lib/client";

export const RepositionRequestContext = createContext<
  RepositionRequestContextType | undefined
>(undefined);

export function RepositionRequestProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions, firebaseUser } = useAuth();
  const [requests, setRequests] = useState<RepositionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshRepositionRequests = useCallback(async () => {
    if (!firebaseUser) return;
    const payload = await fetchRepositionRequests(firebaseUser);
    setRequests(payload.requests);
  }, [firebaseUser]);

  useEffect(() => {
    const isRepositionRoute = pathname?.startsWith("/dashboard/stock/analysis");
    if (!isRepositionRoute || !(permissions?.stock?.analysis?.restock ?? false) || !firebaseUser) {
      setRequests([]);
      setLoading(false);
      return;
    }

    const currentFirebaseUser = firebaseUser;
    let isMounted = true;
    setLoading(true);

    async function load() {
      try {
        const payload = await fetchRepositionRequests(currentFirebaseUser);
        if (isMounted) setRequests(payload.requests);
      } catch (error) {
        console.error("Error fetching reposition requests:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void load();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname, permissions?.stock?.analysis?.restock, firebaseUser]);

  const createRequest = useCallback(
    async (data: Pick<RepositionRequest, "kioskId" | "kioskName" | "items" | "notes">) => {
      if (!firebaseUser) return null;
      const payload = await createRepositionRequest(firebaseUser, data);
      setRequests((current) =>
        [payload.request, ...current].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )
      );
      return payload.request.id;
    },
    [firebaseUser]
  );

  const updateRequest = useCallback(
    async (requestId: string, updates: Partial<RepositionRequest>) => {
      if (!firebaseUser) return;
      const payload = await updateRepositionRequestRequest(firebaseUser, requestId, updates);
      setRequests((current) =>
        current.map((request) => (request.id === requestId ? payload.request : request))
      );
    },
    [firebaseUser]
  );

  const value = useMemo(
    () => ({
      requests,
      loading,
      createRepositionRequest: createRequest,
      updateRepositionRequest: updateRequest,
      refreshRepositionRequests,
    }),
    [requests, loading, createRequest, updateRequest, refreshRepositionRequests]
  );

  return (
    <RepositionRequestContext.Provider value={value}>
      {children}
    </RepositionRequestContext.Provider>
  );
}
