

"use client";

import { useAuth } from '@/hooks/use-auth';
import { UserManagement } from '@/components/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function SettingsPage() {
    const { permissions } = useAuth();
    const router = useRouter();
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
            <div className="flex items-center gap-4 mb-2">
                <Button 
                    onClick={() => router.push('/dashboard')}
                    variant="ghost"
                    className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Voltar para o Dashboard"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Configurações</h1>
                    <p className="text-sm text-muted-foreground">Gerencie usuários, perfis, identidade visual e outras configurações do sistema.</p>
                </div>
            </div>
            
            <UserManagement />
        </div>
    )
}
