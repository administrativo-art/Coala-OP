

"use client";

import { useState } from "react";
import { useReposition } from "@/hooks/use-reposition";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "./ui/skeleton";
import { Card } from "./ui/card";
import { Inbox, Truck, AlertTriangle, Trash2, CheckSquare, Undo2, BadgeCheck, Download, Ban } from "lucide-react";
import { type RepositionActivity } from "@/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { DispatchModal } from "./dispatch-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { AuditReceiptModal } from "./audit-receipt-modal";
import { useProducts } from "@/hooks/use-products";


const getStatusBadge = (status: RepositionActivity['status']) => {
    switch (status) {
        case 'Aguardando despacho':
            return <Badge variant="secondary">{status}</Badge>;
        case 'Aguardando recebimento':
            return <Badge className="bg-blue-500 text-white hover:bg-blue-600">{status}</Badge>;
        case 'Recebido com divergência':
            return <Badge variant="destructive" className="bg-yellow-500 text-white hover:bg-yellow-600"><AlertTriangle className="mr-1 h-3 w-3" />{status}</Badge>;
        case 'Recebido sem divergência':
            return <Badge className="bg-green-600 text-white hover:bg-green-700">{status}</Badge>;
        case 'Concluído':
            return <Badge variant="default">{status}</Badge>;
        case 'Cancelada':
            return <Badge variant="destructive">{status}</Badge>;
        default:
            return <Badge>{status}</Badge>;
    }
}

