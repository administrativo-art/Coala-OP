
"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useAuthorBoardDiary } from '@/hooks/use-author-board-diary';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, History, BookOpen, ArrowRight, BarChart2, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { type DailyLog } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { DiaryDashboard } from './diary-dashboard';

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

function HistoryModal({ open, onOpenChange, logs, onOpenRecord }: { open: boolean, onOpenChange: (open: boolean) => void, logs: DailyLog[], onOpenRecord: (logId: string) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Histórico de Registros</DialogTitle>
                    <DialogDescription>Consulte os diários dos dias anteriores.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 pr-4 -mr-2">
                     {logs.length > 0 ? (
                        <div className="space-y-2">
                            {logs.map(log => (
                                <div key={log.id} className="p-3 border rounded-lg flex justify-between items-center cursor-pointer hover:bg-muted/50" onClick={() => onOpenRecord(log.id)}>
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
                            <History className="h-12 w-12 mx-auto mb-4" />
                            <p className="font-semibold">Nenhum registro no histórico.</p>
                        </div>
                    )}
                </ScrollArea>
                 <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function ManagerDiary() {
    const { user, loading: userLoading, permissions } = useAuth();
    const { logs, createOrGetDailyLog, loading: logsLoading } = useAuthorBoardDiary();
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    const handleNewRecord = async () => {
        setIsCreating(true);
        const log = await createOrGetDailyLog();
        if (log) {
            router.push(`/dashboard/manager-diary/${log.id}`);
        }
        setIsCreating(false);
    };
    
    const handleOpenRecord = (logId: string) => {
        setIsHistoryOpen(false);
        router.push(`/dashboard/manager-diary/${logId}`);
    }

    if (userLoading || logsLoading) {
        return <Skeleton className="h-96 w-full" />;
    }
    
    const finalizedLogs = useMemo(() => logs.filter(log => log.status === 'finalizado'), [logs]);

    return (
        <div className="space-y-6">
            <div className="text-center mb-10">
                <h1 className="text-4xl font-bold tracking-tight">Diário Gerencial</h1>
                <p className="text-lg text-muted-foreground mt-2">Registre as atividades e ocorrências do dia.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 justify-center max-w-4xl mx-auto">
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <PlusCircle className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Novo Registro</CardTitle>
                        <CardDescription>Inicie ou continue o registro das atividades e ocorrências do dia de hoje.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Button className="w-full text-lg py-6" onClick={handleNewRecord} disabled={isCreating}>
                            {isCreating ? 'Carregando...' : 'Acessar diário'}
                            <ArrowRight className="ml-2" />
                        </Button>
                    </CardContent>
                </Card>
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <History className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Consultar Histórico</CardTitle>
                        <CardDescription>Visualize, consulte e edite os diários de bordo de dias anteriores.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                         <Button className="w-full text-lg py-6" onClick={() => setIsHistoryOpen(true)}>
                            Consultar
                            <ArrowRight className="ml-2" />
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {permissions.authorBoardDiary.viewAll && (
                 <div className="mt-8">
                    <DiaryDashboard logs={finalizedLogs} />
                </div>
            )}

             <HistoryModal 
                open={isHistoryOpen}
                onOpenChange={setIsHistoryOpen}
                logs={logs}
                onOpenRecord={handleOpenRecord}
            />
        </div>
    );
}
