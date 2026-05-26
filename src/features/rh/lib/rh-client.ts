'use client';

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export async function callOnFieldUpdate(params: {
  employee_id: string;
  field_key:   string;
  value:       unknown;
}): Promise<{ success: boolean; profile_completion: number }> {
  const call = httpsCallable<typeof params, { success: boolean; profile_completion: number }>(
    functions,
    'onFieldUpdate'
  );
  const result = await call(params);
  return result.data;
}

export async function callManualSync(): Promise<{
  employee_count: number;
  updated_count:  number;
  error_count:    number;
  errors:         string[];
}> {
  const call = httpsCallable(functions, 'manualSyncFromBizneo');
  const result = await call({});
  return result.data as ReturnType<typeof callManualSync> extends Promise<infer T> ? T : never;
}
