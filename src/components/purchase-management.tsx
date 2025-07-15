
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { usePurchase } from "@/hooks/use-purchase";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceComparisonTable } from "./price-comparison-table";
import { type BaseProduct } from "@/types";
import { Check, ChevronsUpDown, Loader2, History, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function PurchaseManagement() {
    const { user, permissions } = useAuth();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { products, loading: loadingProducts } = useProducts();
    const { sessions, items, startOrGetOpenSession, closeSession, loading: loadingPurchase } = usePurchase();

    const [open, setOpen] = useState(false);
    const [selectedBaseProduct, setSelectedBaseProduct] = useState<BaseProduct | null>(null);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    useEffect(() => {
        if (selectedBaseProduct && user) {
            const findSession = async () => {
                const sessionId = await startOrGetOpenSession(selectedBaseProduct.id, user.id);
                setCurrentSessionId(sessionId);
            };
            findSession();
        } else {
            setCurrentSessionId(null);
        }
    }, [selectedBaseProduct, user, startOrGetOpenSession]);
    
    const handleCloseSession = async () => {
        if (currentSessionId) {
            await closeSession(currentSessionId);
            setCurrentSessionId(null);
            setSelectedBaseProduct(null); // Reset selection
        }
    };
    
    const linkedProducts = products.filter(p => p.baseProductId === selectedBaseProduct?.id);
    const sessionItems = items.filter(i => i.sessionId === currentSessionId);
    const isLoading = loadingBaseProducts || loadingProducts || loadingPurchase;

    return (
        <div className="w-full max-w-7xl mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Gestão de Compras</CardTitle>
                    <CardDescription>Pesquise preços, compare custos por unidade e efetive suas compras.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">1. Selecione um insumo base</label>
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                className="w-full justify-between"
                                disabled={isLoading}
                                >
                                {isLoading ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : selectedBaseProduct ? (
                                    selectedBaseProduct.name
                                ) : (
                                    "Selecione um insumo base..."
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                    <CommandInput placeholder="Buscar insumo base..." />
                                    <CommandList>
                                        <CommandEmpty>Nenhum insumo encontrado.</CommandEmpty>
                                        <CommandGroup>
                                        {baseProducts.map((bp) => (
                                            <CommandItem
                                            key={bp.id}
                                            value={bp.name}
                                            onSelect={() => {
                                                setSelectedBaseProduct(bp);
                                                setOpen(false);
                                            }}
                                            >
                                            <Check className={cn("mr-2 h-4 w-4", selectedBaseProduct?.id === bp.id ? "opacity-100" : "opacity-0")} />
                                            {bp.name}
                                            </CommandItem>
                                        ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {isLoading && selectedBaseProduct && (
                        <Skeleton className="h-64 w-full" />
                    )}

                    {!isLoading && selectedBaseProduct && (
                       <div className="space-y-4 pt-4 border-t">
                         <h3 className="text-lg font-semibold">2. Pesquisa de Preços para: {selectedBaseProduct.name}</h3>
                         <PriceComparisonTable 
                           products={linkedProducts} 
                           items={sessionItems}
                           baseUnit={selectedBaseProduct.unit}
                           sessionId={currentSessionId}
                         />
                       </div>
                    )}

                     {!isLoading && !selectedBaseProduct && (
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed rounded-lg p-12">
                            <Search className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Nenhum insumo selecionado</p>
                            <p className="text-sm">Use a busca acima para iniciar uma pesquisa de preços.</p>
                        </div>
                     )}

                </CardContent>
                {selectedBaseProduct && (
                    <CardFooter className="flex justify-between border-t pt-6">
                        <Button variant="outline" disabled>
                            <History className="mr-2 h-4 w-4" /> Ver Histórico
                        </Button>
                        <Button onClick={handleCloseSession} disabled={!currentSessionId}>
                            Salvar e Concluir Pesquisa
                        </Button>
                    </CardFooter>
                )}
            </Card>
        </div>
    );
}
