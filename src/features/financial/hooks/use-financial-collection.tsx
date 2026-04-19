"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocs,
  type CollectionReference,
  type DocumentData,
  type Query,
} from "firebase/firestore";

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
