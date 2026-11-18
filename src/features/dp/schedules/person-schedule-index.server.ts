import 'server-only';

import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { AppError } from '@/lib/observability/app-error';

export function personScheduleIndexRefs(db: Firestore, userId: string, competence: string) {
  const key = `${userId}:${competence}`;
  const collection = db.collection('dp_personScheduleIndex');
  const ref = (value: string) => collection.doc(createHash('sha256').update(value).digest('hex'));
  // Earlier publications hashed the JSON string, while operational writes used the raw key.
  return [ref(key), ref(JSON.stringify(key))] as const;
}

export function indexedPersonScheduleIds(documents: DocumentSnapshot[], userId: string, competence: string, limit: number) {
  const ids = new Set<string>();
  const invalid = () => new AppError({ code: 'DP_PERSON_SCHEDULE_INDEX_INVALID', kind: 'DATA_INTEGRITY',
    safeMessage: 'O índice de escalas da pessoa está inconsistente.' });
  for (const document of documents) {
    if (!document.exists) continue;
    const scheduleIds = document.get('scheduleIds');
    if (document.get('userId') !== userId || document.get('competence') !== competence
      || !Array.isArray(scheduleIds) || scheduleIds.length > limit) throw invalid();
    for (const scheduleId of scheduleIds) {
      if (typeof scheduleId !== 'string' || !scheduleId || scheduleId.includes('/')) throw invalid();
      ids.add(scheduleId);
    }
  }
  if (ids.size > limit) throw invalid();
  return [...ids];
}
