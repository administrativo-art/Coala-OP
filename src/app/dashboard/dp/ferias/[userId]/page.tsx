"use client";

import { use } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { DPFeriasProfile } from '@/components/dp/dp-ferias-profile';

interface Props {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{
    vacation?: string | string[];
  }>;
}

export default function DPFeriasUserPage({ params, searchParams }: Props) {
  const { userId } = use(params);
  const { vacation } = use(searchParams);
  const { permissions } = useAuth();

  if (!permissions.dp?.vacation?.viewAll) {
    return <p className="text-muted-foreground p-6">Sem permissão.</p>;
  }

  return (
    <DPFeriasProfile
      userId={userId}
      initialWorkflowVacationId={typeof vacation === 'string' ? vacation : undefined}
    />
  );
}
