"use client";

import { useAuth } from '@/hooks/use-auth';

export default function DPSettingsCollaboratorsPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.collaborators?.add) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar colaboradores.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">Cadastro e gestão de colaboradores.</p>
      {/* TODO: DPCollaboratorsCRUD */}
    </div>
  );
}
