"use client";

import { use } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { DPFeriasProfile } from '@/components/dp/dp-ferias-profile';

interface Props {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
}

export default function DPFeriasUserPage({ params, searchParams }: Props) {
  const { userId } = use(params);
  const { action } = use(searchParams);
  const { permissions } = useAuth();

  if (!permissions.dp?.vacation?.viewAll) {
    return <p className="text-muted-foreground p-6">Sem permissão.</p>;
  }

  return <DPFeriasProfile userId={userId} initialRegistrationOpen={action === 'register'} />;
}
