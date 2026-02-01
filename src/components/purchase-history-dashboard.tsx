"use client";

import { useState, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, parseISO } from "date-fns";
import { ptBR } from 'date-fns/locale';
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type PriceHistoryEntry } from "@/types";
import { Inbox, Search, Package, Building, Eraser, Trash2, Eye, LineChart } from "lucide-react";
import { useProducts } from "@/hooks/use-products";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useEntities } from "@/hooks/use-entities";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { PurchaseSessionCard } from './purchase-session-card';
import { DynamicPriceQuery } from './dynamic-price-query';

function PurchaseOrderList() {
    const { sessions, loading } = usePurchase();

    const closedSessions = useMemo(() => {
        return sessions.filter(s => s.status === 'closed');
    }, [sessions]);

    if(loading) {
        return <Skeleton className="h-96 w-full" />;
    }
    
    return (
        <div className="space-y-4">
            {closedSessions.length > 0 ? (
                <div className="space-y-3">
                    {closedSessions.map(session => (
                        <PurchaseSessionCard key={session.id} session={session} />
                    ))}
                </div>
            ) : (
                 <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                    <Inbox className="h-12 w-12 mb-4" />
                    <p className="font-semibold">Nenhuma ordem de compra finalizada.</p>
                </div>
            )}
        </div>
    )
}

export function PurchaseHistoryDashboard() {
    return (
        <Tabs defaultValue="orders">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="orders">Ordens de Compra</TabsTrigger>
                <TabsTrigger value="query"><LineChart className="mr-2 h-4 w-4"/>Consulta Dinâmica</TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="mt-4">
                <PurchaseOrderList />
            </TabsContent>
            <TabsContent value="query" className="mt-4">
                <DynamicPriceQuery />
            </TabsContent>
        </Tabs>
    );
}
