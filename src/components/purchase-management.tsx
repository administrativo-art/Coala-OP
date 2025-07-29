
"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AutomaticPurchaseList } from "./automatic-purchase-list";
import { PurchaseSessionList } from "./purchase-session-list";
import { PriceHistoryDashboard } from "./price-history-dashboard";
import { History, ShoppingCart, Wand2, ArrowRight } from "lucide-react";

type ActiveView = 'menu' | 'automatic' | 'sessions' | 'history';

function MenuScreen({ setActiveView }: { setActiveView: (view: ActiveView) => void }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="flex flex-col text-center">
                <CardHeader>
                    <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2">
                        <Wand2 className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle>Compra Matriz</CardTitle>
                    <CardDescription>Crie uma sessão de compra com base no estoque mínimo da matriz.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center">
                    <Button className="w-full" onClick={() => setActiveView('automatic')}>
                        Acessar <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </CardContent>
            </Card>
            <Card className="flex flex-col text-center">
                <CardHeader>
                    <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2">
                        <ShoppingCart className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle>Sessões de Compra</CardTitle>
                    <CardDescription>Crie pesquisas manuais ou veja o histórico de compras e orçamentos.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center">
                     <Button className="w-full" onClick={() => setActiveView('sessions')}>
                        Acessar <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </CardContent>
            </Card>
            <Card className="flex flex-col text-center">
                <CardHeader>
                    <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2">
                        <History className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle>Histórico de Preços</CardTitle>
                    <CardDescription>Consulte o histórico de todos os preços de compra que foram efetivados.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center">
                     <Button className="w-full" onClick={() => setActiveView('history')}>
                        Acessar <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

export function PurchaseManagement() {
    const { permissions } = useAuth();
    const [activeView, setActiveView] = useState<ActiveView>('menu');

    const renderView = () => {
        switch (activeView) {
            case 'automatic':
                return <AutomaticPurchaseList />;
            case 'sessions':
                return <PurchaseSessionList />;
            case 'history':
                return <PriceHistoryDashboard />;
            case 'menu':
            default:
                return <MenuScreen setActiveView={setActiveView} />;
        }
    }

    const getTitle = () => {
        switch (activeView) {
            case 'automatic': return "Compra Matriz";
            case 'sessions': return "Sessões de Compra";
            case 'history': return "Histórico de Preços";
            case 'menu':
            default: return "Gestão de compras";
        }
    }
    
    const getDescription = () => {
        switch (activeView) {
            case 'automatic': return "Crie uma sessão de compra com base no estoque mínimo da matriz.";
            case 'sessions': return "Crie pesquisas manuais ou veja o histórico de compras e orçamentos.";
            case 'history': return "Consulte o histórico de todos os preços de compra que foram efetivados.";
            case 'menu':
            default: return "Crie pesquisas de preço, compare custos e efetive suas compras de insumos.";
        }
    }

    return (
        <div className="w-full max-w-7xl mx-auto space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">{getTitle()}</CardTitle>
                    <CardDescription>{getDescription()}</CardDescription>
                     {activeView !== 'menu' && (
                        <Button variant="outline" onClick={() => setActiveView('menu')} className="w-fit">
                            Voltar ao menu de compras
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    {renderView()}
                </CardContent>
            </Card>
        </div>
    );
}
