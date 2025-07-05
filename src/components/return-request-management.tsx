
"use client"

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, PackageUp, Inbox, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useReturnRequests } from "@/hooks/use-return-requests";
import { type ReturnRequest, returnRequestStatuses } from "@/types";
import { cn } from "@/lib/utils";
import { AddReturnRequestModal } from "./add-return-request-modal";
import { ReturnRequestDetailModal } from "./return-request-detail-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";


export function ReturnRequestManagement() {
    const { permissions } = useAuth();
    const { requests, loading, deleteReturnRequest } = useReturnRequests();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [requestToView, setRequestToView] = useState<ReturnRequest | null>(null);
    const [requestToDelete, setRequestToDelete] = useState<ReturnRequest | null>(null);

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

        if (requests.length === 0) {
            return (
                <div className="text-center py-16 flex flex-col items-center">
                    <Inbox className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <h3 className="text-xl font-semibold">Nenhum chamado aberto</h3>
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
                            <TableHead>Insumo</TableHead>
                            <TableHead>Lote</TableHead>
                            <TableHead>Qtd.</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Data Abertura</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {requests.map((req) => (
                            <TableRow key={req.id} className="cursor-pointer" onClick={() => setRequestToView(req)}>
                                <TableCell className="font-semibold">{req.numero}</TableCell>
                                <TableCell>{req.insumoNome}</TableCell>
                                <TableCell>{req.lote}</TableCell>
                                <TableCell>{req.quantidade}</TableCell>
                                <TableCell>
                                    <Badge className={cn("text-white", returnRequestStatuses[req.status].color)}>
                                        {returnRequestStatuses[req.status].label}
                                    </Badge>
                                </TableCell>
                                <TableCell>{format(parseISO(req.createdAt), 'dd/MM/yyyy', { locale: ptBR })}</TableCell>
                                <TableCell className="text-right">
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
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        );
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle className="flex items-center gap-2"><PackageUp />Controle de Devoluções e Bonificações</CardTitle>
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
