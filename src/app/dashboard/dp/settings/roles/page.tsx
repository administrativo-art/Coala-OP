"use client";

import { DPSettingsRoles } from "@/components/dp/dp-settings-roles";
import { useAuth } from "@/hooks/use-auth";

export default function DPSettingsRolesPage() {
  const { permissions } = useAuth();

  if (!permissions.settings?.manageUsers && !permissions.dp?.collaborators?.edit) {
    return (
      <p className="text-muted-foreground p-6">
        Sem permissão para gerenciar cargos e funções.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Este catálogo é paralelo à usabilidade atual. Ele organiza o RH e prepara o organograma sem substituir o modelo atual de permissões.
      </p>
      <DPSettingsRoles />
    </div>
  );
}
