"use client";

import { useState } from 'react';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { DPSettingsCalendars } from '@/components/dp/dp-settings-calendars';
import { DPCalendarHolidays } from '@/components/dp/dp-calendar-holidays';

export function CalendarManagement() {
  const { calendars, loading: calendarsLoading, error } = useDPBootstrap();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? calendars.find(c => c.id === selectedId) ?? null : null;

  if (calendarsLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (error) return <p className="text-sm text-destructive">Erro ao carregar calendários: {error}</p>;

  if (selected) {
    return (
      <DPCalendarHolidays
        calendar={selected}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <DPSettingsCalendars onSelect={setSelectedId} />
  );
}
