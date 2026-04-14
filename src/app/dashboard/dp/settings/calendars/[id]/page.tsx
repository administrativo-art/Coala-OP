"use client";

import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/components/dp-provider';
import { useParams } from 'next/navigation';
import { DPCalendarHolidays } from '@/components/dp/dp-calendar-holidays';

export default function DPSettingsCalendarHolidaysPage() {
  const { permissions } = useAuth();
  const { calendars, calendarsLoading } = useDP();
  const { id } = useParams<{ id: string }>();

  if (!permissions.dp?.settings?.manageCalendars) {
    return <p className="text-muted-foreground p-6">Sem permissão para gerenciar feriados.</p>;
  }

  if (calendarsLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Carregando...</p>;
  }

  const calendar = calendars.find(c => c.id === id);
  if (!calendar) {
    return <p className="text-muted-foreground p-6">Calendário não encontrado.</p>;
  }

  return <DPCalendarHolidays calendar={calendar} />;
}
