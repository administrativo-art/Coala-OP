
"use client"

import { useMovementHistory } from "@/hooks/use-movement-history";
import { useProducts } from "@/hooks/use-products";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { History } from 'lucide-react';
import { useMemo } from "react";

export function MovementAnalysis() {
    const { history, loading } = useMovementHistory();
    const { products, getProductFullName, loading: productsLoading } = useProducts();

    const historyWithProducts = useMemo(() => {
        if (loading || productsLoading || !products.length) return [];
        return history.map(record => {
          const product = products.find(p => record.productName.startsWith(p.baseName));
          return {
            ...record,
            displayName: product ? getProductFullName(product) : record.productName,
          };
        });
    }, [history, products, loading, productsLoading, getProductFullName]);

    if (loading || productsLoading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-8 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-64 w-full" />
                </CardContent>
            </Card>
        )
    }

    if (historyWithProducts.length === 0) {
        return (
            <div className="text-center py-16 flex flex-col items-center text-muted-foreground border-2 border-dashed rounded-lg">
                <History className="h-16 w-16 mb-4" />
                <h3 className="text-xl font-semibold text-foreground">Sem histórico de movimentações</h3>
                <p>Nenhuma transferência de estoque entre quiosques foi registrada ainda.</p>
            </div>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Histórico de Movimentações</CardTitle>
                <CardDescription>Veja todas as transferências de estoque entre os quiosques.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Data</TableHead>
                                <TableHead>Produto</TableHead>
                                <TableHead>Lote</TableHead>
                                <TableHead className="text-right">Qtd.</TableHead>
                                <TableHead>Origem</TableHead>
                                <TableHead>Destino</TableHead>
                                <TableHead>Usuário</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {historyWithProducts.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span>{format(parseISO(item.movedAt), "dd/MM/yy", { locale: ptBR })}</span>
                                            <span className="text-xs text-muted-foreground">{format(parseISO(item.movedAt), "HH:mm", { locale: ptBR })}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium">{item.displayName}</TableCell>
                                    <TableCell>{item.lotNumber}</TableCell>
                                    <TableCell className="text-right font-semibold">{item.quantityMoved}</TableCell>
                                    <TableCell>{item.fromKioskName}</TableCell>
                                    <TableCell>{item.toKioskName}</TableCell>
                                    <TableCell>{item.movedByUsername}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}
