

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
import { Star, CheckCircle, AlertTriangle, Info, Building } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useProducts } from "@/hooks/use-products";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useEntities } from "@/hooks/use-entities";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface PriceComparisonTableProps {
    baseProductId: string;
    items: PurchaseItem[];
    sessionId: string;
    isSessionClosed: boolean;
}

interface PriceRow {
    product: Product;
    entityId: string;
    price: string;
    pricePerUnit: number | null;
    isBestPrice: boolean;
    isWorstPrice: boolean;
    purchaseItem?: PurchaseItem;
}

export function PriceComparisonTable({ baseProductId, items, sessionId, isSessionClosed }: PriceComparisonTableProps) {
    const { getProductFullName, products } = useProducts();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { savePrice, confirmPurchase, lastSavedPrices } = usePurchase();
    const { permissions } = useAuth();
    
    const [localData, setLocalData] = useState<Record<string, { price: string; entityId: string }>>({});
    const [debouncedData] = useDebounce(localData, 500);

    const baseProduct = useMemo(() => baseProducts.find(bp => bp.id === baseProductId), [baseProductId, baseProducts]);
    const linkedProducts = useMemo(() => products.filter(p => p.baseProductId === baseProductId), [products, baseProductId]);
    const suppliers = useMemo(() => entities.filter(e => e.type === 'pessoa_juridica'), [entities]);
    const lastPurchaseForBaseProduct = useMemo(() => baseProduct?.lastEffectivePrice, [baseProduct]);

    useEffect(() => {
        const initialData: Record<string, { price: string; entityId: string }> = {};
        linkedProducts.forEach(p => {
            const item = items.find(i => i.productId === p.id);
            if (item) {
                initialData[p.id] = {
                    price: item.price > 0 ? item.price.toString() : "",
                    entityId: item.entityId || lastPurchaseForBaseProduct?.entityId || ""
                };
            } else {
                 initialData[p.id] = {
                    price: "",
                    entityId: lastPurchaseForBaseProduct?.entityId || ""
                };
            }
        });
        setLocalData(initialData);
    }, [linkedProducts, items, lastPurchaseForBaseProduct]);

    useEffect(() => {
        if (!sessionId || isSessionClosed) return;
        
        Object.entries(debouncedData).forEach(([productId, data]) => {
            const price = parseFloat(data.price);
            const entityId = data.entityId;
            const existingItem = items.find(i => i.productId === productId);

            // Only save if there's a price and either price or entity has changed
            if (!isNaN(price) && price > 0) {
                 if (!existingItem || existingItem.price !== price || existingItem.entityId !== entityId) {
                    savePrice(sessionId, productId, price, entityId);
                }
            }
        });
    }, [debouncedData, sessionId, savePrice, items, isSessionClosed]);

    const handleLocalDataChange = (productId: string, field: 'price' | 'entityId', value: string) => {
        setLocalData(prev => ({
            ...prev,
            [productId]: {
                ...prev[productId],
                [field]: value,
            },
        }));
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
            const data = localData[p.id] || { price: '', entityId: '' };
            const price = parseFloat(data.price);
            let pricePerUnit: number | null = null;

            if (!isNaN(price) && price > 0) {
                const convertedQty = convertValue(p.packageSize, p.unit, baseProduct.unit, p.category);
                if (convertedQty > 0) {
                    pricePerUnit = price / convertedQty;
                }
            }
            
            return {
                product: p,
                price: data.price,
                entityId: data.entityId,
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
                if (row.pricePerUnit === minPrice) row.isBestPrice = true;
                if (row.pricePerUnit === maxPrice) row.isWorstPrice = true;
            });
        }
        return rows.sort((a,b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product)));
    }, [linkedProducts, localData, baseProduct, items, getProductFullName]);
    
    if (!baseProduct) {
        return <div className="text-center text-muted-foreground p-4">Produto base não encontrado.</div>;
    }
    
    if (linkedProducts.length === 0) {
        return (
            <div className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">
                Nenhum insumo vinculado a este produto base. Adicione insumos na tela de "cadastros".
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
                        <TableHead className="w-[200px]">Fornecedor</TableHead>
                        <TableHead className="w-[150px]">Preço Atual (R$)</TableHead>
                        <TableHead className="w-[150px]">R$ / {baseProduct.unit}</TableHead>
                        <TableHead className="w-[150px] text-center">Status</TableHead>
                        <TableHead className="w-[120px] text-right">Ação</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {tableData.map(row => (
                        <TableRow key={row.product.id}>
                            <TableCell className="font-medium">
                                {getProductFullName(row.product)}
                            </TableCell>
                             <TableCell>
                                <Select 
                                    value={row.entityId} 
                                    onValueChange={value => handleLocalDataChange(row.product.id, 'entityId', value)}
                                    disabled={!permissions.purchasing.suggest || row.purchaseItem?.isConfirmed || isSessionClosed}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </TableCell>
                            <TableCell>
                                <Input
                                    type="number"
                                    placeholder="0,00"
                                    value={row.price}
                                    onChange={e => handleLocalDataChange(row.product.id, 'price', e.target.value)}
                                    disabled={!permissions.purchasing.suggest || row.purchaseItem?.isConfirmed || isSessionClosed}
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
                                                    disabled={!canApprove || !row.purchaseItem || row.purchaseItem.isConfirmed || !row.pricePerUnit || isSessionClosed}
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
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

    
