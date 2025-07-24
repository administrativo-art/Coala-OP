
"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePurchase } from "@/hooks/use-purchase";
import { useEntities } from "@/hooks/use-entities";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { convertValue } from "@/lib/conversion";

import { Skeleton } from "@/components/ui/skeleton";
import { Inbox } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { PriceComparisonTable } from "./price-comparison-table";

interface AnalysisResult {
  baseProduct: import('@/types').BaseProduct;
  currentStock: number;
  minimumStock: number;
  restockNeeded: number;
}

export function AutomaticPurchaseList() {
    const { users } = useAuth();
    const { entities, loading: loadingEntities } = useEntities();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { products, loading: loadingProducts } = useProducts();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { items: purchaseItems, loading: purchaseLoading } = usePurchase();

    const loading = loadingEntities || loadingBaseProducts || loadingProducts || lotsLoading || purchaseLoading;

    const analysisResults = useMemo((): AnalysisResult[] => {
        if (loading) return [];

        const productMap = new Map(products.map(p => [p.id, p]));
        const lotsInMatriz = lots.filter(lot => lot.kioskId === 'matriz');

        return baseProducts.map(baseProduct => {
            const minimumStock = baseProduct.stockLevels?.['matriz']?.min;
            let currentStock = 0;
            let hasConversionError = false;

            const lotsForBaseProduct = lotsInMatriz.filter(lot => {
                const product = productMap.get(lot.productId);
                return product?.baseProductId === baseProduct.id;
            });

            for (const lot of lotsForBaseProduct) {
                const product = productMap.get(lot.productId);
                if (!product) {
                    hasConversionError = true;
                    continue;
                }

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
                    hasConversionError = true;
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
                                    <span className="text-sm font-normal text-destructive">Comprar: {result.restockNeeded.toLocaleString()} {result.baseProduct.unit}</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4">
                                 <PriceComparisonTable
                                    baseProductId={result.baseProduct.id}
                                    items={purchaseItems}
                                    sessionId="automatic"
                                    isSessionClosed={false}
                                />
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    );
}
