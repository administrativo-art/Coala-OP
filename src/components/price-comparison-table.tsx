
"use client";

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { convertValue } from "@/lib/conversion";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { type Product, type PurchaseItem } from "@/types";
import { Star, CheckCircle, HelpCircle } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useProducts } from "@/hooks/use-products";

interface PriceComparisonTableProps {
    products: Product[];
    items: PurchaseItem[];
    baseUnit: string;
    sessionId: string | null;
}

interface PriceRow {
    product: Product;
    price: string;
    pricePerUnit: number | null;
    isBestPrice: boolean;
    purchaseItem?: PurchaseItem;
}

export function PriceComparisonTable({ products, items, baseUnit, sessionId }: PriceComparisonTableProps) {
    const { getProductFullName } = useProducts();
    const { savePrice, confirmPurchase } = usePurchase();
    const { permissions } = useAuth();
    
    const [prices, setPrices] = useState<Record<string, string>>({});
    const [debouncedPrices] = useDebounce(prices, 500);

    useEffect(() => {
        const initialPrices: Record<string, string> = {};
        products.forEach(p => {
            const item = items.find(i => i.productId === p.id);
            if (item) {
                initialPrices[p.id] = item.price.toString();
            } else {
                initialPrices[p.id] = "";
            }
        });
        setPrices(initialPrices);
    }, [products, items]);

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

    const handleConfirm = (productId: string) => {
        const item = items.find(i => i.productId === productId);
        if (item) {
            confirmPurchase(item.id, ""); // Add comment logic if needed
        }
    };

    const tableData = useMemo((): PriceRow[] => {
        const rows = products.map(p => {
            const priceStr = prices[p.id] || "0";
            const price = parseFloat(priceStr);
            let pricePerUnit: number | null = null;
            if (!isNaN(price) && price > 0) {
                const convertedQty = convertValue(p.packageSize, p.unit, baseUnit, p.category);
                if (convertedQty > 0) {
                    pricePerUnit = price / convertedQty;
                }
            }
            return {
                product: p,
                price: priceStr,
                pricePerUnit,
                isBestPrice: false,
                purchaseItem: items.find(i => i.productId === p.id)
            };
        });

        const validPrices = rows
            .map(r => r.pricePerUnit)
            .filter((p): p is number => p !== null && p > 0);

        if (validPrices.length > 0) {
            const minPrice = Math.min(...validPrices);
            rows.forEach(row => {
                if (row.pricePerUnit === minPrice) {
                    row.isBestPrice = true;
                }
            });
        }

        return rows.sort((a,b) => (a.pricePerUnit ?? Infinity) - (b.pricePerUnit ?? Infinity));

    }, [products, prices, baseUnit, items]);

    if (products.length === 0) {
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
                        <TableHead className="w-[150px]">Preço (R$)</TableHead>
                        <TableHead className="w-[150px]">R$ / {baseUnit}</TableHead>
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
                                <Input
                                    type="number"
                                    placeholder="0,00"
                                    value={row.price}
                                    onChange={e => handlePriceChange(row.product.id, e.target.value)}
                                />
                            </TableCell>
                            <TableCell>
                                {row.pricePerUnit !== null ? `R$ ${row.pricePerUnit.toFixed(3)}` : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                                {row.purchaseItem?.isConfirmed ? (
                                     <Badge variant="secondary" className="bg-green-100 text-green-800">
                                        <CheckCircle className="mr-1 h-3 w-3" />
                                        Confirmado
                                    </Badge>
                                ) : row.isBestPrice && row.pricePerUnit !== null ? (
                                    <Badge className="bg-amber-100 text-amber-800">
                                        <Star className="mr-1 h-3 w-3" />
                                        Melhor Preço
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
                                                    onClick={() => handleConfirm(row.product.id)}
                                                    disabled={!canApprove || !row.purchaseItem || row.purchaseItem.isConfirmed}
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
