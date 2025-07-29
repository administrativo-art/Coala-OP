
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
import { Inbox, Search, Package, Building, Eraser, Trash2, Eye } from "lucide-react";
import { useProducts } from "@/hooks/use-products";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useEntities } from "@/hooks/use-entities";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { PurchaseSessionCard } from './purchase-session-card';

function PriceHistoryList() {
    const { priceHistory, loading, deletePriceHistoryEntry } = usePurchase();
    const { getProductFullName, products } = useProducts();
    const { users, permissions } = useAuth();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();

    const [searchTerm, setSearchTerm] = useState('');
    const [productFilter, setProductFilter] = useState('all');
    const [entityFilter, setEntityFilter] = useState('all');
    const [entryToDelete, setEntryToDelete] = useState<PriceHistoryEntry | null>(null);
    const [priceLimit, setPriceLimit] = useState<string>('3');

    const enrichedHistory = useMemo(() => {
        return priceHistory.map(entry => {
            const product = products.find(p => p.id === entry.productId);
            const entity = entities.find(e => e.id === entry.entityId);
            const user = users.find(u => u.id === entry.confirmedBy);

            return {
                ...entry,
                productName: product ? getProductFullName(product) : 'Insumo não encontrado',
                entityName: entity?.name || 'Fornecedor não encontrado',
                confirmedByUsername: user?.username || 'Usuário desconhecido',
            };
        });
    }, [priceHistory, products, entities, users, getProductFullName]);

    const filteredHistory = useMemo(() => {
        const initialFilter = enrichedHistory.filter(entry => {
            const searchLower = searchTerm.toLowerCase();
            const searchMatch = entry.productName.toLowerCase().includes(searchLower) ||
                                entry.entityName.toLowerCase().includes(searchLower) ||
                                entry.confirmedByUsername.toLowerCase().includes(searchLower);

            const productMatch = productFilter === 'all' || entry.productId === productFilter;
            const entityMatch = entityFilter === 'all' || entry.entityId === entityFilter;

            return searchMatch && productMatch && entityMatch;
        });

        if (priceLimit === 'all') {
            return initialFilter;
        }

        const limit = parseInt(priceLimit, 10);
        const grouped = new Map<string, PriceHistoryEntry[]>();

        initialFilter.forEach(entry => {
            const key = `${entry.productId}-${entry.entityId}`;
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(entry);
        });

        const limitedResult: PriceHistoryEntry[] = [];
        grouped.forEach(group => {
            limitedResult.push(...group.slice(0, limit));
        });
        
        return limitedResult.sort((a,b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime());

    }, [enrichedHistory, searchTerm, productFilter, entityFilter, priceLimit]);
    
    const handleDeleteConfirm = () => {
        if(entryToDelete) {
            deletePriceHistoryEntry(entryToDelete.id);
            setEntryToDelete(null);
        }
    }
    
    const canDeleteHistory = permissions.purchasing.deleteHistory;

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    const uniqueProducts = Array.from(new Map(enrichedHistory.map(item => [item.productId, { id: item.productId, name: item.productName }])).values());
    const uniqueEntities = Array.from(new Map(enrichedHistory.map(item => [item.entityId, { id: item.entityId, name: item.entityName }])).values());

    return (
        <div className="space-y-4">
             <div className="flex flex-col sm:flex-row items-center gap-2 p-3 border rounded-lg bg-muted/50">
                <div className="relative flex-grow w-full">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar no histórico..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full"
                    />
                </div>
                <Select value={productFilter} onValueChange={setProductFilter}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Filtrar por insumo" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all"><Package className="mr-2"/> Todos os Insumos</SelectItem>
                        {uniqueProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <Select value={entityFilter} onValueChange={setEntityFilter}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Filtrar por fornecedor" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all"><Building className="mr-2"/> Todos os Fornecedores</SelectItem>
                        {uniqueEntities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <Select value={priceLimit} onValueChange={setPriceLimit}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Visibilidade" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="1"><Eye className="mr-2 h-4 w-4"/>Último preço</SelectItem>
                        <SelectItem value="3"><Eye className="mr-2 h-4 w-4"/>Últimos 3</SelectItem>
                        <SelectItem value="5"><Eye className="mr-2 h-4 w-4"/>Últimos 5</SelectItem>
                        <SelectItem value="all"><Eye className="mr-2 h-4 w-4"/>Todos</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="ghost" onClick={() => { setSearchTerm(''); setProductFilter('all'); setEntityFilter('all'); setPriceLimit('3'); }}>
                    <Eraser className="mr-2 h-4 w-4" />
                    Limpar
                </Button>
            </div>

            {filteredHistory.length === 0 ? (
                 <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                    <Inbox className="h-12 w-12 mb-4" />
                    <p className="font-semibold">Nenhum registro encontrado</p>
                    <p className="text-sm">Tente ajustar os filtros ou a busca.</p>
                </div>
            ) : (
                <ScrollArea className="h-96">
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Insumo</TableHead>
                                    <TableHead>Fornecedor</TableHead>
                                    <TableHead>Preço por Unidade</TableHead>
                                    <TableHead>Efetivado por</TableHead>
                                    <TableHead className="text-right">Data</TableHead>
                                    {canDeleteHistory && <TableHead className="text-right">Ações</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredHistory.map(entry => (
                                    <TableRow key={entry.id}>
                                        <TableCell className="font-medium">{entry.productName}</TableCell>
                                        <TableCell>{entry.entityName}</TableCell>
                                        <TableCell className="font-semibold text-primary">
                                            {entry.pricePerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </TableCell>
                                        <TableCell>{entry.confirmedByUsername}</TableCell>
                                        <TableCell className="text-right">
                                            {format(parseISO(entry.confirmedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                                        </TableCell>
                                        {canDeleteHistory && (
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setEntryToDelete(entry)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </ScrollArea>
            )}
             <DeleteConfirmationDialog 
                open={!!entryToDelete}
                onOpenChange={() => setEntryToDelete(null)}
                onConfirm={handleDeleteConfirm}
                itemName={`o registro de preço de "${entryToDelete?.productName}"`}
            />
        </div>
    );
}

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
                <TabsTrigger value="prices">Histórico de Preços</TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="mt-4">
                <PurchaseOrderList />
            </TabsContent>
            <TabsContent value="prices" className="mt-4">
                <PriceHistoryList />
            </TabsContent>
        </Tabs>
    );
}
