
"use client";

import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { usePurchase } from '@/hooks/use-purchase';
import { Button } from '@/components/ui/button';
import { PlusCircle, Inbox } from 'lucide-react';
import { StartPurchaseSessionModal } from './start-purchase-session-modal';
import { PurchaseSessionCard } from './purchase-session-card';

export function PurchaseSessionList() {
    const { sessions, addSession } = usePurchase();
    const { user, permissions } = useAuth();
    const [isStartModalOpen, setIsStartModalOpen] = useState(false);

    const handleCreateSession = async (data: {description: string, baseProductIds: string[]}) => {
        if (!user) return;
        await addSession({ ...data, type: 'manual' });
    };
    
    const openSessions = useMemo(() => {
        return sessions.filter(s => s.status === 'open');
    }, [sessions]);

    return (
        <div className="space-y-4">
            {permissions?.purchasing?.suggest && (
                <Button onClick={() => setIsStartModalOpen(true)}>
                    <PlusCircle className="mr-2" /> Criar nova pesquisa manual
                </Button>
            )}
            
            <div className="mt-4">
                 {openSessions.length > 0 ? (
                    <div className="space-y-3">
                        {openSessions.map(session => (
                            <PurchaseSessionCard key={session.id} session={session} />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                        <Inbox className="h-12 w-12 mb-4" />
                        <p className="font-semibold">Nenhuma pesquisa em andamento.</p>
                        <p className="text-sm">Clique em "Criar nova pesquisa" para iniciar uma.</p>
                    </div>
                )}
            </div>
           
            <StartPurchaseSessionModal
                open={isStartModalOpen}
                onOpenChange={setIsStartModalOpen}
                onConfirm={handleCreateSession}
            />
        </div>
    );
}
