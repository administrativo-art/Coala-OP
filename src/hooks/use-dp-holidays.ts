"use client";

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import type { DPHoliday } from '@/types';

export function useDPHolidays(calendarId: string | null) {
  const [holidays, setHolidays] = useState<DPHoliday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!calendarId) { setHolidays([]); setLoading(false); return; }

    setLoading(true);
    return onSnapshot(
      query(collection(db, 'dp_calendars', calendarId, 'holidays'), orderBy('date')),
      (snap) => {
        setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as DPHoliday)));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [calendarId]);

  return { holidays, loading };
}
