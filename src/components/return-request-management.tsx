"use client"

import { useState, useEffect, useMemo } from "react";
import { format, parseISO, differenceInDays } from "date-fns";
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Truck, Inbox, Trash2, Archive as ArchiveIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useReturnRequests } from "@/hooks/use-return-requests";
import { type ReturnRequest, returnRequestStatuses } from "@/types";
import { cn } from "@/lib/utils";
import { AddReturnRequestModal } from "./add-return-request-modal";
import { ReturnRequestDetailModal } from "./return-request-detail-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";


export function ReturnRequestManagement() {
    const { permissions } = useAuth();
    const { requests, loading, deleteReturnRequest } = useReturnRequests();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
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
            archivedRequests: archived.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
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

    const renderContent = () => {
        if (loading) {
            return (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
            );
        }

        if (activeRequests.length === 0) {
            return (
                <div className="text-center py-16 flex flex-col items-center">
                    <Inbox className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <h3 className="text-xl font-semibold">Nenhum chamado ativo</h3>
                    <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                        Inicie um novo chamado de devolução ou bonificação para começar a gerenciar.
                    </p>
                    {permissions.returns.add && (
                        <Button size="lg" onClick={() => setIsAddModalOpen(true)}>
                            <PlusCircle className="mr-2 h-5 w-5" /> Abrir Chamado
                        </Button>
                    )}
                </div>
            );
        }

        return (
            <div className="border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Número</TableHead>
                            <TableHead>Responsável</TableHead>
                            <TableHead>Insumo</TableHead>
                            <TableHead>Situação</TableHead>
                            <TableHead>Abertura</TableHead>
                            <TableHead>Previsão</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {activeRequests.map((req) => {
                            const statusInfo = returnRequestStatuses[req.status];
                            let isOverdue = false;
                            if (req.status === 'em_andamento' && req.dataPrevisaoRetorno) {
                                isOverdue = differenceInDays(new Date(), parseISO(req.dataPrevisaoRetorno)) > 0;
                            }
                            return (
                                <TableRow key={req.id}>
                                    <TableCell className="font-semibold cursor-pointer" onClick={() => setRequestToView(req)}>{req.numero}</TableCell>
                                    <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>{req.createdBy?.username || 'N/A'}</TableCell>
                                    <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>{req.insumoNome}</TableCell>
                                    <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>
                                        {statusInfo ? (
                                            <Badge className={cn("text-white", isOverdue ? 'bg-red-700' : statusInfo.color)}>
                                                {isOverdue ? `${statusInfo.label} | Atrasado` : statusInfo.label}
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary">Desconhecido</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>{format(parseISO(req.createdAt), 'dd/MM/yyyy', { locale: ptBR })}</TableCell>
                                    <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>{req.dataPrevisaoRetorno ? format(parseISO(req.dataPrevisaoRetorno), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}</TableCell>
                                    <TableCell className="text-right">
                                        {permissions.returns.delete && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => setRequestToDelete(req)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        );
    };
    
    const renderArchivedTable = () => (
        <div className="border rounded-lg">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Número</TableHead>
                        <TableHead>Insumo</TableHead>
                        <TableHead>Situação Final</TableHead>
                        <TableHead>Data de Arquivamento</TableHead>
                        {permissions.returns.delete && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {archivedRequests.map((req) => {
                        const statusInfo = returnRequestStatuses[req.status];
                        return (
                            <TableRow key={req.id}>
                                <TableCell className="font-semibold cursor-pointer" onClick={() => setRequestToView(req)}>{req.numero}</TableCell>
                                <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>{req.insumoNome}</TableCell>
                                <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>
                                    {statusInfo ? (
                                        <Badge className={cn("text-white", statusInfo.color)}>
                                            {statusInfo.label}
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary">Desconhecido</Badge>
                                    )}
                                </TableCell>
                                <TableCell className="cursor-pointer" onClick={() => setRequestToView(req)}>{format(parseISO(req.updatedAt), 'dd/MM/yyyy', { locale: ptBR })}</TableCell>
                                {permissions.returns.delete && (
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setRequestToDelete(req)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle className="flex items-center gap-2"><Truck />Controle de Devoluções e Bonificações</CardTitle>
                            <CardDescription>Gerencie o ciclo de vida dos chamados com fornecedores.</CardDescription>
                        </div>
                        {permissions.returns.add && (
                            <Button onClick={() => setIsAddModalOpen(true)}>
                                <PlusCircle className="mr-2" /> Abrir Chamado
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {renderContent()}
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
                                {renderArchivedTable()}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                </Accordion>
            )}

            <AddReturnRequestModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
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
