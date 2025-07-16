
"use client";

import { useState } from "react";
import { useReposition } from "@/hooks/use-reposition";
import { useKiosks } from "@/hooks/use-kiosks";
import { Skeleton } from "./ui/skeleton";
import { Card } from "./ui/card";
import { Inbox, Truck, AlertTriangle } from "lucide-react";
import { type RepositionActivity } from "@/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { DispatchModal } from "./dispatch-modal";

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
        default:
            return <Badge>{status}</Badge>;
    }
}

export function RepositionManagement() {
    const { activities, loading } = useReposition();
    const { kiosks } = useKiosks();
    const [activityToDispatch, setActivityToDispatch] = useState<RepositionActivity | null>(null);

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        )
    }

    if (activities.length === 0) {
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

    return (
        <>
        <div className="space-y-3">
            {activities.map(activity => (
                <Accordion type="single" collapsible key={activity.id}>
                    <AccordionItem value={activity.id} className="border rounded-lg">
                        <AccordionTrigger className="p-4 hover:no-underline">
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
                        <AccordionContent className="p-4 pt-0">
                            <div className="space-y-4">
                                {activity.items.map((item, index) => (
                                    <div key={index} className="p-3 border rounded-md bg-muted/50">
                                        <p className="font-semibold">{item.productName}</p>
                                        <ul className="list-disc pl-5 mt-1 text-sm">
                                            {item.suggestedLots.map(lot => (
                                                <li key={lot.lotId}>
                                                    {lot.quantityToMove}x {lot.productName} (Lote: {lot.lotId.slice(-6)})
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}

                                {activity.status === 'Aguardando despacho' && (
                                     <div className="flex justify-end pt-4 border-t">
                                        <Button onClick={() => setActivityToDispatch(activity)}>
                                            <Truck className="mr-2 h-4 w-4" />
                                            Gerenciar Despacho
                                        </Button>
                                    </div>
                                )}
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
        </>
    );
}
