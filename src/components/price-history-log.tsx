
"use client"

import { useMemo } from 'react';
import { usePurchase } from '@/hooks/use-purchase';
import { useProducts } from '@/hooks/use-products';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { Inbox } from 'lucide-react';


export function PriceHistoryLog() {
    const { priceHistory, loading } = usePurchase();
    const { getProductFullName, products } = useProducts();
    const { users } = useAuth();
    const { entities } = useEntities();
    
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
    
    if (loading) {
        return <Skeleton className="h-64 w-full" />;
    }

    if (enrichedHistory.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                <Inbox className="h-12 w-12 mb-4" />
                <p className="font-semibold">Nenhum preço efetivado ainda</p>
                <p className="text-sm">O histórico de preços aparecerá aqui após a primeira compra.</p>
            </div>
        )
    }

    return (
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
                        {enrichedHistory.map(entry => (
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
    );
}

