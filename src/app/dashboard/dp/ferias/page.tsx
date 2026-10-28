"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPFeriasManager } from '@/components/dp/dp-ferias-manager';

export default function DPFeriasPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.vacation?.viewAll) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Férias.</p>;
  }

  return (
    <div className="system-standard-page">
      <DPFeriasManager />
    </div>
  );
}
