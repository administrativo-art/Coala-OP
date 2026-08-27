"use client";

import { BackButton } from '@/components/navigation/back-button';
import { PermissionGuard } from '@/components/permission-guard';
import { DPRuntimeGuard } from '@/components/dp-runtime-guard';
import { useAuth } from '@/hooks/use-auth';
import dynamic from 'next/dynamic';

const DPSettingsUnits = dynamic(
  () => import('@/components/dp/dp-settings-units').then(m => ({ default: m.DPSettingsUnits })),
  { ssr: false }
);

export default function UnitsPage() {
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.settings.view}>
      <div className="w-full space-y-6">
        <div className="flex items-center gap-4 mb-2">
          <BackButton
            fallbackHref="/dashboard/settings"
            variant="ghost"
            iconOnly
            className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
          />
          <div>
            <h1 className="text-3xl font-bold">Unidades</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie unidades operacionais, grupos e integrações principais.
            </p>
          </div>
        </div>

        <DPRuntimeGuard area="Unidades">
          <DPSettingsUnits />
        </DPRuntimeGuard>
      </div>
    </PermissionGuard>
  );
}
