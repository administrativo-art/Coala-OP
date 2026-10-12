"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { GoalsAnalysisDashboard } from '@/components/goals-analysis-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

function AnalysisContent() {
  const tab = useSearchParams().get('tab');
  return <GoalsAnalysisDashboard initialTab={tab === 'closures' ? 'closures' : 'overview'} />;
}

export default function GoalsAnalysisPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <Suspense fallback={null}>
        <AnalysisContent />
      </Suspense>
    </PermissionGuard>
  );
}
