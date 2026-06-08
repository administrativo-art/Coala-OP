"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RepositionHistory, RepositionManagement } from '@/components/reposition-management';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useReposition } from '@/hooks/use-reposition';
import { useRepositionRequests } from '@/hooks/use-reposition-requests';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    CheckCircle2,
    ChevronRight,
    ClipboardList,
    Inbox,
    Package,
    Truck,
    Warehouse,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});

const unitPalette = [
    { bg: 'bg-[#fb8d4c]', dot: 'bg-[#ef476f]' },
    { bg: 'bg-[#5bc88d]', dot: 'bg-[#f4a62a]' },
    { bg: 'bg-[#9554e8]', dot: 'bg-[#ef476f]' },
    { bg: 'bg-[#4aa9df]', dot: 'bg-[#ef476f]' },
];

export default function RepositionHubPage() {
    const router = useRouter();
    const { toast } = useToast();
    const { kiosks } = useKiosks();
    const { permissions } = useAuth();
    const { activities, loading: activitiesLoading } = useReposition();
    const {
        requests,
        loading: requestsLoading,
        updateRepositionRequest,
    } = useRepositionRequests();
    const [isKioskModalOpen, setIsKioskModalOpen] = useState(false);
    const [decliningRequestId, setDecliningRequestId] = useState<string | null>(null);

    const { matriz, otherKiosks } = useMemo(() => {
        const matrizKiosk = kiosks.find(kiosk => kiosk.id === 'matriz');
        const others = kiosks
            .filter(kiosk => kiosk.id !== 'matriz')
            .sort((left, right) => left.name.localeCompare(right.name));

        return { matriz: matrizKiosk, otherKiosks: others };
    }, [kiosks]);

    const pendingRequests = useMemo(() => {
        return requests
            .filter(request => request.status === 'Pendente')
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }, [requests]);

    const activeActivities = useMemo(() => {
        return activities.filter(activity => activity.status !== 'Concluído' && activity.status !== 'Cancelada');
    }, [activities]);

    const pipelineCounts = useMemo(() => {
        return activeActivities.reduce(
            (acc, activity) => {
                if (activity.status === 'Aguardando despacho' && !activity.isSeparated) acc.separation += 1;
                if (activity.status === 'Aguardando despacho' && activity.isSeparated) acc.dispatch += 1;
                if (activity.status === 'Aguardando recebimento') acc.receipt += 1;
                if (activity.status === 'Recebido sem divergência' || activity.status === 'Recebido com divergência') acc.finalization += 1;
                if (activity.status === 'Recebido com divergência') acc.divergence += 1;
                return acc;
            },
            { separation: 0, dispatch: 0, receipt: 0, finalization: 0, divergence: 0 }
        );
    }, [activeActivities]);

    const canPrepareDispatch = permissions.reposition.prepareDispatch || permissions.stock.analysis.restock;

    const handleKioskSelect = (kioskId: string) => {
        router.push(`/dashboard/stock/analysis/restock?kioskId=${kioskId}`);
        setIsKioskModalOpen(false);
    };

    const handleCreateActivity = () => {
        if (!matriz) return;
        handleKioskSelect(matriz.id);
    };

    const handleDeclineRequest = async (requestId: string) => {
        setDecliningRequestId(requestId);
        try {
            await updateRepositionRequest(requestId, { status: 'Cancelada' });
            toast({
                title: 'Solicitação recusada',
                description: 'A solicitação foi removida da fila de análise.',
            });
        } catch (error) {
            console.error('Error declining reposition request:', error);
            toast({
                variant: 'destructive',
                title: 'Erro ao recusar solicitação',
                description: 'Tente novamente em instantes.',
            });
        } finally {
            setDecliningRequestId(null);
        }
    };

    return (
        <div className="mx-auto w-full max-w-[1600px] space-y-8 px-1 pb-10">
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <span>Estoque</span>
                    <ChevronRight className="h-4 w-4" />
                    <span className="text-foreground">Reposição</span>
                </div>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="text-4xl font-bold tracking-tight">Reposição de Estoque</h1>
                        <p className="mt-2 text-base text-muted-foreground">
                            Acompanhe necessidades por unidade, revise solicitações e gerencie o fluxo de transferências.
                        </p>
                    </div>

                    {canPrepareDispatch && (
                        <Button
                            size="lg"
                            onClick={() => setIsKioskModalOpen(true)}
                            className="h-12 min-w-52 rounded-lg bg-[#5147e8] px-8 text-base shadow-md hover:bg-[#4338ca]"
                        >
                            Solicitar reposição
                        </Button>
                    )}
                </div>
            </div>

            <section className="space-y-4 rounded-3xl border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <ClipboardList className="h-5 w-5 text-[#5147e8]" />
                    <h2 className="text-lg font-semibold">Solicitações pendentes</h2>
                    <Badge className="rounded-full bg-[#5147e8] px-3">{pendingRequests.length}</Badge>
                    <span className="text-muted-foreground">aguardando revisão do CD</span>
                </div>

                <div className="space-y-3">
                    {requestsLoading ? (
                        <>
                            <Skeleton className="h-24 rounded-2xl" />
                            <Skeleton className="h-24 rounded-2xl" />
                        </>
                    ) : pendingRequests.length === 0 ? (
                        <div className="rounded-2xl border border-dashed bg-background/70 py-12 text-center text-sm text-muted-foreground">
                            Nenhuma solicitação pendente.
                        </div>
                    ) : (
                        pendingRequests.map((request) => {
                            const itemPreview = request.items
                                .slice(0, 2)
                                .map(item => item.productName)
                                .join(' · ');
                            const remainingItems = request.items.length > 2 ? ` +${request.items.length - 2}` : '';

                            return (
                                <div key={request.id} className="flex flex-col gap-4 rounded-2xl border bg-background/70 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
                                    <div className="flex min-w-0 items-center gap-4">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#9554e8] text-white">
                                            <Package className="h-6 w-6" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="font-semibold">{request.kioskName.replace(/^Quiosque\s+/i, '')}</h3>
                                                <Badge variant="secondary" className="rounded-md">
                                                    {request.items.length} item{request.items.length === 1 ? '' : 's'}
                                                </Badge>
                                                <span className="text-sm text-muted-foreground">{request.id.slice(-6).toUpperCase()}</span>
                                            </div>
                                            <p className="mt-1 truncate text-base text-muted-foreground">
                                                {itemPreview}{remainingItems}
                                            </p>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Enviado por {request.requestedBy.username} · {dateFormatter.format(new Date(request.createdAt))}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center justify-end gap-2">
                                        <Button
                                            variant="ghost"
                                            disabled={decliningRequestId === request.id}
                                            onClick={() => handleDeclineRequest(request.id)}
                                        >
                                            Recusar
                                        </Button>
                                        <Button
                                            onClick={handleCreateActivity}
                                            disabled={!matriz}
                                            className="rounded-lg bg-[#5147e8] hover:bg-[#4338ca]"
                                        >
                                            <Truck className="mr-2 h-4 w-4" />
                                            Criar atividade
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </section>

            <section className="space-y-5 rounded-3xl border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pipeline ativo</p>
                        {activitiesLoading ? (
                            <Skeleton className="mt-2 h-7 w-56" />
                        ) : (
                            <h2 className="mt-1 text-2xl font-semibold">
                                {activeActivities.length} atividade{activeActivities.length === 1 ? '' : 's'} em andamento
                            </h2>
                        )}
                    </div>

                    {pipelineCounts.divergence > 0 && (
                        <Badge className="rounded-full border border-[#ffb6c2] bg-[#fff1f4] px-3 py-1 text-[#ef476f] hover:bg-[#fff1f4]">
                            {pipelineCounts.divergence} com divergência aguardando resolução
                        </Badge>
                    )}
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                    {[
                        { label: 'Separação', value: pipelineCounts.separation, icon: Inbox },
                        { label: 'Despacho', value: pipelineCounts.dispatch, icon: Truck },
                        { label: 'Recebimento', value: pipelineCounts.receipt, icon: Package },
                        { label: 'Efetivação', value: pipelineCounts.finalization, icon: CheckCircle2 },
                    ].map(item => (
                        <div key={item.label} className="rounded-2xl border bg-background/70 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <item.icon className="h-5 w-5 text-muted-foreground" />
                                <span className="text-2xl font-semibold">{item.value}</span>
                            </div>
                            <p className="mt-3 text-sm font-medium text-muted-foreground">{item.label}</p>
                        </div>
                    ))}
                </div>

                <Tabs defaultValue="management" className="w-full">
                    <TabsList className="rounded-xl">
                        <TabsTrigger value="management" className="gap-2">
                            Em andamento
                            <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground">{activeActivities.length}</span>
                        </TabsTrigger>
                        <TabsTrigger value="history">Histórico</TabsTrigger>
                    </TabsList>
                    <TabsContent value="management" className="mt-4">
                        <RepositionManagement />
                    </TabsContent>
                    <TabsContent value="history" className="mt-4">
                        <RepositionHistory />
                    </TabsContent>
                </Tabs>
            </section>

            <Dialog open={isKioskModalOpen} onOpenChange={setIsKioskModalOpen}>
                <DialogContent className="max-w-xl rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Nova solicitação de reposição</DialogTitle>
                        <DialogDescription>
                            Escolha a unidade. A solicitação vai para o CD revisar e virar atividade.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-3">
                        {matriz && (
                            <button
                                type="button"
                                onClick={() => handleKioskSelect(matriz.id)}
                                className="flex w-full items-center justify-between rounded-xl border border-[#b7c5ff] bg-[#eef2ff] p-4 text-left transition-colors hover:bg-[#e5ebff]"
                            >
                                <span className="flex items-center gap-3">
                                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#5147e8] text-white">
                                        <Warehouse className="h-5 w-5" />
                                    </span>
                                    <span>
                                        <span className="block font-semibold">Centro de distribuição - Matriz</span>
                                        <span className="text-sm text-muted-foreground">Centro de distribuição · revisa solicitações</span>
                                    </span>
                                </span>
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            </button>
                        )}

                        <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quiosques</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {otherKiosks.map((kiosk, index) => (
                                    <button
                                        key={kiosk.id}
                                        type="button"
                                        onClick={() => handleKioskSelect(kiosk.id)}
                                        className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                                    >
                                        <span className={cn("h-8 w-8 rounded-lg", unitPalette[index % unitPalette.length].bg)} />
                                        <span className="font-semibold">{kiosk.name.replace(/^Quiosque\s+/i, '')}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
