"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";

type FinancialBootstrapUser = {
  id: string;
  email?: string;
  username?: string;
  profileId?: string;
  permissions?: Record<string, unknown>;
  syncedAt?: string;
  active?: boolean;
};

type FinancialContextValue = {
  ready: boolean;
  syncing: boolean;
  error: string | null;
  user: FinancialBootstrapUser | null;
  refresh: () => Promise<void>;
};

const FinancialContext = createContext<FinancialContextValue | undefined>(undefined);

async function parseError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error || "Falha ao sincronizar o módulo financeiro.";
  } catch {
    return "Falha ao sincronizar o módulo financeiro.";
  }
}

export function FinancialProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, permissions, loading } = useAuth();
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<FinancialBootstrapUser | null>(null);

  const bootstrap = useCallback(async () => {
    if (!firebaseUser || !permissions.financial?.view) return;

    setSyncing(true);
    setError(null);

    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetchWithTimeout(
        "/api/financial/bootstrap",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
        20000
      );

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const payload = await response.json();
      if (payload.claimsSynced === "updated") {
        await firebaseUser.getIdToken(true);
      }
      setUser(payload.user ?? null);
      setReady(true);
    } catch (syncError) {
      const message =
        syncError instanceof Error
          ? syncError.message
          : "Falha ao sincronizar o módulo financeiro.";
      setError(message);
      setReady(false);
    } finally {
      setSyncing(false);
    }
  }, [firebaseUser, permissions.financial?.view]);

  useEffect(() => {
    if (loading) return;

    if (!firebaseUser || !permissions.financial?.view) {
      setReady(false);
      setUser(null);
      setError(null);
      return;
    }

    void bootstrap();
  }, [bootstrap, firebaseUser, loading, permissions.financial?.view]);

  const value = useMemo<FinancialContextValue>(
    () => ({
      ready,
      syncing,
      error,
      user,
      refresh: bootstrap,
    }),
    [bootstrap, error, ready, syncing, user]
  );

  if (loading || syncing) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <FinancialContext.Provider value={value}>
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-amber-800">
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold sm:justify-start">
                <AlertCircle className="h-4 w-4" />
                Sincronização auxiliar do financeiro indisponível
              </div>
              <p className="text-sm">
                O módulo continuará tentando carregar os dados. Detalhe: {error}
              </p>
            </div>
          </div>
        )}
        {children}
      </div>
    </FinancialContext.Provider>
  );
}

export function useFinancialModule() {
  const context = useContext(FinancialContext);
  if (!context) {
    throw new Error("useFinancialModule must be used within FinancialProvider");
  }
  return context;
}
