"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPFeriasManager } from '@/components/dp/dp-ferias-manager';

export default function DPFeriasPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.vacation?.viewAll) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Férias.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Férias</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Prioridade de agendamento e período aquisitivo dos colaboradores operacionais. Clique em um card para ver o histórico e agendar.
        </p>
      </div>
      <DPFeriasManager />
    </div>
  );
}
