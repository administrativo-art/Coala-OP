import { useState, useCallback } from 'react';
import { type EffectiveCostEntry } from '@/types';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import { WORKSPACE_ID } from '@/lib/workspace';

interface Filters {
  baseItemId?: string;
  supplierId?: string;
  limitCount?: number;
}

export function useEffectiveCosts() {
  const [entries, setEntries] = useState<EffectiveCostEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCosts = useCallback(async (filters: Filters = {}) => {
    setLoading(true);
    try {
      let q = query(
        collection(db, PURCHASING_COLLECTIONS.effectiveCostHistory),
        where('workspaceId', '==', WORKSPACE_ID),
        orderBy('occurredAt', 'desc'),
        limit(filters.limitCount ?? 150),
      );

      const snap = await getDocs(q);
      let data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EffectiveCostEntry));

      // client-side filter (avoids composite index for optional fields)
      if (filters.baseItemId) data = data.filter((e) => e.baseItemId === filters.baseItemId);
      if (filters.supplierId) data = data.filter((e) => e.supplierId === filters.supplierId);

      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, []);

  return { entries, loading, fetchCosts };
}
