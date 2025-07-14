
"use client";

import { UserManagement } from '@/components/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Users, Ticket } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

// Placeholder for the upcoming label settings component
function LabelSettings() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Configurações de Etiqueta</CardTitle>
                <CardDescription>
                    Personalize a aparência das etiquetas de lote. Em breve, você poderá fazer upload de um logotipo e definir tamanhos personalizados.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                    <p>Funcionalidade em desenvolvimento.</p>
                </div>
            </CardContent>
        </Card>
    )
}


export default function SettingsPage() {
    const { permissions } = useAuth();
    const canManageUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;

    return (
        <div className="w-full space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Configurações</h1>
                <p className="text-muted-foreground">Gerencie usuários, perfis e outras configurações do sistema.</p>
            </div>
            
             <Tabs defaultValue="users" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    {canManageUsers && <TabsTrigger value="users"><Users className="mr-2 h-4 w-4" /> Usuários e Perfis</TabsTrigger>}
                    <TabsTrigger value="labels"><Ticket className="mr-2 h-4 w-4" /> Etiquetas</TabsTrigger>
                </TabsList>
                {canManageUsers && 
                    <TabsContent value="users" className="mt-4">
                        <UserManagement />
                    </TabsContent>
                }
                <TabsContent value="labels" className="mt-4">
                    <LabelSettings />
                </TabsContent>
            </Tabs>
        </div>
    )
}
