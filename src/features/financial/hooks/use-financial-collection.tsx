"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocs,
  type CollectionReference,
  type DocumentData,
  type Query,
} from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";

async function parseError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error || "Falha ao carregar dados financeiros.";
  } catch {
    return "Falha ao carregar dados financeiros.";
  }
}

async function loadFinancialCollectionFallback<T = DocumentData>(path: string) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    throw new Error("Usuário não autenticado para consultar dados financeiros.");
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
  return ((payload?.docs as (T & { id: string })[] | undefined) ?? []);
}

export function useFinancialCollection<T = DocumentData>(
  reference: Query<T> | CollectionReference<T> | null
) {
  const [data, setData] = useState<(T & { id: string })[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refRef = useRef(reference);
  refRef.current = reference;

  const stableKey: unknown =
    reference && "path" in (reference as object)
      ? (reference as unknown as CollectionReference).path
      : reference;

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
        const snapshot = await getDocs(ref);
        if (cancelled) return;

        setData(snapshot.docs.map((doc) => ({ ...(doc.data() as T), id: doc.id })));
        setError(null);
      } catch (snapshotError) {
        const path =
          ref && "path" in (ref as object)
            ? (ref as unknown as CollectionReference<T>).path
            : null;

        if (path) {
          try {
            const fallbackData = await loadFinancialCollectionFallback<T>(path);
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
                : new Error("Falha ao carregar dados financeiros.")
            );
            return;
          }
        }

        if (cancelled) return;
        setError(snapshotError instanceof Error ? snapshotError : new Error("Falha ao carregar dados financeiros."));
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
