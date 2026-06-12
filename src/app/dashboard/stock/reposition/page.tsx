"use client";

import { RepositionHistory, RepositionManagement } from '@/components/reposition-management';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { useReposition } from '@/hooks/use-reposition';
import { ArrowLeft, Inbox } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function RepositionPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const returnTo = searchParams.get('returnTo') || undefined;
    const { permissions } = useAuth();
    const { activities } = useReposition();

    // Espelha o canView do servidor: gestor (analysis.restock) OU atendente do
    // quiosque (reposition.view/receive). Sem isso, o atendente recebia "Acesso negado".
    const managesReposition = !!permissions?.reposition?.prepareDispatch
        || !!permissions?.reposition?.finalize
        || !!permissions?.reposition?.cancel
        || !!permissions?.stock?.analysis?.restock;
    const isReceiveOnly = !!permissions?.reposition?.receive && !managesReposition;
    const canAccess = !!permissions?.stock?.analysis?.restock
        || !!permissions?.reposition?.view
        || !!permissions?.reposition?.receive
        || !!permissions?.reposition?.prepareDispatch;

    if (!canAccess) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center text-muted-foreground">
                    <Inbox className="mx-auto mb-4 h-12 w-12" />
                    <h3 className="text-xl font-semibold text-foreground">Acesso negado</h3>
                </div>
            </div>
        );
    }

    const activeCount = activities.filter(activity => {
        if (activity.status === 'Concluído' || activity.status === 'Cancelada') return false;
        if (isReceiveOnly && activity.status !== 'Aguardando recebimento') return false;
        return true;
    }).length;

    return (
        <div className="mx-auto w-full max-w-[1600px] space-y-5 pb-10">
            <Button
                type="button"
                variant="ghost"
                className="h-auto px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => router.push(returnTo || '/dashboard/stock/analysis')}
            >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {returnTo ? 'Voltar' : 'Voltar para reposição'}
            </Button>

            <div>
                <h1 className="text-2xl font-bold tracking-tight">Gerenciamento da reposição</h1>
                <p className="text-sm text-muted-foreground">
                    Separação, despacho, recebimento e efetivação concentrados aqui.
                </p>
            </div>

            <Tabs defaultValue="management" className="w-full">
                <TabsList className="rounded-xl">
                    <TabsTrigger value="management" className="gap-2">
                        Gerenciar
                        <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground">{activeCount}</span>
                    </TabsTrigger>
                    <TabsTrigger value="history">Histórico</TabsTrigger>
                </TabsList>
                <TabsContent value="management" className="mt-4">
                    <RepositionManagement returnTo={returnTo} />
                </TabsContent>
                <TabsContent value="history" className="mt-4">
                    <RepositionHistory />
                </TabsContent>
            </Tabs>
        </div>
    );
}
