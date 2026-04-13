"use client";

import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DPRuntimeGuard } from '@/components/dp-runtime-guard';
import { ArrowLeft } from 'lucide-react';
import { PermissionGuard } from "@/components/permission-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserManagement } from '@/components/user-management';
import { KioskManagement } from '@/components/kiosk-management';
import { CalendarManagement } from '@/components/calendar-management';
import { PdvSyncManagement } from '@/components/pdv-sync-management';

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
                    <TabsList>
                        <TabsTrigger value="usuarios">Usuários</TabsTrigger>
                        <TabsTrigger value="unidades">Unidades</TabsTrigger>
                        <TabsTrigger value="calendarios">Calendários</TabsTrigger>
                        <TabsTrigger value="sincronizacao">Sincronização PDV</TabsTrigger>
                    </TabsList>

                    <TabsContent value="usuarios" className="mt-4">
                        <DPRuntimeGuard area="Usuários">
                            <UserManagement />
                        </DPRuntimeGuard>
                    </TabsContent>

                    <TabsContent value="unidades" className="mt-4">
                        <DPRuntimeGuard area="Unidades">
                            <KioskManagement />
                        </DPRuntimeGuard>
                    </TabsContent>

                    <TabsContent value="calendarios" className="mt-4">
                        <DPRuntimeGuard area="Calendários">
                            <CalendarManagement />
                        </DPRuntimeGuard>
                    </TabsContent>

                    <TabsContent value="sincronizacao" className="mt-4">
                        <PdvSyncManagement />
                    </TabsContent>
                </Tabs>
            </div>
        </PermissionGuard>
    );
}
