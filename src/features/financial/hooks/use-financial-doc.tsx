"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDoc,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";

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
