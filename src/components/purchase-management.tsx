
"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Search, History, Inbox } from "lucide-react";
import { StartPurchaseSessionModal } from "./start-purchase-session-modal";
import { PurchaseSessionCard } from "./purchase-session-card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";

export function PurchaseManagement() {
    const { user, permissions } = useAuth();
    const { sessions, loading: loadingPurchase } = usePurchase();

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const { openSessions, closedSessions } = useMemo(() => {
        const open: typeof sessions = [];
        const closed: typeof sessions = [];
        sessions.forEach(s => {
            (s.status === 'open' ? open : closed).push(s);
        });
        return { openSessions: open, closedSessions: closed };
    }, [sessions]);

    const isLoading = loadingPurchase;

    const renderSessionList = (list: typeof sessions, emptyMessage: string) => {
        if (isLoading) {
            return (
                <div className="space-y-4">
                    <Skeleton className="h-48 w-full" />
                </div>
            );
        }
        if (list.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                    <Inbox className="h-12 w-12 mb-4" />
                    <p className="font-semibold">{emptyMessage}</p>
                </div>
            )
        }
        return (
            <div className="space-y-4">
                {list.map(session => (
                    <PurchaseSessionCard key={session.id} session={session} />
                ))}
            </div>
        )
    }

    return (
        <div className="w-full max-w-7xl mx-auto">
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div>
                            <CardTitle className="font-headline">Gestão de compras</CardTitle>
                            <CardDescription>Crie pesquisas de preço, compare custos e efetive suas compras de insumos.</CardDescription>
                        </div>
                        {permissions.purchasing.suggest && (
                            <Button onClick={() => setIsCreateModalOpen(true)}>
                                <PlusCircle className="mr-2" />
                                Registrar nova pesquisa
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <h3 className="text-lg font-semibold text-muted-foreground border-b pb-2">Pesquisas em aberto</h3>
                    {renderSessionList(openSessions, "Nenhuma pesquisa de preços em andamento.")}

                    {permissions.purchasing.viewHistory && closedSessions.length > 0 && (
                         <Accordion type="single" collapsible className="w-full pt-6">
                            <AccordionItem value="history">
                                <AccordionTrigger className="text-lg font-semibold text-muted-foreground">
                                    <div className="flex items-center gap-2">
                                        <History /> Histórico de Pesquisas ({closedSessions.length})
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pt-4">
                                     {renderSessionList(closedSessions, "Nenhuma pesquisa no histórico.")}
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    )}
                </CardContent>
            </Card>

            <StartPurchaseSessionModal
                open={isCreateModalOpen}
                onOpenChange={setIsCreateModalOpen}
            />
        </div>
    );
}
