"use client";

import { useState } from 'react';
import { useDP } from '@/components/dp-context';
import { DPSettingsCalendars } from '@/components/dp/dp-settings-calendars';
import { DPCalendarHolidays } from '@/components/dp/dp-calendar-holidays';

export function CalendarManagement() {
  const { calendars, calendarsLoading } = useDP();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? calendars.find(c => c.id === selectedId) ?? null : null;

  if (calendarsLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

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
