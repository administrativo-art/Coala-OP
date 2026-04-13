"use client";

import dynamic from 'next/dynamic';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { PermissionGuard } from "@/components/permission-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const UserManagement = dynamic(
  () => import('@/components/user-management').then(m => ({ default: m.UserManagement })),
  { ssr: false }
);
const KioskManagement = dynamic(
  () => import('@/components/kiosk-management').then(m => ({ default: m.KioskManagement })),
  { ssr: false }
);
const CalendarManagement = dynamic(
  () => import('@/components/calendar-management').then(m => ({ default: m.CalendarManagement })),
  { ssr: false }
);
const PdvSyncManagement = dynamic(
  () => import('@/components/pdv-sync-management').then(m => ({ default: m.PdvSyncManagement })),
  { ssr: false }
);

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
                </Tabs>
            </div>
        </PermissionGuard>
    );
}
