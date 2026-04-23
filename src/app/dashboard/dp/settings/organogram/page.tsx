"use client";

import { DPOrgChart } from "@/components/dp/dp-org-chart";
import { useAuth } from "@/hooks/use-auth";

export default function DPSettingsOrganogramPage() {
  const { permissions } = useAuth();

  if (
    !permissions.settings?.manageUsers &&
    !permissions.dp?.collaborators?.edit &&
    !permissions.dp?.collaborators?.terminate
  ) {
    return (
      <p className="p-6 text-muted-foreground">
        Sem permissão para acessar o organograma do RH.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Esta visualização é paralela à usabilidade atual. Ela usa cargos e vínculos dos colaboradores sem substituir o modelo atual de permissões.
      </p>
      <DPOrgChart />
    </div>
  );
}
