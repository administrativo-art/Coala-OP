"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/components/dp-context';
import { useParams } from 'next/navigation';
import { DPScheduleEditor } from '@/components/dp/dp-schedule-editor';
import { fetchSchedule } from '@/features/dp/schedules/client';
import type { DPSchedule } from '@/types';

export default function DPScheduleEditorPage() {
  const { permissions } = useAuth();
  const { schedules, schedulesLoading, schedulesError } = useDP();
  const { id } = useParams<{ id: string }>();
  const storedSchedule = schedules.find((schedule) => schedule.id === id);
  const [loadedSchedule, setLoadedSchedule] = useState<DPSchedule | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (!permissions.dp?.schedules?.view || schedulesLoading || storedSchedule || loadedSchedule || lookupError) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLookupLoading(true);
      return fetchSchedule(id);
    }).then((schedule) => {
      if (!cancelled) setLoadedSchedule(schedule);
    }).catch((error) => {
      if (!cancelled) setLookupError(error instanceof Error ? error.message : 'Escala não encontrada.');
    }).finally(() => {
      if (!cancelled) setLookupLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, loadedSchedule, lookupError, permissions.dp?.schedules?.view, schedulesLoading, storedSchedule]);

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  if ((schedulesLoading && schedules.length === 0) || lookupLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Carregando...</p>;
  }

  if (schedulesError && schedules.length === 0) {
    return <p className="text-destructive p-6 text-sm">Erro ao carregar escala: {schedulesError}</p>;
  }

  const schedule = storedSchedule ?? loadedSchedule;

  if (!schedule) {
    return <p className="text-muted-foreground p-6">{lookupError ?? 'Escala não encontrada.'}</p>;
  }

  return <DPScheduleEditor schedule={schedule} />;
}
