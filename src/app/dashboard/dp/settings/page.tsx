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
        ? '/dashboard/settings?department=pessoal&tab=users'
        : (permissions.settings?.manageUsers || permissions.dp?.collaborators?.edit)
          ? '/dashboard/settings?department=pessoal&tab=roles'
        : permissions.dp?.settings?.manageUnits
          ? '/dashboard/settings?department=operacional&tab=units'
        : permissions.dp?.settings?.manageShifts
            ? '/dashboard/settings?department=pessoal&tab=shifts'
            : permissions.dp?.settings?.manageCalendars
              ? '/dashboard/settings?department=pessoal&tab=calendars'
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
