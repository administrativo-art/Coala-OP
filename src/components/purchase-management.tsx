
"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PurchaseSessionList } from "./purchase-session-list";
import { PriceHistoryDashboard } from "./price-history-dashboard";
import { History, ShoppingCart } from "lucide-react";


export function PurchaseManagement() {
    const { permissions } = useAuth();
    
    return (
        <div className="w-full max-w-7xl mx-auto space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Gestão de compras</CardTitle>
                    <CardDescription>Crie pesquisas de preço, compare custos e efetive suas compras de insumos.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="sessions">
                        <TabsList className="grid w-full grid-cols-2">
                             <TabsTrigger value="sessions">
                                <ShoppingCart className="mr-2 h-4 w-4"/>
                                Pesquisas Atuais
                            </TabsTrigger>
                            <TabsTrigger value="history">
                                <History className="mr-2 h-4 w-4"/>
                                Histórico de Preços
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="sessions" className="mt-6">
                            <PurchaseSessionList />
                        </TabsContent>
                        <TabsContent value="history" className="mt-6">
                            <PriceHistoryDashboard />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    );
}
