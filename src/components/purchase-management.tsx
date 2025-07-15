
"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { useEntities } from "@/hooks/use-entities";
import { useBaseProducts } from "@/hooks/use-base-products";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Search, History, Inbox } from "lucide-react";
import { StartPurchaseSessionModal } from "./start-purchase-session-modal";
import { PurchaseSessionCard } from "./purchase-session-card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Input } from "./ui/input";
import { PriceHistoryLog } from "./price-history-log";

export function PurchaseManagement() {
    const { user, users, permissions } = useAuth();
    const { sessions, loading: loadingPurchase } = usePurchase();
    const { entities, loading: loadingEntities } = useEntities();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    
    const baseProductMap = useMemo(() => {
        return new Map(baseProducts.map(bp => [bp.id, bp.name]));
    }, [baseProducts]);

    const { openSessions, closedSessions } = useMemo(() => {
        const lowerCaseSearch = searchTerm.toLowerCase();

        const filterSession = (session: typeof sessions[0]) => {
            if (!lowerCaseSearch) return true;
            const entity = entities.find(e => e.id === session.entityId);
            const createdByUser = users.find(u => u.id === session.userId);
            const hasMatchingBaseProduct = session.baseProductIds.some(bpId => {
                const bpName = baseProductMap.get(bpId);
                return bpName && bpName.toLowerCase().includes(lowerCaseSearch);
            });

            return (
                session.description.toLowerCase().includes(lowerCaseSearch) ||
                (entity && entity.name.toLowerCase().includes(lowerCaseSearch)) ||
                (createdByUser && createdByUser.username.toLowerCase().includes(lowerCaseSearch)) ||
                hasMatchingBaseProduct
            );
        };

        const open: typeof sessions = [];
        const closed: typeof sessions = [];
        sessions.forEach(s => {
            if (filterSession(s)) {
                (s.status === 'open' ? open : closed).push(s);
            }
        });
        return { openSessions: open, closedSessions: closed };
    }, [sessions, searchTerm, entities, users, baseProductMap]);

    const isLoading = loadingPurchase || loadingEntities || loadingBaseProducts;

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
                    <p className="font-semibold">{searchTerm ? "Nenhum resultado encontrado" : emptyMessage}</p>
                    {searchTerm && <p className="text-sm">Tente ajustar sua busca.</p>}
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
        <div className="w-full max-w-7xl mx-auto space-y-6">
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
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por título, fornecedor ou insumo..."
                            className="pl-10"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    
                    <Accordion type="multiple" defaultValue={['open-sessions']} className="w-full space-y-4">
                        <AccordionItem value="open-sessions" className="border-none">
                            <AccordionTrigger className="text-lg font-semibold text-muted-foreground p-0 hover:no-underline">
                                <h3>Pesquisas em aberto</h3>
                            </AccordionTrigger>
                            <AccordionContent className="pt-4">
                                {renderSessionList(openSessions, "Nenhuma pesquisa de preços em andamento.")}
                            </AccordionContent>
                        </AccordionItem>
                        
                        {permissions.purchasing.viewHistory && (
                            <AccordionItem value="session-history" className="border-none">
                                <AccordionTrigger className="text-lg font-semibold text-muted-foreground p-0 hover:no-underline">
                                    <div className="flex items-center gap-2">
                                        <History /> Histórico de Pesquisas
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pt-4">
                                    {renderSessionList(closedSessions, "Nenhuma pesquisa no histórico.")}
                                </AccordionContent>
                            </AccordionItem>
                        )}
                    </Accordion>
                </CardContent>
            </Card>

            {permissions.purchasing.viewHistory && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                           <History /> Histórico de Preços Efetivados
                        </CardTitle>
                         <CardDescription>
                            Um registro de todos os preços de compra que foram confirmados no sistema.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <PriceHistoryLog />
                    </CardContent>
                </Card>
            )}

            <StartPurchaseSessionModal
                open={isCreateModalOpen}
                onOpenChange={setIsCreateModalOpen}
            />
        </div>
    );
}
