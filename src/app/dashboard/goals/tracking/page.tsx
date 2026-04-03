"use client";
import { GoalsTrackingDashboard } from '@/components/goals-tracking-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

export default function GoalsTrackingPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <div className="space-y-4">
        <div className="space-y-1 mb-6">
          <h1 className="text-3xl font-bold">Acompanhamento de Metas</h1>
          <p className="text-sm text-muted-foreground">Visualize o progresso das metas do seu quiosque.</p>
        </div>
        <GoalsTrackingDashboard />
      </div>
    </PermissionGuard>
  );
}
