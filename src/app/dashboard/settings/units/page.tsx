"use client";

import { BackButton } from '@/components/navigation/back-button';
import { PermissionGuard } from '@/components/permission-guard';
import { DPRuntimeGuard } from '@/components/dp-runtime-guard';
import { useAuth } from '@/hooks/use-auth';
import dynamic from 'next/dynamic';

const KioskManagement = dynamic(
  () => import('@/components/kiosk-management').then(m => ({ default: m.KioskManagement })),
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
              Gerencie os quiosques e suas integrações com PDV Legal e Bizneo.
            </p>
          </div>
        </div>

        <DPRuntimeGuard area="Unidades">
          <KioskManagement />
        </DPRuntimeGuard>
      </div>
    </PermissionGuard>
  );
}
