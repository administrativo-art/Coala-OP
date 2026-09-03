"use client";

import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { DPScheduleMonthView } from '@/components/dp/dp-schedule-month-view';

export default function DPScheduleMonthPage() {
  const { permissions } = useAuth();
  const { period } = useParams<{ period: string }>();

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  const match = /^(\d{4})-(\d{2})$/.exec(period ?? '');
  if (!match) {
    return <p className="text-muted-foreground p-6">Período inválido.</p>;
  }

  return <DPScheduleMonthView year={Number(match[1])} month={Number(match[2])} />;
}
