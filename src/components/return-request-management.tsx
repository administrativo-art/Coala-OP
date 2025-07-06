
"use client"

import { useState, useEffect, useMemo } from "react";
import { format, parseISO, differenceInDays } from "date-fns";
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck, Inbox, Trash2, Archive as ArchiveIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useReturnRequests } from "@/hooks/use-return-requests";
import { type ReturnRequest, returnRequestStatuses } from "@/types";
import { cn } from "@/lib/utils";
import { ReturnRequestDetailModal } from "./return-request-detail-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";


export function ReturnRequestManagement() {
    const { permissions } = useAuth();
    const { requests, loading, deleteReturnRequest } = useReturnRequests();

    const [requestToView, setRequestToView] = useState<ReturnRequest | null>(null);
    const [requestToDelete, setRequestToDelete] = useState<ReturnRequest | null>(null);

    const { activeRequests, archivedRequests } = useMemo(() => {
        const active: ReturnRequest[] = [];
        const archived: ReturnRequest[] = [];
        requests.forEach(req => {
            (req.isArchived ? archived : active).push(req);
        });
        return { 
            activeRequests: active, 
            archivedRequests: archived.sort((a,b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
        };
    }, [requests]);

    useEffect(() => {
        if (requestToView) {
            const updatedRequest = requests.find(r => r.id === requestToView.id);
            if (updatedRequest && JSON.stringify(updatedRequest) !== JSON.stringify(requestToView)) {
                setRequestToView(updatedRequest);
            } else if (!updatedRequest) {
                setRequestToView(null);
            }
        }
    }, [requests, requestToView]);

    const handleDelete = async () => {
        if (requestToDelete) {
            await deleteReturnRequest(requestToDelete.id);
            setRequestToDelete(null);
        }
    };

    const renderList = (requestsToRender: ReturnRequest[], isArchived = false) => {
         if (loading) {
            return (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
            );
        }

        if (requestsToRender.length === 0) {
            return (
                <div className="text-center py-16 flex flex-col items-center">
                    <Inbox className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <h3 className="text-xl font-semibold">{isArchived ? 'Nenhum chamado arquivado' : 'Nenhum chamado ativo'}</h3>
                    <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                        {isArchived ? 'Chamados finalizados e arquivados aparecerão aqui.' : 'Use o botão "Abrir Chamado" para iniciar um novo.'}
                    </p>
                </div>
            );
        }

        const headerTitles = isArchived 
            ? ['Número', 'Insumo', 'Situação Final', 'Data de Arquivamento']
            : ['Número', 'Responsável', 'Insumo', 'Situação', 'Previsão'];

        return (
            <div className="space-y-2">
                 <div className={cn("hidden rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground md:grid", isArchived ? "md:grid-cols-5" : "md:grid-cols-6")}>
                    {headerTitles.map(title => <div key={title}>{title}</div>)}
                    <div className="text-right">Ações</div>
                </div>
                {requestsToRender.map(req => {
                    const statusInfo = returnRequestStatuses[req.status];
                     let isOverdue = false;
                     if (req.status === 'em_andamento' && req.dataPrevisaoRetorno) {
                         isOverdue = differenceInDays(new Date(), parseISO(req.dataPrevisaoRetorno)) > 0;
                     }

                    return (
                        <div key={req.id} className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 cursor-pointer" onClick={() => setRequestToView(req)}>
                           <div className={cn("grid items-center gap-y-2 gap-x-4", isArchived ? "grid-cols-[1fr_auto]" : "grid-cols-[1fr_auto] md:grid-cols-6")}>
                                <div className="font-semibold md:col-span-1">
                                    <span className="md:hidden text-muted-foreground">Chamado: </span>{req.numero}
                                </div>
                                {!isArchived && (
                                    <div className="text-muted-foreground md:col-span-1">
                                         <span className="md:hidden font-medium text-card-foreground">Responsável: </span>{req.createdBy?.username || 'N/A'}
                                    </div>
                                )}
                                <div className="col-span-full md:col-span-1">
                                     <span className="md:hidden font-medium text-card-foreground">Insumo: </span>{req.insumoNome}
                                </div>
                                 <div className="md:col-span-1">
                                    <span className="md:hidden font-medium text-card-foreground">Situação: </span>
                                    {statusInfo ? (
                                        <Badge className={cn("text-white", isOverdue ? 'bg-red-700' : statusInfo.color)}>
                                            {isOverdue ? `${statusInfo.label} | Atrasado` : statusInfo.label}
                                        </Badge>
                                    ) : <Badge variant="secondary">Desconhecido</Badge>}
                                </div>
                                {!isArchived ? (
                                     <div className="text-muted-foreground md:col-span-1">
                                         <span className="md:hidden font-medium text-card-foreground">Previsão: </span>
                                         {req.dataPrevisaoRetorno ? format(parseISO(req.dataPrevisaoRetorno), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                                     </div>
                                ) : (
                                    <div className="text-muted-foreground md:col-span-1">
                                         <span className="md:hidden font-medium text-card-foreground">Arquivado em: </span>
                                         {req.updatedAt ? format(parseISO(req.updatedAt), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                                    </div>
                                )}

                                <div className={cn("flex justify-end", isArchived ? "col-start-2 row-start-1 md:col-span-1" : "md:col-span-1")}>
                                    {permissions.returns.delete && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive"
                                            onClick={(e) => { e.stopPropagation(); setRequestToDelete(req); }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div>
                        <CardTitle className="flex items-center gap-2"><Truck />Controle de Devoluções e Bonificações</CardTitle>
                        <CardDescription>Gerencie o ciclo de vida dos chamados com fornecedores.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent>
                    {renderList(activeRequests)}
                </CardContent>
            </Card>

            {archivedRequests.length > 0 && (
                <Accordion type="single" collapsible className="w-full mt-6">
                    <AccordionItem value="archived-requests">
                        <Card>
                            <AccordionTrigger className="p-4 text-lg font-semibold hover:no-underline [&[data-state=open]>svg]:ml-auto">
                                <div className="flex items-center gap-2">
                                    <ArchiveIcon className="h-5 w-5 text-primary" />
                                    Chamados Arquivados ({archivedRequests.length})
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                {renderList(archivedRequests, true)}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                </Accordion>
            )}

            <ReturnRequestDetailModal request={requestToView} onOpenChange={() => setRequestToView(null)} />
            
            {requestToDelete && (
                <DeleteConfirmationDialog
                    open={!!requestToDelete}
                    onOpenChange={() => setRequestToDelete(null)}
                    onConfirm={handleDelete}
                    itemName={`o chamado "${requestToDelete.numero}"`}
                />
            )}
        </>
    );
}
