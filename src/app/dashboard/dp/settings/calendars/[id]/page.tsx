"use client";

import { useAuth } from '@/hooks/use-auth';
import { useParams } from 'next/navigation';

export default function DPSettingsCalendarHolidaysPage() {
  const { permissions } = useAuth();
  const { id } = useParams<{ id: string }>();

  if (!permissions.dp?.settings?.manageCalendars) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar feriados.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">Feriados do calendário {id}.</p>
      {/* TODO: DPHolidaysCRUD */}
    </div>
  );
}
