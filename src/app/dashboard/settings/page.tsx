"use client";

import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { PermissionGuard } from "@/components/permission-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import dynamic from 'next/dynamic';

const UserManagement      = dynamic(() => import('@/components/user-management').then(m => m.UserManagement), { ssr: false });
const KioskManagement     = dynamic(() => import('@/components/kiosk-management').then(m => m.KioskManagement), { ssr: false });
const CalendarManagement  = dynamic(() => import('@/components/calendar-management').then(m => m.CalendarManagement), { ssr: false });
const PdvSyncManagement   = dynamic(() => import('@/components/pdv-sync-management').then(m => m.PdvSyncManagement), { ssr: false });
const FinancialProvider   = dynamic(() => import('@/features/financial/components/financial-provider').then(m => m.FinancialProvider), { ssr: false });
const FinancialSettingsPage = dynamic(() => import('@/features/financial/pages/settings-page').then(m => m.FinancialSettingsPage), { ssr: false });

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 border-b pb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center text-muted-foreground">
      <Settings2 className="h-8 w-8 opacity-30" />
      <p className="text-sm font-medium">Configurações de {label}</p>
      <p className="text-xs opacity-60">Em breve disponíveis aqui.</p>
    </div>
  );
}

export default function SettingsPage() {
  const { permissions } = useAuth();
  const router = useRouter();

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
            <h1 className="text-3xl font-bold">Configurações</h1>
            <p className="text-sm text-muted-foreground">Gerencie as configurações de cada departamento.</p>
          </div>
        </div>

        <Tabs defaultValue="operacional">
          <TabsList className="flex w-full overflow-x-auto">
            <TabsTrigger value="operacional" className="flex-shrink-0">Operacional</TabsTrigger>
            <TabsTrigger value="comercial"   className="flex-shrink-0">Comercial</TabsTrigger>
            <TabsTrigger value="pessoal"     className="flex-shrink-0">Pessoal</TabsTrigger>
            <TabsTrigger value="financeiro"  className="flex-shrink-0">Financeiro</TabsTrigger>
          </TabsList>

          {/* ── Operacional ───────────────────────────────────── */}
          <TabsContent value="operacional" className="mt-6 space-y-10">
            <div>
              <SectionHeader
                title="Unidades e Kiosks"
                description="Gerencie as unidades operacionais do sistema."
              />
              <KioskManagement />
            </div>
            <div>
              <SectionHeader
                title="Sincronização PDV"
                description="Configure a integração com o ponto de venda."
              />
              <PdvSyncManagement />
            </div>
          </TabsContent>

          {/* ── Comercial ─────────────────────────────────────── */}
          <TabsContent value="comercial" className="mt-6">
            <EmptySection label="Comercial" />
          </TabsContent>

          {/* ── Pessoal ───────────────────────────────────────── */}
          <TabsContent value="pessoal" className="mt-6 space-y-10">
            <div>
              <SectionHeader
                title="Usuários e Perfis"
                description="Gerencie os usuários e permissões de acesso ao sistema."
              />
              <UserManagement />
            </div>
            <div>
              <SectionHeader
                title="Calendários de Trabalho"
                description="Configure os calendários usados nas escalas do departamento pessoal."
              />
              <CalendarManagement />
            </div>
          </TabsContent>

          {/* ── Financeiro ────────────────────────────────────── */}
          <TabsContent value="financeiro" className="mt-6">
            <FinancialProvider>
              <FinancialSettingsPage />
            </FinancialProvider>
          </TabsContent>
        </Tabs>
      </div>
    </PermissionGuard>
  );
}
