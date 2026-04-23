"use client";

import React from "react";

import { useAuth } from "@/hooks/use-auth";
import { fetchHrBootstrap, type HrBootstrapPayload } from "@/features/hr/lib/client";

function canAccessHrSettings(permissions: ReturnType<typeof useAuth>["permissions"]) {
  return !!(
    permissions.settings?.manageUsers ||
    permissions.dp?.collaborators?.edit ||
    permissions.dp?.collaborators?.terminate ||
    permissions.dp?.view
  );
}

export function useHrBootstrap() {
  const { firebaseUser, loading: authLoading, permissions } = useAuth();
  const [data, setData] = React.useState<HrBootstrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!firebaseUser || !canAccessHrSettings(permissions)) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await fetchHrBootstrap(firebaseUser);
      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Falha ao carregar os dados do RH."
      );
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, permissions]);

  React.useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  return {
    roles: data?.roles ?? [],
    functions: data?.functions ?? [],
    access: data?.access ?? { canView: false, canManageCatalog: false },
    loading,
    error,
    refresh,
  };
}
