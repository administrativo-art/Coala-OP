
"use client";

import { useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { usePurchase } from '@/hooks/use-purchase';
import { PurchaseSessionCard } from '@/components/purchase-session-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Inbox } from 'lucide-react';

export default function PurchaseSessionWorkspacePage() {
    const router = useRouter();
    const params = useParams();
    const { sessions, loading } = usePurchase();
    
    const sessionId = params.sessionId as string;

    const session = useMemo(() => {
        if (loading || !sessionId) return null;
        return sessions.find(s => s.id === sessionId);
    }, [sessions, sessionId, loading]);

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    
    if (!session) {
        return (
             <div className="space-y-4">
                <div className="mb-4">
                    <Button 
                        onClick={() => router.push('/dashboard/stock/purchasing')}
                        variant="outline"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Voltar para gestão de compras
                    </Button>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Sessão não encontrada</CardTitle>
                        <CardDescription>A sessão de cotação que você está procurando não foi encontrada ou foi excluída.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center justify-center text-center text-muted-foreground p-12">
                         <Inbox className="h-12 w-12 mb-4" />
                         <p>Sessão de cotação não encontrada</p>
                    </CardContent>
                </Card>
             </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="mb-4 shrink-0">
                <Button 
                    onClick={() => router.push('/dashboard/stock/purchasing')}
                    variant="outline"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para gestão de compras
                </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <PurchaseSessionCard session={session} />
            </div>
        </div>
    );
}
