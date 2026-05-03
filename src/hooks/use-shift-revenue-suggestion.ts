import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { SalesReport } from '@/types';

function formatIdDate(d: Date): string {
  return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`;
}

export function useShiftRevenueSalesReports(kioskId: string | null) {
  const [reports, setReports] = useState<SalesReport[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!kioskId) {
      setReports([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const today = new Date();
    const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());

    const startId = `sales_sync_${kioskId}_${formatIdDate(threeMonthsAgo)}`;
    const endId = `sales_sync_${kioskId}_${formatIdDate(today)}￿`;

    getDocs(
      query(
        collection(db, 'salesReports'),
        where(documentId(), '>=', startId),
        where(documentId(), '<=', endId)
      )
    )
      .then(snap => {
        if (!cancelled) {
          setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as SalesReport)));
        }
      })
      .catch(err => {
        console.warn('[useShiftRevenueSalesReports]', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [kioskId]);

  return { reports, loading };
}
