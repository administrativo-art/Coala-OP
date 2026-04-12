"use client";

import { useAuth } from '@/hooks/use-auth';

export default function DPSettingsUnitsPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.settings?.manageUnits) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar unidades.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">Unidades e grupos de unidades.</p>
      {/* TODO: DPUnitsCRUD */}
    </div>
  );
}
