"use client";

import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/components/dp-context';
import { useParams } from 'next/navigation';
import { DPScheduleEditor } from '@/components/dp/dp-schedule-editor';

export default function DPScheduleEditorPage() {
  const { permissions } = useAuth();
  const { schedules, schedulesLoading, schedulesError } = useDP();
  const { id } = useParams<{ id: string }>();

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  if (schedulesLoading && schedules.length === 0) {
    return <p className="text-muted-foreground p-6 text-sm">Carregando...</p>;
  }

  if (schedulesError && schedules.length === 0) {
    return <p className="text-destructive p-6 text-sm">Erro ao carregar escala: {schedulesError}</p>;
  }

  const schedule = schedules.find(s => s.id === id);

  if (!schedule) {
    return <p className="text-muted-foreground p-6">Escala não encontrada.</p>;
  }

  return <DPScheduleEditor schedule={schedule} />;
}
