
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useAuthorBoardDiary } from '@/hooks/use-author-board-diary';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, History, Inbox } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { type DailyLog } from '@/types';


const getStatusBadge = (status: DailyLog['status']) => {
    switch (status) {
        case 'aberto':
            return <Badge variant="outline">Aberto</Badge>;
        case 'em andamento':
            return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Em Andamento</Badge>;
        case 'finalizado':
            return <Badge className="bg-green-100 text-green-800">Finalizado</Badge>;
        default:
            return <Badge variant="secondary">{status}</Badge>;
    }
}

export function ManagerDiary() {
    const { user, loading: userLoading } = useAuth();
    const { logs, createOrGetDailyLog, loading: logsLoading } = useAuthorBoardDiary();
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);

    const handleNewRecord = async () => {
        setIsCreating(true);
        const log = await createOrGetDailyLog();
        if (log) {
            router.push(`/dashboard/manager-diary/${log.id}`);
        }
        setIsCreating(false);
    };
    
    const handleOpenRecord = (logId: string) => {
        router.push(`/dashboard/manager-diary/${logId}`);
    }

    if (userLoading || logsLoading) {
        return <Skeleton className="h-96 w-full" />
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Diário Gerencial</h1>
                    <p className="text-muted-foreground">Registre as atividades e ocorrências do dia.</p>
                </div>
                <Button onClick={handleNewRecord} disabled={isCreating}>
                    <PlusCircle className="mr-2 h-4 w-4" /> 
                    {isCreating ? 'Carregando...' : 'Novo Registro do Dia'}
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><History /> Histórico de Registros</CardTitle>
                    <CardDescription>Consulte os diários dos dias anteriores.</CardDescription>
                </CardHeader>
                <CardContent>
                    {logs.length > 0 ? (
                        <div className="space-y-2">
                            {logs.map(log => (
                                <div key={log.id} className="p-3 border rounded-lg flex justify-between items-center cursor-pointer hover:bg-muted/50" onClick={() => handleOpenRecord(log.id)}>
                                    <div>
                                        <p className="font-semibold">Diário de {format(parseISO(log.logDate), "dd 'de' MMMM, yyyy", { locale: ptBR })}</p>
                                        <p className="text-sm text-muted-foreground">Autor: {log.author.username}</p>
                                    </div>
                                    {getStatusBadge(log.status)}
                                </div>
                            ))}
                        </div>
                    ) : (
                         <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                            <Inbox className="h-12 w-12 mx-auto mb-4" />
                            <p className="font-semibold">Nenhum registro encontrado.</p>
                            <p className="text-sm">Clique em "Novo Registro" para começar.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

