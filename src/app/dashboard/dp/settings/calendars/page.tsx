"use client";

import { useAuth } from '@/hooks/use-auth';
import { DPSettingsCalendars } from '@/components/dp/dp-settings-calendars';

export default function DPSettingsCalendarsPage() {
  const { permissions } = useAuth();

  if (!permissions.dp?.settings?.manageCalendars) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar calendários.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">Calendários de feriados por estado e município.</p>
      <DPSettingsCalendars />
    </div>
  );
}
