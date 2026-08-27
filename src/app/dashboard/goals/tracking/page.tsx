"use client";
import { GoalsTrackingDashboard } from '@/components/goals-tracking-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

export default function GoalsTrackingPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <div>
        <GoalsTrackingDashboard />
      </div>
    </PermissionGuard>
  );
}
