
"use client";

import { useMemo, useState } from 'react';
import { useAuth } from "@/hooks/use-auth";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { usePurchase } from "@/hooks/use-purchase";
import { convertValue } from "@/lib/conversion";
import { useToast } from '@/hooks/use-toast';

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from '@/components/ui/button';
import { Inbox, ShoppingCart } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardFooter } from "@/components/ui/card";
import { PriceComparisonTable } from "./price-comparison-table";
import { type PurchaseItem } from '@/types';

interface AnalysisResult {
  baseProduct: import('@/types').BaseProduct;
  currentStock: number;
  minimumStock: number;
  restockNeeded: number;
}

export function AutomaticPurchaseList() {
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { products, loading: loadingProducts } = useProducts();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { items: purchaseItems, loading: purchaseLoading, confirmPurchase } = usePurchase();
    const { toast } = useToast();
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    const loading = loadingBaseProducts || loadingProducts || lotsLoading || purchaseLoading;

    const analysisResults = useMemo((): AnalysisResult[] => {
        if (loading) return [];

        const productMap = new Map(products.map(p => [p.id, p]));
        const lotsInMatriz = lots.filter(lot => lot.kioskId === 'matriz');

        return baseProducts.map(baseProduct => {
            const minimumStock = baseProduct.stockLevels?.['matriz']?.min;
            let currentStock = 0;

            const lotsForBaseProduct = lotsInMatriz.filter(lot => {
                const product = productMap.get(lot.productId);
                return product?.baseProductId === baseProduct.id;
            });

            for (const lot of lotsForBaseProduct) {
                const product = productMap.get(lot.productId);
                if (!product) continue;

                try {
                    let valueInBaseUnit = 0;
                    if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                        const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category === 'Embalagem' ? 'Unidade' : product.category;
                        const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                        valueInBaseUnit = lot.quantity * valueOfOnePackageInBase;
                    } else if (product.category === baseProduct.category) {
                        const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                        valueInBaseUnit = lot.quantity * valueOfOnePackageInBase;
                    } else {
                        throw new Error("Conversion not possible without secondary unit.");
                    }
                    currentStock += valueInBaseUnit;
                } catch (error) {
                    console.error("Conversion failed for product:", product, error);
                }
            }
            
            const restockNeeded = Math.max(0, (minimumStock || 0) - currentStock);
            
            return {
                baseProduct,
                currentStock,
                minimumStock: minimumStock || 0,
                restockNeeded,
            };
        }).filter(result => result.restockNeeded > 0);
    }, [loading, baseProducts, products, lots]);

    const handleSelectionChange = (itemId: string, isSelected: boolean) => {
        setSelectedItems(prev => {
            const newSet = new Set(prev);
            if (isSelected) {
                newSet.add(itemId);
            } else {
                newSet.delete(itemId);
            }
            return newSet;
        });
    };
    
    const findPricePerUnit = (item: PurchaseItem): number | null => {
        const product = products.find(p => p.id === item.productId);
        const baseProduct = baseProducts.find(bp => bp.id === product?.baseProductId);

        if (product && baseProduct && item.price > 0) {
            try {
                const convertedQty = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                if (convertedQty > 0) {
                    return item.price / convertedQty;
                }
            } catch (e) { console.error("Conversion error", e); }
        }
        return null;
    }

    const handleConfirmSelected = async () => {
        if (selectedItems.size === 0) {
            toast({
                variant: "destructive",
                title: "Nenhum item selecionado",
                description: "Por favor, marque os itens que deseja efetivar."
            });
            return;
        }

        let confirmedCount = 0;
        for (const itemId of selectedItems) {
            const item = purchaseItems.find(i => i.id === itemId);
            if (!item) continue;
            
            const product = products.find(p => p.id === item.productId);
            if (!product?.baseProductId) continue;
            
            const pricePerUnit = findPricePerUnit(item);
            if (pricePerUnit !== null) {
                await confirmPurchase(itemId, product.baseProductId, pricePerUnit);
                confirmedCount++;
            }
        }
        
        toast({
            title: "Compra efetivada!",
            description: `${confirmedCount} item(s) tiveram seus preços atualizados.`
        });
        setSelectedItems(new Set());
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        );
    }
    
    if (analysisResults.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                <Inbox className="h-12 w-12 mb-4" />
                <p className="font-semibold">Nenhuma necessidade de compra encontrada.</p>
                <p className="text-sm">O estoque da Matriz está de acordo com as metas definidas.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <Accordion type="multiple" className="w-full space-y-3">
                {analysisResults.map(result => (
                    <AccordionItem value={result.baseProduct.id} key={result.baseProduct.id} className="border-none">
                        <Card className="bg-card/40">
                             <AccordionTrigger className="p-4 text-lg font-semibold hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none">
                                <div className="flex justify-between w-full items-center">
                                    <span>{result.baseProduct.name}</span>
                                    <span className="text-sm font-normal text-destructive">Comprar: {result.restockNeeded.toLocaleString(undefined, { maximumFractionDigits: 2 })} {result.baseProduct.unit}</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4">
                                 <PriceComparisonTable
                                    baseProduct={result.baseProduct}
                                    items={purchaseItems.filter(i => {
                                        const product = products.find(p => p.id === i.productId);
                                        return i.sessionId === 'automatic' && product?.baseProductId === result.baseProduct.id;
                                    })}
                                    sessionId="automatic"
                                    isSessionClosed={false}
                                    selectedItems={selectedItems}
                                    onSelectionChange={handleSelectionChange}
                                />
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
            {analysisResults.length > 0 && (
                <CardFooter className="justify-end border-t pt-4">
                    <Button onClick={handleConfirmSelected} disabled={selectedItems.size === 0}>
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Salvar e Efetivar Compra ({selectedItems.size})
                    </Button>
                </CardFooter>
            )}
        </div>
    );
}
