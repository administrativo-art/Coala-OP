"use client";
import { GoalsRegistrationDashboard } from '@/components/goals-registration-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

export default function GoalsRegistrationPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.manage ?? false}>
      <div className="space-y-4">
        <div className="space-y-1 mb-6">
          <h1 className="text-3xl font-bold">Cadastro de Metas</h1>
          <p className="text-sm text-muted-foreground">Gerencie templates e instancie períodos de meta.</p>
        </div>
        <GoalsRegistrationDashboard />
      </div>
    </PermissionGuard>
  );
}
