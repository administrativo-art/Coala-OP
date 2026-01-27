"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PurchaseSessionList } from "./purchase-session-list";
import { PurchaseHistoryDashboard } from "./purchase-history-dashboard";
import { History, ShoppingCart, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";

type ActiveView = 'menu' | 'sessions' | 'history';

function MenuScreen({ setActiveView }: { setActiveView: (view: ActiveView) => void }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="flex flex-col text-center">
                <CardHeader>
                    <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2">
                        <ShoppingCart className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle>Compra geral</CardTitle>
                    <CardDescription>Crie pesquisas manuais ou veja as compras em andamento.</CardDescription>
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
                        <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle>Sugestão de Compra para Matriz</CardTitle>
                    <CardDescription>Use o assistente para analisar a demanda da rede e gerar uma lista inteligente de compras.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center">
                    <Link href="/dashboard/stock/purchasing/suggestion" className="w-full">
                        <Button className="w-full">
                            Gerar Análise de Compra <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                </CardContent>
            </Card>
            <Card className="flex flex-col text-center">
                <CardHeader>
                    <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2">
                        <History className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle>Histórico de compras</CardTitle>
                    <CardDescription>Consulte ordens de compra e o histórico de preços efetivados.</CardDescription>
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
            case 'sessions':
                return <PurchaseSessionList />;
            case 'history':
                return <PurchaseHistoryDashboard />;
            case 'menu':
            default:
                return <MenuScreen setActiveView={setActiveView} />;
        }
    }

    const getTitle = () => {
        switch (activeView) {
            case 'sessions': return "Compra geral";
            case 'history': return "Histórico de compras";
            case 'menu':
            default: return "Gestão de compras";
        }
    }
    
    const getDescription = () => {
        switch (activeView) {
            case 'sessions': return "Crie pesquisas manuais ou veja as compras em andamento.";
            case 'history': return "Consulte ordens de compra finalizadas e o histórico de preços.";
            case 'menu':
            default: return "Crie pesquisas de preço, compare custos e efetive suas compras de insumos.";
        }
    }

    return (
        <div className="w-full max-w-7xl mx-auto space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div>
                            <CardTitle className="font-headline">{getTitle()}</CardTitle>
                            <CardDescription>{getDescription()}</CardDescription>
                        </div>
                        {activeView !== 'menu' && (
                            <Button variant="outline" onClick={() => setActiveView('menu')} className="shrink-0">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Voltar para o menu de compras
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {renderView()}
                </CardContent>
            </Card>
        </div>
    );
}
