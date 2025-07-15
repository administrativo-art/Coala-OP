
"use client";

import { useState, useMemo, useEffect } from "react";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { convertValue } from "@/lib/conversion";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { type Product, type PurchaseItem, type BaseProduct, type Entity } from "@/types";
import { Star, CheckCircle, AlertTriangle, Info } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useProducts } from "@/hooks/use-products";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useEntities } from "@/hooks/use-entities";

interface PriceComparisonTableProps {
    baseProductId: string;
    items: PurchaseItem[];
    sessionId: string;
}

interface PriceRow {
    product: Product;
    price: string;
    pricePerUnit: number | null;
    isBestPrice: boolean;
    isWorstPrice: boolean;
    purchaseItem?: PurchaseItem;
}

export function PriceComparisonTable({ baseProductId, items, sessionId }: PriceComparisonTableProps) {
    const { getProductFullName, products } = useProducts();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { savePrice, confirmPurchase, lastEffectivePrices } = usePurchase();
    const { permissions } = useAuth();
    
    const [prices, setPrices] = useState<Record<string, string>>({});
    const [debouncedPrices] = useDebounce(prices, 500);

    const baseProduct = useMemo(() => baseProducts.find(bp => bp.id === baseProductId), [baseProductId, baseProducts]);
    const linkedProducts = useMemo(() => products.filter(p => p.baseProductId === baseProductId), [products, baseProductId]);

    useEffect(() => {
        const initialPrices: Record<string, string> = {};
        linkedProducts.forEach(p => {
            const item = items.find(i => i.productId === p.id);
            if (item && item.price > 0) {
                initialPrices[p.id] = item.price.toString();
            } else {
                initialPrices[p.id] = "";
            }
        });
        setPrices(initialPrices);
    }, [linkedProducts, items]);

    useEffect(() => {
        if (!sessionId) return;
        
        Object.entries(debouncedPrices).forEach(([productId, priceStr]) => {
            const price = parseFloat(priceStr);
            if (!isNaN(price) && price > 0) {
                const existingItem = items.find(i => i.productId === productId);
                if (!existingItem || existingItem.price !== price) {
                    savePrice(sessionId, productId, price);
                }
            }
        });
    }, [debouncedPrices, sessionId, savePrice, items]);

    const handlePriceChange = (productId: string, value: string) => {
        setPrices(prev => ({ ...prev, [productId]: value }));
    };

    const handleConfirm = (productId: string, pricePerUnit: number | null) => {
        const item = items.find(i => i.productId === productId);
        if (item && baseProduct && pricePerUnit) {
            confirmPurchase(item.id, baseProduct.id, pricePerUnit);
        }
    };

    const tableData = useMemo((): PriceRow[] => {
        if (!baseProduct) return [];
        const rows = linkedProducts.map(p => {
            const priceStr = prices[p.id] || "";
            const price = parseFloat(priceStr);
            let pricePerUnit: number | null = null;
            if (!isNaN(price) && price > 0) {
                const convertedQty = convertValue(p.packageSize, p.unit, baseProduct.unit, p.category);
                if (convertedQty > 0) {
                    pricePerUnit = price / convertedQty;
                }
            }
            
            return {
                product: p,
                price: priceStr,
                pricePerUnit,
                isBestPrice: false,
                isWorstPrice: false,
                purchaseItem: items.find(i => i.productId === p.id),
            };
        });

        const validPrices = rows
            .map(r => r.pricePerUnit)
            .filter((p): p is number => p !== null && p > 0);

        if (validPrices.length > 1) {
            const minPrice = Math.min(...validPrices);
            const maxPrice = Math.max(...validPrices);
            rows.forEach(row => {
                if (row.pricePerUnit === minPrice) {
                    row.isBestPrice = true;
                }
                if (row.pricePerUnit === maxPrice) {
                    row.isWorstPrice = true;
                }
            });
        }
        return rows.sort((a,b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product)));
    }, [linkedProducts, prices, baseProduct, items, getProductFullName]);
    
    if (!baseProduct) {
        return <div className="text-center text-muted-foreground p-4">Produto base não encontrado.</div>;
    }
    
    if (linkedProducts.length === 0) {
        return (
            <div className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">
                Nenhum insumo vinculado a este produto base. Adicione insumos na tela de "Cadastros".
            </div>
        );
    }
    
    const canApprove = permissions.purchasing.approve;

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Variação do Insumo</TableHead>
                        <TableHead className="w-[150px]">Último Preço (R$)</TableHead>
                        <TableHead className="w-[150px]">Preço Atual (R$)</TableHead>
                        <TableHead className="w-[150px]">R$ / {baseProduct.unit}</TableHead>
                        <TableHead className="w-[150px] text-center">Status</TableHead>
                        <TableHead className="w-[120px] text-right">Ação</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {tableData.map(row => {
                        const lastPriceInfo = lastEffectivePrices.get(row.product.id);
                        const lastSupplier = lastPriceInfo ? entities.find(e => e.id === lastPriceInfo.entityId) : null;
                        
                        let lastTotalPrice: number | null = null;
                        if (lastPriceInfo) {
                            const packageSizeInBaseUnit = convertValue(row.product.packageSize, row.product.unit, baseProduct.unit, row.product.category);
                            if (packageSizeInBaseUnit > 0) {
                                lastTotalPrice = lastPriceInfo.pricePerUnit * packageSizeInBaseUnit;
                            }
                        }

                        return (
                        <TableRow key={row.product.id}>
                            <TableCell className="font-medium">
                                {getProductFullName(row.product)}
                            </TableCell>
                            <TableCell>
                                {lastPriceInfo ? (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="text-sm text-muted-foreground flex items-center gap-1 cursor-default">
                                                    <Info className="h-3 w-3" />
                                                    {lastTotalPrice !== null ? lastTotalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : "-"}
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Fornecedor: {lastSupplier?.name || 'Não encontrado'}</p>
                                                <p>Preço unitário: {lastPriceInfo.pricePerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{baseProduct.unit}</p>
                                                <p>Data: {format(new Date(lastPriceInfo.updatedAt), 'dd/MM/yyyy', {locale: ptBR})}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                ) : (
                                    <span className="text-sm text-muted-foreground">-</span>
                                )}
                            </TableCell>
                            <TableCell>
                                <Input
                                    type="number"
                                    placeholder="0,00"
                                    value={row.price}
                                    onChange={e => handlePriceChange(row.product.id, e.target.value)}
                                    disabled={!permissions.purchasing.suggest || row.purchaseItem?.isConfirmed}
                                />
                            </TableCell>
                            <TableCell>
                                {row.pricePerUnit !== null ? `${row.pricePerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                                {row.purchaseItem?.isConfirmed ? (
                                     <Badge variant="secondary" className="bg-green-100 text-green-800">
                                        <CheckCircle className="mr-1 h-3 w-3" />
                                        Confirmado
                                    </Badge>
                                ) : row.isBestPrice ? (
                                    <Badge className="bg-amber-100 text-amber-800">
                                        <Star className="mr-1 h-3 w-3" />
                                        Melhor preço
                                    </Badge>
                                ) : row.isWorstPrice ? (
                                     <Badge variant="destructive" className="bg-red-100 text-red-800">
                                        <AlertTriangle className="mr-1 h-3 w-3" />
                                        Pior preço
                                    </Badge>
                                ) : (
                                    <Badge variant="outline">Pendente</Badge>
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div>
                                                <Button 
                                                    size="sm" 
                                                    onClick={() => handleConfirm(row.product.id, row.pricePerUnit)}
                                                    disabled={!canApprove || !row.purchaseItem || row.purchaseItem.isConfirmed || !row.pricePerUnit}
                                                >
                                                    Efetivar
                                                </Button>
                                            </div>
                                        </TooltipTrigger>
                                        {!canApprove && (
                                            <TooltipContent>
                                                <p>Você não tem permissão para aprovar compras.</p>
                                            </TooltipContent>
                                        )}
                                    </Tooltip>
                                </TooltipProvider>
                            </TableCell>
                        </TableRow>
                    )})}
                </TableBody>
            </Table>
        </div>
    );
}
