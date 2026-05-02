"use client";
import { GoalsRegistrationDashboard } from '@/components/goals-registration-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

export default function GoalsRegistrationPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.manage ?? false}>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-black tracking-tight">Cadastro de Metas</h1>
          <p className="text-sm text-muted-foreground">Gerencie períodos ativos, sincronização e replicação mensal no mesmo fluxo.</p>
        </div>
        <GoalsRegistrationDashboard />
      </div>
    </PermissionGuard>
  );
}
