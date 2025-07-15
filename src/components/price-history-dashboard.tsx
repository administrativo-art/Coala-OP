
"use client";

import { useMemo, useState } from 'react';
import { usePurchase } from '@/hooks/use-purchase';
import { useProducts } from '@/hooks/use-products';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { Inbox, Search, Package, Building, Eraser } from 'lucide-react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';

export function PriceHistoryDashboard() {
    const { priceHistory, loading } = usePurchase();
    const { getProductFullName, products } = useProducts();
    const { users } = useAuth();
    const { entities } = useEntities();

    const [searchTerm, setSearchTerm] = useState('');
    const [productFilter, setProductFilter] = useState('all');
    const [entityFilter, setEntityFilter] = useState('all');
    
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
        return enrichedHistory.filter(entry => {
            const searchLower = searchTerm.toLowerCase();
            const searchMatch = entry.productName.toLowerCase().includes(searchLower) ||
                                entry.entityName.toLowerCase().includes(searchLower) ||
                                entry.confirmedByUsername.toLowerCase().includes(searchLower);

            const productMatch = productFilter === 'all' || entry.productId === productFilter;
            const entityMatch = entityFilter === 'all' || entry.entityId === entityFilter;

            return searchMatch && productMatch && entityMatch;
        });
    }, [enrichedHistory, searchTerm, productFilter, entityFilter]);

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
                <Button variant="ghost" onClick={() => { setSearchTerm(''); setProductFilter('all'); setEntityFilter('all'); }}>
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
                                    <TableHead>Preço Efetivado</TableHead>
                                    <TableHead>Efetivado por</TableHead>
                                    <TableHead className="text-right">Data</TableHead>
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
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </ScrollArea>
            )}
        </div>
    );
}
