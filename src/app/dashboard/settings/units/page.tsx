"use client";

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

const KioskManagement = dynamic(
  () => import('@/components/kiosk-management').then(m => ({ default: m.KioskManagement })),
  { ssr: false }
);

export default function UnitsPage() {
  const router = useRouter();
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.settings.view}>
      <div className="w-full space-y-6">
        <div className="flex items-center gap-4 mb-2">
          <Button
            onClick={() => router.back()}
            variant="ghost"
            className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Unidades</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie os quiosques e suas integrações com PDV Legal e Bizneo.
            </p>
          </div>
        </div>

        <KioskManagement />
      </div>
    </PermissionGuard>
  );
}
