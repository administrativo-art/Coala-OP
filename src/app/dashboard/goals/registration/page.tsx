"use client";
import { GoalsRegistrationDashboard } from '@/components/goals-registration-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

export default function GoalsRegistrationPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.manage ?? false}>
      <GoalsRegistrationDashboard />
    </PermissionGuard>
  );
}