export function RepositionManagement() {
    const { activities, loading, cancelRepositionActivity, updateRepositionActivity, finalizeRepositionActivity } = useReposition();
    const { user, permissions } = useAuth();
    const { products } = useProducts();
    const [activityToDispatch, setActivityToDispatch] = useState<RepositionActivity | null>(null);
    const [activityToAudit, setActivityToAudit] = useState<RepositionActivity | null>(null);
    const [activityToCancel, setActivityToCancel] = useState<RepositionActivity | null>(null);
    const [activityToFinalize, setActivityToFinalize] = useState<RepositionActivity | null>(null);
    const [isFinalizing, setIsFinalizing] = useState(false);

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        )
    }
    
    const activeActivities = activities.filter(activity => activity.status !== 'Concluído' && activity.status !== 'Cancelada');

    if (activeActivities.length === 0) {
        return (
            <Card className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground border-2 border-dashed">
                <Inbox className="h-12 w-12 mb-4" />
                <h3 className="text-xl font-semibold text-foreground">Nenhuma atividade de reposição</h3>
                <p className="max-w-md mt-2">
                    Quando uma sugestão de reposição for salva na aba "Análise", ela aparecerá aqui para ser gerenciada.
                </p>
            </Card>
        )
    }
    
    const handleExportSeparationList = (activity: RepositionActivity) => {
        alert("A exportação de PDF está em manutenção.");
    };

    const handleCancelConfirm = async () => {
        if (activityToCancel) {
            await cancelRepositionActivity(activityToCancel.id);
            setActivityToCancel(null);
        }
    };
    
    const handleReopenAudit = async (activity: RepositionActivity) => {
        await updateRepositionActivity(activity.id, {
            status: 'Aguardando recebimento',
            receiptNotes: '',
            items: activity.items.map(item => ({
                ...item,
                receivedLots: [],
            }))
        });
    };
    
    const handleFinalizeConfirm = async () => {
        if (!activityToFinalize) return;
        setIsFinalizing(true);
        await finalizeRepositionActivity(activityToFinalize);
        setIsFinalizing(false);
        setActivityToFinalize(null);
    };

    return (
        <>
        <div className="space-y-3">
            {activeActivities.map(activity => (
                <Accordion type="single" collapsible key={activity.id}>
                    <AccordionItem value={activity.id} className="border rounded-lg">
                        <div className="flex items-center p-4">
                            <AccordionTrigger className="p-0 hover:no-underline flex-1 text-left">
                                <div className="flex justify-between items-center w-full">
                                    <div>
                                        <p className="font-semibold text-lg">{activity.kioskOriginName} → {activity.kioskDestinationName}</p>
                                        <p className="text-sm text-muted-foreground">
                                            Solicitado em {format(new Date(activity.createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                    {getStatusBadge(activity.status)}
                                    </div>
                                </div>
                            </AccordionTrigger>
                            {permissions.reposition.cancel && (
                                <DeleteConfirmationDialog
                                    open={false}
                                    onOpenChange={()=>{}}
                                    onConfirm={handleCancelConfirm}
                                    itemName={`a atividade de reposição`}
                                    description="Esta ação não pode ser desfeita. O estoque reservado será liberado e a atividade será movida para o histórico como cancelada."
                                    confirmButtonText="Sim, cancelar atividade"
                                    triggerButton={
                                        <Button variant="ghost" size="icon" className="ml-2 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setActivityToCancel(activity); }}>
                                            <Ban className="h-4 w-4" />
                                        </Button>
                                    }
                                />
                            )}
                        </div>
                        <AccordionContent className="p-4 pt-0">
                             <div className="space-y-4">
                                {activity.items.map((item, index) => {
                                    const hasBeenAudited = activity.status.startsWith('Recebido');

                                    return (
                                        <div key={index} className="p-3 border rounded-md bg-muted/50">
                                            <p className="font-semibold">{item.productName}</p>
                                            <ul className="list-disc pl-5 mt-1 text-sm space-y-1">
                                                {(hasBeenAudited ? item.receivedLots : item.suggestedLots)?.map(lot => {
                                                    const originalLot = item.suggestedLots.find(sl => sl.lotId === lot.lotId);
                                                    const sentQty = originalLot?.quantityToMove || 0;
                                                    const receivedQty = (lot as any).receivedQuantity;
                                                    const hasDivergence = hasBeenAudited && receivedQty !== sentQty;
                                                    
                                                    return (
                                                        <li key={lot.lotId}>
                                                            {hasBeenAudited ? (
                                                                <span className={hasDivergence ? 'text-destructive font-bold' : ''}>
                                                                    Recebido: {receivedQty} / Enviado: {sentQty}
                                                                </span>
                                                            ) : (
                                                                `Enviando: ${sentQty}`
                                                            )}
                                                            <span className="text-muted-foreground"> x {lot.productName} (Lote: {lot.lotNumber})</span>
                                                            {hasDivergence && lot.receiptNotes && (
                                                                <p className="text-xs text-destructive pl-4 border-l-2 border-destructive ml-1 mt-1 italic">"{lot.receiptNotes}"</p>
                                                            )}
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                        </div>
                                    )
                                })}

                                <div className="flex justify-end pt-4 border-t gap-2">
                                     {activity.status === 'Aguardando despacho' && (
                                        <>
                                            <Button variant="outline" onClick={() => handleExportSeparationList(activity)}>
                                                <Download className="mr-2 h-4 w-4" />
                                                Exportar PDF de Separação
                                            </Button>
                                            <Button onClick={() => setActivityToDispatch(activity)}>
                                                <Truck className="mr-2 h-4 w-4" />
                                                Gerenciar Despacho
                                            </Button>
                                        </>
                                    )}
                                    {activity.status === 'Aguardando recebimento' && (
                                         <Button onClick={() => setActivityToAudit(activity)}>
                                            <CheckSquare className="mr-2 h-4 w-4" />
                                            Auditar Recebimento
                                        </Button>
                                    )}
                                    {(activity.status === 'Recebido com divergência' || activity.status === 'Recebido sem divergência') && permissions.stock.stockCount.approve && (
                                        <>
                                            <Button variant="outline" onClick={() => handleReopenAudit(activity)}>
                                                <Undo2 className="mr-2 h-4 w-4" />
                                                Reabrir Auditoria
                                            </Button>
                                            <Button onClick={() => setActivityToFinalize(activity)}>
                                                <BadgeCheck className="mr-2 h-4 w-4" />
                                                Efetivar Movimentação
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            ))}
        </div>
        
        {activityToDispatch && (
            <DispatchModal 
                activity={activityToDispatch}
                onOpenChange={() => setActivityToDispatch(null)}
            />
        )}
        
        {activityToAudit && (
            <AuditReceiptModal
                activity={activityToAudit}
                onOpenChange={() => setActivityToAudit(null)}
            />
        )}

        {activityToFinalize && (
            <DeleteConfirmationDialog 
                open={!!activityToFinalize}
                onOpenChange={() => setActivityToFinalize(null)}
                onConfirm={handleFinalizeConfirm}
                isDeleting={isFinalizing}
                title="Efetivar Movimentação de Estoque?"
                description="Esta ação é irreversível. O estoque será debitado da origem e creditado no destino conforme a auditoria. Deseja continuar?"
                confirmButtonText="Sim, efetivar"
                confirmButtonVariant="default"
            />
        )}
        </>
    );
}
