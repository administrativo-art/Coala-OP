

"use client";

import { useAuth } from '@/hooks/use-auth';
import { UserManagement } from '@/components/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function SettingsPage() {
    const { permissions } = useAuth();
    const canManageUsers = permissions.settings.manageUsers;
    
    if (!canManageUsers) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Acesso Negado</CardTitle>
                    <CardDescription>
                        Você não tem permissão para acessar nenhuma configuração.
                    </CardDescription>
                </CardHeader>
            </Card>
        )
    }

    return (
        <div className="w-full space-y-6">
            <Link href="/dashboard" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para o Dashboard
                </Button>
            </Link>
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Configurações</h1>
                <p className="text-muted-foreground">Gerencie usuários, perfis e outras configurações do sistema.</p>
            </div>
            
            <UserManagement />
        </div>
    )
}
