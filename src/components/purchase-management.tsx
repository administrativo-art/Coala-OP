
"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutomaticPurchaseList } from "./automatic-purchase-list";
import { ManualPurchaseList } from "./manual-purchase-list";
import { PriceHistoryDashboard } from "./price-history-dashboard";
import { History, ShoppingCart, Wand2 } from "lucide-react";


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
                    <Tabs defaultValue="automatic">
                        <TabsList className="grid w-full grid-cols-3">
                             <TabsTrigger value="automatic">
                                <Wand2 className="mr-2 h-4 w-4"/>
                                Lista Automática (Matriz)
                            </TabsTrigger>
                            <TabsTrigger value="manual">
                                <ShoppingCart className="mr-2 h-4 w-4"/>
                                Pesquisas Manuais
                            </TabsTrigger>
                            <TabsTrigger value="history">
                                <History className="mr-2 h-4 w-4"/>
                                Histórico de preços
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="automatic" className="mt-6">
                            <AutomaticPurchaseList />
                        </TabsContent>
                        <TabsContent value="manual" className="mt-6">
                            <ManualPurchaseList />
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
