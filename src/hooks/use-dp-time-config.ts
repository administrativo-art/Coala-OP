"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import type { DPAbsenceType, DPJourney, DPOvertimePolicy } from '@/types';

type TimeConfigKind = 'journeys' | 'overtime-policies' | 'absence-types';
type TimeConfigRecord<K extends TimeConfigKind> = K extends 'journeys'
  ? DPJourney
  : K extends 'absence-types'
    ? DPAbsenceType
    : DPOvertimePolicy;

function collectionKey(kind: TimeConfigKind) {
  if (kind === 'journeys') return 'journeys';
  return kind === 'absence-types' ? 'absenceTypes' : 'overtimePolicies';
}

function recordKey(kind: TimeConfigKind) {
  if (kind === 'journeys') return 'journey';
  return kind === 'absence-types' ? 'absenceType' : 'overtimePolicy';
}

export function useDPTimeConfigs<K extends TimeConfigKind>(kind: K, enabled = true) {
  const api = useAuthenticatedApi();
  const [items, setItems] = useState<TimeConfigRecord<K>[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await api<Record<string, unknown>>(`/api/dp/time/${kind}`);
      setItems((payload[collectionKey(kind)] ?? []) as TimeConfigRecord<K>[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as configurações de tempo.');
    } finally {
      setLoading(false);
    }
  }, [api, enabled, kind]);

  useEffect(() => {
    void Promise.resolve().then(reload);
  }, [reload]);

  const create = useCallback(async (data: Record<string, unknown>) => {
    const payload = await api<Record<string, unknown>>(`/api/dp/time/${kind}`, { method: 'POST', json: data });
    const created = payload[recordKey(kind)] as TimeConfigRecord<K>;
    setItems((current) => [created, ...current]);
    return created;
  }, [api, kind]);

  const update = useCallback(async (id: string, data: Record<string, unknown>) => {
    const payload = await api<Record<string, unknown>>(`/api/dp/time/${kind}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: data,
    });
    const updated = payload[recordKey(kind)] as TimeConfigRecord<K>;
    // Publicar uma versão também arquiva a anterior no servidor. Recarregar evita
    // manter duas versões aparentando estar publicadas na mesma sessão.
    await reload();
    return updated;
  }, [api, kind, reload]);

  return { items, loading, error, reload, create, update };
}
