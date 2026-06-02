"use client";

import { BackButton } from '@/components/navigation/back-button';
import { RepositionHistory, RepositionManagement } from '@/components/reposition-management';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useRepositionRequests } from '@/hooks/use-reposition-requests';
import { ChevronRight, ClipboardList, Package } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});

export default function RepositionHubPage() {
    const router = useRouter();
    const { kiosks } = useKiosks();
    const { permissions } = useAuth();
    const { requests, loading: requestsLoading } = useRepositionRequests();
    const [isKioskModalOpen, setIsKioskModalOpen] = useState(false);

    const { matriz, otherKiosks } = useMemo(() => {
        const matrizKiosk = kiosks.find(k => k.id === 'matriz');
        const others = kiosks
            .filter(k => k.id !== 'matriz')
            .sort((a,b) => a.name.localeCompare(b.name));
        return { matriz: matrizKiosk, otherKiosks: others };
    }, [kiosks]);

    const pendingRequests = useMemo(() => {
        return requests
            .filter(request => request.status === 'Pendente')
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }, [requests]);

    const pendingRequestsCount = pendingRequests.length;
    const canPrepareDispatch = permissions.reposition.prepareDispatch || permissions.stock.analysis.restock;

    const handleKioskSelect = (kioskId: string) => {
        router.push(`/dashboard/stock/analysis/restock?kioskId=${kioskId}`);
        setIsKioskModalOpen(false);
    };
    
    return (
        <div className="w-full space-y-6">
            <div className="mb-4">
                <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
            </div>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold">Reposição de Estoque</h1>
                    <p className="text-sm text-muted-foreground">
                        Inicie análises, acompanhe solicitações e gerencie as atividades em andamento.
                    </p>
                </div>

                {canPrepareDispatch && (
                    <Button size="lg" onClick={() => setIsKioskModalOpen(true)} className="w-full lg:w-auto">
                        Solicitar reposição
                    </Button>
                )}
            </div>

            <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3">
                        <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="font-semibold">Solicitações pendentes</h2>
                            <p className="text-sm text-muted-foreground">
                                As solicitações das unidades entram na análise da Matriz para virar atividade de reposição.
                            </p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {requestsLoading ? (
                            <Skeleton className="h-8 w-24" />
                        ) : (
                            <Badge variant={pendingRequestsCount > 0 ? "default" : "secondary"} className="h-8 px-3 text-sm">
                                {pendingRequestsCount} pendente{pendingRequestsCount === 1 ? '' : 's'}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="mt-4">
                    {requestsLoading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                        </div>
                    ) : pendingRequests.length === 0 ? (
                        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                            Nenhuma solicitação pendente.
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            {pendingRequests.slice(0, 5).map((request) => {
                                const itemPreview = request.items
                                    .slice(0, 2)
                                    .map(item => `${item.productName} (${item.requestedQuantity} ${item.unit})`)
                                    .join(' · ');
                                const remainingItems = request.items.length > 2 ? ` +${request.items.length - 2}` : '';

                                return (
                                    <button
                                        key={request.id}
                                        type="button"
                                        onClick={() => matriz && handleKioskSelect(matriz.id)}
                                        disabled={!matriz}
                                        className="flex w-full items-center justify-between gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <div className="flex min-w-0 items-start gap-3">
                                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                                <Package className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-medium">{request.kioskName}</span>
                                                    <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                                                        {request.items.length} item{request.items.length === 1 ? '' : 's'}
                                                    </Badge>
                                                </div>
                                                <p className="mt-1 truncate text-sm text-muted-foreground">
                                                    {itemPreview}{remainingItems}
                                                </p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Enviada por {request.requestedBy.username} em {dateFormatter.format(new Date(request.createdAt))}
                                                </p>
                                            </div>
                                        </div>
                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <Tabs defaultValue="active" className="space-y-4 pt-2">
                <TabsList>
                    <TabsTrigger value="active">Em andamento</TabsTrigger>
                    <TabsTrigger value="history">Histórico</TabsTrigger>
                </TabsList>
                <TabsContent value="active" className="space-y-3">
                    <div>
                        <h2 className="text-xl font-semibold">Atividades em andamento</h2>
                        <p className="text-sm text-muted-foreground">
                            Separação, despacho, recebimento e efetivação ficam concentrados aqui.
                        </p>
                    </div>
                    <RepositionManagement />
                </TabsContent>
                <TabsContent value="history" className="space-y-3">
                    <div>
                        <h2 className="text-xl font-semibold">Histórico de reposições</h2>
                        <p className="text-sm text-muted-foreground">
                            Consulte atividades concluídas ou canceladas.
                        </p>
                    </div>
                    <RepositionHistory />
                </TabsContent>
            </Tabs>

            <Dialog open={isKioskModalOpen} onOpenChange={setIsKioskModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nova solicitação de reposição</DialogTitle>
                        <DialogDescription>Selecione a unidade para montar uma solicitação. A Matriz revisa pendências e cria atividades.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                        {matriz && (
                            <Button key={matriz.id} variant="secondary" className="w-full justify-start text-base py-6" onClick={() => handleKioskSelect(matriz.id)}>
                                {matriz.name}
                            </Button>
                        )}
                        {otherKiosks.length > 0 && matriz && <Separator className="my-2" />}
                        {otherKiosks.map(kiosk => (
                            <Button key={kiosk.id} variant="outline" className="w-full justify-start text-base py-6" onClick={() => handleKioskSelect(kiosk.id)}>
                                {kiosk.name}
                            </Button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
