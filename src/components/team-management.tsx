
"use client"

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, Users } from 'lucide-react';

export function TeamManagement() {
    const { permissions } = useAuth();
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users /> Gestão de Equipe</CardTitle>
                <CardDescription>Monte e visualize a escala de trabalho dos colaboradores para cada quiosque.</CardDescription>
            </CardHeader>
            <CardContent className="text-center py-12">
                 <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Calendar className="h-16 w-16 mb-4" />
                    <h3 className="text-lg font-semibold text-foreground">Funcionalidade em desenvolvimento</h3>
                    <p className="mt-1 text-sm max-w-sm">
                        A funcionalidade de criação de escalas está sendo preparada. Em breve, você poderá gerenciar os horários da sua equipe por aqui.
                    </p>
                    {permissions.team?.manage && (
                        <Button className="mt-6" onClick={() => setIsModalOpen(true)} disabled>
                            Criar Nova Escala
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
