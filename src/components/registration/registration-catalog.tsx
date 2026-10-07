"use client";

import { CadastrosWorkspace, type CadastrosTabId } from '@/components/cadastros/cadastros-workspace';
import { BackButton } from '@/components/navigation/back-button';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';
import { Box } from 'lucide-react';

export type RegistrationCatalogTab = CadastrosTabId;

export function RegistrationCatalog({ defaultTab = 'base' }: { defaultTab?: RegistrationCatalogTab }) {
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.registration.view}>
      <div className="space-y-3 text-[#281f1a]">
          <section className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
            <BackButton
              fallbackHref="/dashboard/settings?department=operacional&tab=cadastros"
              variant="outline"
              iconOnly
              className="h-9 w-9 shrink-0 rounded-lg bg-white text-[#777784]"
              ariaLabel="Voltar para configurações"
            />
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#fde5f0] text-[#a6325b]">
                <Box className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#a6325b]">Configurações</p>
                <h1 className="text-lg font-black tracking-[-.02em] text-[#181820]">Cadastros</h1>
                <p className="text-[11px] font-medium text-[#777784]">Insumos e diretório de pessoas e empresas.</p>
              </div>
            </div>
          </section>

          <CadastrosWorkspace defaultTab={defaultTab} />
      </div>
    </PermissionGuard>
  );
}
