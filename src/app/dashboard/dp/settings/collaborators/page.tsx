"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPCollaboratorsManager } from '@/components/dp/dp-collaborators-manager';

export default function DPSettingsCollaboratorsPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.collaborators?.edit && !permissions.dp?.collaborators?.terminate) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar colaboradores.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Edite os dados do Departamento Pessoal de cada colaborador. Para desligar um colaborador, use o menu de ações.
      </p>
      <DPCollaboratorsManager />
    </div>
  );
}
