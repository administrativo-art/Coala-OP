"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPFeriasManager } from '@/components/dp/dp-ferias-manager';
import { PageHeader } from '@/components/layout/page-header';

export default function DPFeriasPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.vacation?.viewAll) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Férias.</p>;
  }

  return (
    <div className="system-standard-page space-y-6">
      <PageHeader
        title="Férias"
        description="Do lançamento ao encerramento: acompanhe prazos, aprove períodos e siga a trilha documental de cada colaborador."
      />
      <DPFeriasManager />
    </div>
  );
}
