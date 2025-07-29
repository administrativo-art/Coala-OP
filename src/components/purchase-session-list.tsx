
"use client";

import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { usePurchase } from '@/hooks/use-purchase';
import { Button } from '@/components/ui/button';
import { PlusCircle, Inbox } from 'lucide-react';
import { StartPurchaseSessionModal } from './start-purchase-session-modal';
import { PurchaseSessionCard } from './purchase-session-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

export function PurchaseSessionList() {
    const { sessions, addSession } = usePurchase();
    const { user, permissions } = useAuth();
    const [isStartModalOpen, setIsStartModalOpen] = useState(false);

    const handleCreateSession = async (data: {description: string, baseProductIds: string[]}) => {
        if (!user) return;
        await addSession({ ...data, type: 'manual' });
    };
    
    const { openSessions, closedSessions } = useMemo(() => {
        const open: typeof sessions = [];
        const closed: typeof sessions = [];
        sessions.filter(s => s.type === 'manual').forEach(s => {
            if (s.status === 'open') {
                open.push(s);
            } else {
                closed.push(s);
            }
        });
        return { openSessions: open, closedSessions: closed };
    }, [sessions]);

    return (
        <div className="space-y-4">
            {permissions.purchasing.suggest && (
                <Button onClick={() => setIsStartModalOpen(true)}>
                    <PlusCircle className="mr-2" /> Criar nova pesquisa manual
                </Button>
            )}
            
            <Tabs defaultValue="open">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="open">Sessões Abertas ({openSessions.length})</TabsTrigger>
                    <TabsTrigger value="closed">Histórico de Compras ({closedSessions.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="open" className="mt-4">
                     {openSessions.length > 0 ? (
                        openSessions.map(session => (
                            <PurchaseSessionCard key={session.id} session={session} />
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                            <Inbox className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Nenhuma pesquisa manual em andamento.</p>
                            <p className="text-sm">Clique em "Criar nova pesquisa" para iniciar uma.</p>
                        </div>
                    )}
                </TabsContent>
                <TabsContent value="closed" className="mt-4">
                    {closedSessions.length > 0 ? (
                        <div className="space-y-4">
                            {closedSessions.map(session => (
                                <PurchaseSessionCard key={session.id} session={session} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                            <Inbox className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Nenhum histórico de compras encontrado.</p>
                            <p className="text-sm">As compras finalizadas aparecerão aqui.</p>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
           
            <StartPurchaseSessionModal
                open={isStartModalOpen}
                onOpenChange={setIsStartModalOpen}
                onConfirm={handleCreateSession}
            />
        </div>
    );
}
