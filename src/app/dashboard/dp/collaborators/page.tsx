"use client";

import { useAuth } from '@/hooks/use-auth';

export default function DPCollaboratorsPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.collaborators?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar Colaboradores.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Colaboradores</h1>
        <p className="text-muted-foreground text-sm mt-1">Diretório de colaboradores ativos e inativos.</p>
      </div>
      {/* TODO: DPCollaboratorsTable */}
    </div>
  );
}
