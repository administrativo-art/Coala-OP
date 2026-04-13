"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPSchedulesList } from '@/components/dp/dp-schedules-list';

export default function DPSchedulesPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Escalas</h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie as escalas mensais de colaboradores.</p>
      </div>
      <DPSchedulesList />
    </div>
  );
}
