"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from "react";
import { type RepositionActivity, type RepositionContextType } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import {
  cancelRepositionActivityRequest,
  createRepositionActivityRequest,
  fetchRepositionActivities,
  finalizeRepositionActivityRequest,
  revertRepositionActivityRequest,
  updateRepositionActivityRequest,
} from "@/features/reposition/lib/client";

export const RepositionContext = createContext<
  RepositionContextType | undefined
>(undefined);

export function RepositionProvider({ children }: { children: React.ReactNode }) {
  const { user, permissions, firebaseUser } = useAuth();
  const [activities, setActivities] = useState<RepositionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const { optimisticallyUpdateLots } = useExpiryProducts();

  useEffect(() => {
    if (!(permissions?.stock?.analysis?.restock ?? false) || !firebaseUser) {
      setActivities([]);
      setLoading(false);
      return;
    }

    const currentFirebaseUser = firebaseUser;

    let isMounted = true;

    async function load() {
      try {
        const payload = await fetchRepositionActivities(currentFirebaseUser);
        if (isMounted) {
          setActivities(payload.activities);
        }
      } catch (error) {
        console.error("Error fetching reposition activities:", error);
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
  }, [permissions?.stock?.analysis?.restock, firebaseUser]);

  const createRepositionActivity = useCallback(
    async (
      data: Omit<
        RepositionActivity,
        "id" | "status" | "createdAt" | "updatedAt" | "requestedBy" | "updatedBy"
      >
    ): Promise<string | null> => {
      if (!user || !firebaseUser) {
        return null;
      }

      const payload = await createRepositionActivityRequest(firebaseUser, data);
      setActivities((prev) =>
        [payload.activity, ...prev].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );

      const lotUpdates = data.items.flatMap((item) =>
        item.suggestedLots.map((lot) => ({
          lotId: lot.lotId,
          quantityToReserve: lot.quantityToMove,
        }))
      );
      optimisticallyUpdateLots(lotUpdates);

      return payload.activity.id;
    },
    [user, firebaseUser, optimisticallyUpdateLots]
  );

  const updateRepositionActivity = useCallback(
    async (activityId: string, updates: Partial<RepositionActivity>) => {
      if (!firebaseUser) return;

      const response = await updateRepositionActivityRequest(
        firebaseUser,
        activityId,
        updates
      );
      setActivities((prev) =>
        prev.map((activity) =>
          activity.id === activityId ? response.activity : activity
        )
      );
    },
    [firebaseUser]
  );

  const cancelRepositionActivity = useCallback(
    async (activityId: string) => {
      if (!firebaseUser) return;

      const activityToCancel = activities.find((activity) => activity.id === activityId);
      if (
        !activityToCancel ||
        activityToCancel.status === "Concluído" ||
        activityToCancel.status === "Cancelada"
      ) {
        return;
      }

      const response = await cancelRepositionActivityRequest(firebaseUser, activityId);

      const activeStatuses = [
        "Aguardando despacho",
        "Aguardando recebimento",
        "Recebido com divergência",
        "Recebido sem divergência",
      ];

      if (activeStatuses.includes(activityToCancel.status)) {
        const lotUpdates = activityToCancel.items.flatMap((item) =>
          item.suggestedLots.map((lot) => ({
            lotId: lot.lotId,
            quantityToReserve: -lot.quantityToMove,
          }))
        );
        optimisticallyUpdateLots(lotUpdates);
      }

      setActivities((prev) =>
        prev.map((activity) =>
          activity.id === activityId ? response.activity : activity
        )
      );
    },
    [activities, firebaseUser, optimisticallyUpdateLots]
  );

  const finalizeRepositionActivity = useCallback(
    async (
      activity: RepositionActivity,
      resolution: "trust_receipt" | "trust_dispatch" = "trust_receipt"
    ) => {
      if (!firebaseUser) return;

      await finalizeRepositionActivityRequest(firebaseUser, activity.id, resolution);
      const payload = await fetchRepositionActivities(firebaseUser);
      setActivities(payload.activities);
    },
    [firebaseUser]
  );

  const revertRepositionActivity = useCallback(
    async (activityId: string) => {
      if (!firebaseUser) return;

      await revertRepositionActivityRequest(firebaseUser, activityId);
      const payload = await fetchRepositionActivities(firebaseUser);
      setActivities(payload.activities);
    },
    [firebaseUser]
  );

  const value = useMemo(
    () => ({
      activities,
      loading,
      createRepositionActivity,
      updateRepositionActivity,
      cancelRepositionActivity,
      finalizeRepositionActivity,
      revertRepositionActivity,
    }),
    [
      activities,
      loading,
      createRepositionActivity,
      updateRepositionActivity,
      cancelRepositionActivity,
      finalizeRepositionActivity,
      revertRepositionActivity,
    ]
  );

  return (
    <RepositionContext.Provider value={value}>
      {children}
    </RepositionContext.Provider>
  );
}
