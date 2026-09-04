"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPSchedulesList } from '@/components/dp/dp-schedules-list';

export default function DPSchedulesPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  return <DPSchedulesList />;
}
