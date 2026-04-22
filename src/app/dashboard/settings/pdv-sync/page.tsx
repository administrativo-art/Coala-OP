"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PermissionGuard } from "@/components/permission-guard";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { PdvSyncManagement } from "@/components/pdv-sync-management";

export default function PdvSyncSettingsPage() {
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
            <h1 className="text-3xl font-bold">Sincronização PDV</h1>
            <p className="text-sm text-muted-foreground">
              Reprocesse dados históricos do PDV Legal e acompanhe o andamento por quiosque.
            </p>
          </div>
        </div>

        <PdvSyncManagement />
      </div>
    </PermissionGuard>
  );
}
