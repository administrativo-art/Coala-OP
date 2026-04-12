"use client";

import { useAuth } from '@/hooks/use-auth';

export default function DPSettingsShiftsPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.settings?.manageShifts) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar turnos.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">Definições de turno (templates reutilizáveis nas escalas).</p>
      {/* TODO: DPShiftDefinitionsCRUD */}
    </div>
  );
}
