"use client";

import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { DPScheduleMonthView } from '@/components/dp/dp-schedule-month-view';
import { parseDPSchedulePeriod } from '@/lib/dp-schedule-periods';

export default function DPScheduleMonthPage() {
  const { permissions } = useAuth();
  const { period } = useParams<{ period: string }>();

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  const parsedPeriod = parseDPSchedulePeriod(period ?? '');
  if (!parsedPeriod) {
    return <p className="text-muted-foreground p-6">Período inválido.</p>;
  }

  return <DPScheduleMonthView year={parsedPeriod.year} month={parsedPeriod.month} />;
}
