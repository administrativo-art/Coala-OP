
"use client";

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { convertValue } from "@/lib/conversion";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Product, type PurchaseItem, type BaseProduct, type Entity } from "@/types";
import { Star, CheckCircle, Trash2, PlusCircle } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useProducts } from "@/hooks/use-products";
import { useEntities } from "@/hooks/use-entities";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "@/lib/utils";
import { Checkbox } from "./ui/checkbox";

interface PriceComparisonTableProps {
    baseProduct: BaseProduct;
    items: PurchaseItem[];
    sessionId: string;
    isSessionClosed: boolean;
    selectedItems: Set<string>;
    onSelectionChange: (itemId: string, isSelected: boolean) => void;
}

interface PriceRow {
    purchaseItem: PurchaseItem;
    product: Product | undefined;
    pricePerUnit: number | null;
    isBestPrice: boolean;
}

export function PriceComparisonTable({ baseProduct, items, sessionId, isSessionClosed, selectedItems, onSelectionChange }: PriceComparisonTableProps) {
    const { getProductFullName, products } = useProducts();
    const { entities } = useEntities();
    const { savePrice, deletePurchaseItem } = usePurchase();
    const { permissions } = useAuth();
    
    const [localPrices, setLocalPrices] = useState<Record<string, string>>({});
    const [debouncedPrices] = useDebounce(localPrices, 500);

    const linkedProducts = useMemo(() => {
        if (!baseProduct) return [];
        return products.filter(p => p.baseProductId === baseProduct.id);
    }, [products, baseProduct]);

    const suppliers = useMemo(() => entities.filter(e => e.type === 'pessoa_juridica'), [entities]);

    useEffect(() => {
        const initialPrices: Record<string, string> = {};
        items.forEach(item => {
            initialPrices[item.id] = item.price > 0 ? item.price.toString() : "";
        });
        setLocalPrices(initialPrices);
    }, [items]);

    useEffect(() => {
        if (isSessionClosed) return;
        Object.entries(debouncedPrices).forEach(([itemId, priceStr]) => {
            const price = parseFloat(priceStr);
            const item = items.find(i => i.id === itemId);
            if (item && !isNaN(price) && price > 0 && item.price !== price) {
                savePrice(item.id, { price });
            }
        });
    }, [debouncedPrices, isSessionClosed, items, savePrice]);

    const handleAddItem = () => {
        if (linkedProducts.length > 0) {
            savePrice(null, {
                sessionId,
                productId: linkedProducts[0].id,
                price: 0,
            });
        }
    };

    const tableData = useMemo((): PriceRow[] => {
        if (!baseProduct) return [];
        const rows: Omit<PriceRow, 'isBestPrice'>[] = items.map(item => {
            const product = products.find(p => p.id === item.productId);
            let pricePerUnit: number | null = null;
            if (product && item.price > 0) {
                try {
                    // This is the corrected logic
                    let quantityInBaseUnit = 0;
                    if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                        // Scenario: A package contains a number of smaller units (e.g., 1 pacote has 300 un)
                        // The base product unit MUST match the secondary unit's category.
                         const valueOfOnePackageInSecondary = convertValue(1, product.unit, product.secondaryUnit, product.category);
                         const finalQuantity = product.secondaryUnitValue * valueOfOnePackageInSecondary;

                         if(baseProduct.unit.toLowerCase() === product.secondaryUnit.toLowerCase()) {
                             quantityInBaseUnit = finalQuantity;
                         } else {
                            // This should not happen if categories match, but it's a fallback.
                            const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category;
                            quantityInBaseUnit = convertValue(finalQuantity, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                         }

                    } else {
                        // Scenario: Direct conversion (e.g., 1 kg to 1000 g)
                        quantityInBaseUnit = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                    }
                    
                    if (quantityInBaseUnit > 0) {
                        pricePerUnit = item.price / quantityInBaseUnit;
                    }
                } catch (e) {
                    console.error("Error converting value for price comparison:", e);
                }
            }
            return { purchaseItem: item, product, pricePerUnit };
        });

        const validPrices = rows
            .map(r => r.pricePerUnit)
            .filter((p): p is number => p !== null && p > 0);

        if (validPrices.length > 0) {
            const minPrice = Math.min(...validPrices);
            return rows.map(row => ({
                ...row,
                isBestPrice: row.pricePerUnit === minPrice
            }));
        }
        
        return rows.map(row => ({ ...row, isBestPrice: false }));

    }, [items, products, baseProduct, getProductFullName]);
    
    const canSuggest = permissions.purchasing.suggest && !isSessionClosed;
    const canApprove = permissions.purchasing.approve && !isSessionClosed;
    
    if (!baseProduct) {
        return <p className="text-destructive">Erro: Produto base não encontrado.</p>;
    }

    return (
        <div className="space-y-2">
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[30%]">Insumo Vinculado</TableHead>
                            <TableHead>Fornecedor</TableHead>
                            <TableHead>Preço (R$)</TableHead>
                            <TableHead>R$ / {baseProduct.unit}</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="w-[150px] text-right">Selecionar para comprar</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tableData.map(row => (
                            <TableRow key={row.purchaseItem.id}>
                                <TableCell>
                                    <Select
                                        value={row.purchaseItem.productId}
                                        onValueChange={(value) => savePrice(row.purchaseItem.id, { productId: value })}
                                        disabled={!canSuggest || row.purchaseItem.isConfirmed}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {linkedProducts.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell>
                                    <Select
                                        value={row.purchaseItem.entityId || ''}
                                        onValueChange={(value) => savePrice(row.purchaseItem.id, { entityId: value })}
                                        disabled={!canSuggest || row.purchaseItem.isConfirmed}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        <SelectContent>
                                            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell>
                                    <Input
                                        type="number"
                                        placeholder="0,00"
                                        value={localPrices[row.purchaseItem.id] || ''}
                                        onChange={e => setLocalPrices(prev => ({...prev, [row.purchaseItem.id]: e.target.value}))}
                                        disabled={!canSuggest || row.purchaseItem.isConfirmed}
                                    />
                                </TableCell>
                                <TableCell className={cn(row.isBestPrice && "text-amber-500 font-bold")}>
                                    {row.pricePerUnit !== null ? `${row.pricePerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 })}` : '-'}
                                </TableCell>
                                <TableCell className="text-center">
                                    {row.purchaseItem.isConfirmed ? (
                                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                                            <CheckCircle className="mr-1 h-3 w-3" /> Confirmado
                                        </Badge>
                                    ) : row.isBestPrice ? (
                                        <Badge className="bg-amber-100 text-amber-800">
                                            <Star className="mr-1 h-3 w-3" /> Melhor preço
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline">Pendente</Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Checkbox
                                            id={`select-${row.purchaseItem.id}`}
                                            checked={selectedItems.has(row.purchaseItem.id)}
                                            onCheckedChange={(checked) => onSelectionChange(row.purchaseItem.id, !!checked)}
                                            disabled={!canApprove || row.purchaseItem.isConfirmed || !row.pricePerUnit}
                                            aria-label="Selecionar para compra"
                                        />
                                         <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive h-8 w-8"
                                            onClick={() => deletePurchaseItem(row.purchaseItem.id)}
                                            disabled={!canSuggest || row.purchaseItem.isConfirmed}
                                         >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            {canSuggest && (
                 <Button variant="outline" size="sm" className="w-full" onClick={handleAddItem}>
                    <PlusCircle className="mr-2 h-4 w-4"/> Adicionar cotação
                </Button>
            )}
        </div>
    );
}
