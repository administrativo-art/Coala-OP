"use client";

import { useAuth } from '@/hooks/use-auth';
import { useParams } from 'next/navigation';

export default function DPScheduleEditorPage() {
  const { permissions } = useAuth();
  const { id } = useParams<{ id: string }>();

  if (!permissions.dp?.schedules?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Escalas.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Editor de Escala</h1>
        <p className="text-muted-foreground text-sm mt-1">ID: {id}</p>
      </div>
      {/* TODO: DPScheduleEditor */}
    </div>
  );
}
