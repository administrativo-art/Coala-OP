"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function DPSettingsIndexPage() {
  const router = useRouter();
  const { permissions, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    const target =
      (permissions.dp?.collaborators?.edit || permissions.dp?.collaborators?.terminate)
        ? '/dashboard/dp/settings/collaborators'
        : permissions.dp?.settings?.manageUnits
          ? '/dashboard/dp/settings/units'
          : permissions.dp?.settings?.manageShifts
            ? '/dashboard/dp/settings/shifts'
            : permissions.dp?.settings?.manageCalendars
              ? '/dashboard/dp/settings/calendars'
              : null;

    if (target) {
      router.replace(target);
    }
  }, [loading, permissions, router]);

  if (loading) {
    return <p className="text-sm text-muted-foreground p-6">Carregando configurações do DP...</p>;
  }

  return <p className="text-sm text-muted-foreground p-6">Sem permissão para acessar as configurações do DP.</p>;
}
