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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PriceComparisonTable } from "./price-comparison-table";
import { type PurchaseItem, type PurchaseSession } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

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
    const { sessions, items: purchaseItems, loading: purchaseLoading, addSession, closeSession, deleteSession, confirmPurchase } = usePurchase();
    const { user } = useAuth();
    const { toast } = useToast();
    
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [sessionToDelete, setSessionToDelete] = useState<PurchaseSession | null>(null);

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

    const handleCreateSession = () => {
        if (!user) return;
        const baseProductIds = analysisResults.map(r => r.baseProduct.id);
        const description = `Compra Matriz - ${format(new Date(), 'dd/MM/yyyy HH:mm')}`;
        addSession({ description, baseProductIds, type: 'automatic' });
    };

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
    
    const handleDeleteSession = () => {
        if (sessionToDelete) {
            deleteSession(sessionToDelete.id);
            setSessionToDelete(null);
        }
    };
    
    const handleCloseSession = (sessionId: string) => {
        closeSession(sessionId);
    }
    
    const openAutomaticSession = useMemo(() => {
        return sessions.find(s => s.type === 'automatic' && s.status === 'open');
    }, [sessions]);

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        );
    }

    if (openAutomaticSession) {
        const sessionBaseProducts = baseProducts.filter(bp => openAutomaticSession.baseProductIds.includes(bp.id));
        const sessionItems = purchaseItems.filter(i => i.sessionId === openAutomaticSession.id);
        const isSessionClosed = openAutomaticSession.status === 'closed';

        return (
            <>
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>{openAutomaticSession.description}</CardTitle>
                                <CardDescription>Criado por {user?.username} em {format(new Date(openAutomaticSession.createdAt), 'dd/MM/yyyy HH:mm', {locale: ptBR})}</CardDescription>
                            </div>
                            <div>
                                <Button variant="destructive" size="sm" onClick={() => setSessionToDelete(openAutomaticSession)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> Cancelar Compra
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                         <Accordion type="multiple" className="w-full space-y-3">
                            {sessionBaseProducts.map(bp => (
                                <AccordionItem value={bp.id} key={bp.id} className="border-none">
                                    <Card className="bg-background/50">
                                        <AccordionTrigger className="p-4 text-lg font-semibold hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none">
                                            {bp.name}
                                        </AccordionTrigger>
                                        <AccordionContent className="p-4">
                                            <PriceComparisonTable
                                                baseProduct={bp}
                                                items={sessionItems.filter(i => {
                                                    const product = products.find(p => p.id === i.productId);
                                                    return product?.baseProductId === bp.id;
                                                })}
                                                sessionId={openAutomaticSession.id}
                                                isSessionClosed={isSessionClosed}
                                                selectedItems={selectedItems}
                                                onSelectionChange={handleSelectionChange}
                                            />
                                        </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </CardContent>
                    <CardFooter className="justify-between border-t pt-4">
                        <Button variant="outline" onClick={() => handleCloseSession(openAutomaticSession.id)}>Concluir e Salvar Pesquisa</Button>
                        <Button onClick={handleConfirmSelected} disabled={selectedItems.size === 0}>
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            Salvar e Efetivar Compra ({selectedItems.size})
                        </Button>
                    </CardFooter>
                </Card>
                <DeleteConfirmationDialog 
                    open={!!sessionToDelete}
                    onOpenChange={setSessionToDelete}
                    onConfirm={handleDeleteSession}
                    itemName={`a compra "${sessionToDelete?.description}"`}
                    description="Esta ação não pode ser desfeita. Todos os preços inseridos nesta compra serão perdidos."
                />
            </>
        )
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
                </div>
            )}
        </div>
    );
}
