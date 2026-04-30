"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDoc,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";

async function parseError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error || "Falha ao carregar documento financeiro.";
  } catch {
    return "Falha ao carregar documento financeiro.";
  }
}

async function loadFinancialDocFallback<T = DocumentData>(path: string) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    throw new Error("Usuário não autenticado para consultar documento financeiro.");
  }

  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    `/api/financial/data?path=${encodeURIComponent(path)}`,
    {
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
  return ((payload?.doc as (T & { id: string }) | null | undefined) ?? null);
}

export function useFinancialDoc<T = DocumentData>(
  reference: DocumentReference<T> | null
) {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refRef = useRef(reference);
  refRef.current = reference;
  const stableKey = reference?.path ?? null;

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    const currentReference = refRef.current;
    if (!currentReference) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const ref = currentReference;

    setLoading(true);
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await getDoc(ref);
        if (cancelled) return;

        setData(snapshot.exists() ? ({ ...(snapshot.data() as T), id: snapshot.id }) : null);
        setError(null);
      } catch (snapshotError) {
        if (ref.path) {
          try {
            const fallbackData = await loadFinancialDocFallback<T>(ref.path);
            if (cancelled) return;
            setData(fallbackData);
            setError(null);
            return;
          } catch (fallbackError) {
            if (cancelled) return;
            setError(
              fallbackError instanceof Error
                ? fallbackError
                : snapshotError instanceof Error
                ? snapshotError
                : new Error("Falha ao carregar documento financeiro.")
            );
            return;
          }
        }

        if (cancelled) return;
        setError(snapshotError instanceof Error ? snapshotError : new Error("Falha ao carregar documento financeiro."));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [stableKey, reloadToken]);

  return { data, loading, error, refresh };
}
