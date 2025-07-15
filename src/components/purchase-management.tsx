
"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Search } from "lucide-react";
import { StartPurchaseSessionModal } from "./start-purchase-session-modal";
import { PurchaseSessionCard } from "./purchase-session-card";

export function PurchaseManagement() {
    const { user, permissions } = useAuth();
    const { sessions, loading: loadingPurchase } = usePurchase();

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const openSessions = sessions.filter(s => s.status === 'open');
    const isLoading = loadingPurchase;

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
                    {isLoading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-48 w-full" />
                            <Skeleton className="h-48 w-full" />
                        </div>
                    ) : openSessions.length > 0 ? (
                        <div className="space-y-4">
                            {openSessions.map(session => (
                                <PurchaseSessionCard key={session.id} session={session} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                            <Search className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Nenhuma pesquisa de preços em andamento</p>
                            <p className="text-sm">Clique em "Registrar nova pesquisa" para começar.</p>
                        </div>
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
