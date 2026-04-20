"use client";

import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { PermissionGuard } from "@/components/permission-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import dynamic from 'next/dynamic';

const UserManagement = dynamic(() => import('@/components/user-management').then(mod => mod.UserManagement), { ssr: false });
const KioskManagement = dynamic(() => import('@/components/kiosk-management').then(mod => mod.KioskManagement), { ssr: false });
const CalendarManagement = dynamic(() => import('@/components/calendar-management').then(mod => mod.CalendarManagement), { ssr: false });
const PdvSyncManagement = dynamic(() => import('@/components/pdv-sync-management').then(mod => mod.PdvSyncManagement), { ssr: false });
const FinancialProvider = dynamic(() => import('@/features/financial/components/financial-provider').then(mod => mod.FinancialProvider), { ssr: false });
const FinancialSettingsPage = dynamic(() => import('@/features/financial/pages/settings-page').then(mod => mod.FinancialSettingsPage), { ssr: false });

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
                        <p className="text-sm text-muted-foreground">Gerencie usuários, perfis e outras configurações do sistema.</p>
                    </div>
                </div>

                <Tabs defaultValue="usuarios">
                    <TabsList className="flex w-full overflow-x-auto">
                        <TabsTrigger value="usuarios" className="flex-shrink-0">Usuários</TabsTrigger>
                        <TabsTrigger value="unidades" className="flex-shrink-0">Unidades</TabsTrigger>
                        <TabsTrigger value="calendarios" className="flex-shrink-0">Calendários</TabsTrigger>
                        <TabsTrigger value="sincronizacao" className="flex-shrink-0">Sincronização PDV</TabsTrigger>
                        <TabsTrigger value="financeiro" className="flex-shrink-0">Financeiro</TabsTrigger>
                    </TabsList>

                    <TabsContent value="usuarios" className="mt-4">
                        <UserManagement />
                    </TabsContent>

                    <TabsContent value="unidades" className="mt-4">
                        <KioskManagement />
                    </TabsContent>

                    <TabsContent value="calendarios" className="mt-4">
                        <CalendarManagement />
                    </TabsContent>

                    <TabsContent value="sincronizacao" className="mt-4">
                        <PdvSyncManagement />
                    </TabsContent>

                    <TabsContent value="financeiro" className="mt-4">
                        <FinancialProvider>
                            <FinancialSettingsPage />
                        </FinancialProvider>
                    </TabsContent>
                </Tabs>
            </div>
        </PermissionGuard>
    );
}

