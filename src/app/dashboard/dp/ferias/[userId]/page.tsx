"use client";

import { use } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { DPFeriasProfile } from '@/components/dp/dp-ferias-profile';

interface Props {
  params: Promise<{ userId: string }>;
}

export default function DPFeriasUserPage({ params }: Props) {
  const { userId } = use(params);
  const { permissions } = useAuth();

  if (!permissions.dp?.vacation?.viewAll) {
    return <p className="text-muted-foreground p-6">Sem permissão.</p>;
  }

  return <DPFeriasProfile userId={userId} />;
}
