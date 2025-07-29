
"use client";

import { useMemo, useState } from 'react';
import { useAuth } from "@/hooks/use-auth";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { usePurchase } from "@/hooks/use-purchase";
import { convertValue } from "@/lib/conversion";
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from '@/components/ui/button';
import { Inbox, ShoppingCart, PlusCircle, Trash2 } from "lucide-react";
import { type PurchaseSession } from '@/types';
import { PurchaseSessionCard } from './purchase-session-card';


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
    const { sessions, addSession } = usePurchase();
    const { user } = useAuth();
    
    const loading = loadingBaseProducts || loadingProducts || lotsLoading;

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

    const handleCreateSession = () => {
        if (!user) return;
        const baseProductIds = analysisResults.map(r => r.baseProduct.id);
        const description = `Compra Matriz - ${format(new Date(), 'dd/MM/yyyy HH:mm')}`;
        addSession({ description, baseProductIds, type: 'automatic' });
    };
    
    const openAutomaticSession = useMemo(() => {
        return sessions.find(s => s.type === 'automatic' && s.status === 'open');
    }, [sessions]);

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-24 w-full" />
            </div>
        );
    }

    if (openAutomaticSession) {
        return <PurchaseSessionCard session={openAutomaticSession} />;
    }

    return (
        <div className="space-y-4">
            <Button onClick={handleCreateSession} disabled={analysisResults.length === 0}>
                <PlusCircle className="mr-2" /> Criar nova compra na matriz
            </Button>
            {analysisResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                    <Inbox className="h-12 w-12 mb-4" />
                    <p className="font-semibold">Nenhuma necessidade de compra encontrada.</p>
                    <p className="text-sm">O estoque da Matriz está de acordo com as metas definidas.</p>
                </div>
            ) : (
                 <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                    <Inbox className="h-12 w-12 mb-4" />
                    <p className="font-semibold">Clique em "Criar nova compra" para iniciar.</p>
                    <p className="text-sm">{analysisResults.length} iten(s) abaixo do estoque mínimo foram encontrados.</p>
                </div>
            )}
        </div>
    );
}
