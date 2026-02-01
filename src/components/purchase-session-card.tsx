
"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEntities } from "@/hooks/use-entities";
import { usePurchase } from "@/hooks/use-purchase";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { type PurchaseSession, type PurchaseItem, type BaseProduct, type Product } from "@/types";
import { ShoppingCart, Trash2, Check, Award, PlusCircle, Inbox } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import { convertValue } from '@/lib/conversion';
import { AddPurchaseItem } from './add-purchase-item';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { arrayUnion } from 'firebase/firestore';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from './ui/input';


interface PurchaseSessionCardProps {
    session: PurchaseSession;
}

const formatCurrency = (value: number | null) => {
    if (value === null || !value || isNaN(value)) return '-';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function PriceEntryCard({ item, isWinner, isLowest, onSelect, onDelete, canConfirm, onPriceChange }: { item: any, isWinner: boolean, isLowest: boolean, onSelect: () => void, onDelete: () => void, canConfirm: boolean, onPriceChange: (newPrice: number) => void }) {
    const [isEditing, setIsEditing] = useState(false);

    const handlePriceUpdate = (newPriceStr: string) => {
        const newPrice = parseFloat(newPriceStr);
        if (!isNaN(newPrice) && newPrice !== item.price) {
            onPriceChange(newPrice);
        }
        setIsEditing(false);
    };

    return (
        <div
            className={cn(
                "border rounded-lg p-4 transition-all duration-300 ease-in-out relative group shrink-0 w-64",
                isWinner ? 'border-2 border-primary shadow-lg scale-[1.02]' : 'border-border hover:border-muted-foreground',
                isLowest && !isWinner && 'border-dashed border-green-500',
                !canConfirm && 'cursor-default'
            )}
            onClick={canConfirm && !isEditing ? onSelect : undefined}
        >
            {isLowest && (
                <Badge variant="secondary" className="absolute -top-2 -left-2 bg-green-500 text-white hover:bg-green-600 shadow-lg z-10">
                    <Award className="h-3 w-3 mr-1" />
                    Melhor Preço
                </Badge>
            )}
            {isWinner && (
                <div className="absolute -top-2 -right-2 h-6 w-6 bg-primary rounded-full flex items-center justify-center shadow-lg">
                    <Check className="h-4 w-4 text-white" />
                </div>
            )}

            <div className="flex justify-between items-start mb-2">
                <div>
                    <p className="font-semibold text-sm">{item.entityName}</p>
                    <p className="text-xs text-muted-foreground">{item.productName}</p>
                </div>
            </div>
            
            <div className="text-right flex flex-col items-end">
                <div className="flex items-baseline justify-end gap-2 w-full">
                    {item.priceVariation !== null && item.lastPricePerUnit !== null && (
                         <span className={cn(
                             "font-semibold flex items-center text-xs",
                             item.priceVariation > 0 ? "text-red-500" : "text-green-600"
                         )}>
                             {item.priceVariation > 0 ? '▲' : '▼'} {Math.abs(item.priceVariation).toFixed(0)}%
                             <span className="text-muted-foreground ml-1 font-normal">(de {formatCurrency(item.lastPricePerUnit)})</span>
                         </span>
                    )}
                    {isEditing ? (
                        <Input
                            type="number"
                            defaultValue={item.price}
                            autoFocus
                            onBlur={(e) => handlePriceUpdate(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handlePriceUpdate((e.target as HTMLInputElement).value);
                                if (e.key === 'Escape') setIsEditing(false);
                            }}
                            className="h-8 text-lg font-bold text-right p-1"
                        />
                    ) : (
                         <p className="font-bold text-lg cursor-pointer" onClick={() => canConfirm && setIsEditing(true)}>
                            {formatCurrency(item.price)}
                        </p>
                    )}
                </div>
                {item.pricePerUnit !== null && (
                    <p className="text-xs text-muted-foreground">{formatCurrency(item.pricePerUnit)} / {item.baseUnit}</p>
                )}
            </div>

            {canConfirm && <Button variant="ghost" size="icon" className="absolute top-0 right-0 h-7 w-7 text-destructive opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); onDelete();}}>
                <Trash2 className="h-4 w-4" />
            </Button>}
        </div>
    );
}

export function PurchaseSessionCard({ session }: PurchaseSessionCardProps) {
    const { user, users } = useAuth();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { items: allPurchaseItems, closeSession, deleteSession, updateSession, loading: purchaseLoading, deletePurchaseItem, priceHistory, savePrice } = usePurchase();
    const { products, getProductFullName, loading: productsLoading } = useProducts();
    const { toast } = useToast();
    
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [winners, setWinners] = useState<Record<string, string>>({}); // {[baseProductId]: purchaseItemId}

    useEffect(() => {
        if (session.status === 'closed' && session.confirmedItemIds) {
            const initialWinners: Record<string, string> = {};
            session.confirmedItemIds.forEach(itemId => {
                const item = allPurchaseItems.find(i => i.id === itemId);
                const product = products.find(p => p.id === item?.productId);
                if (item && product?.baseProductId) {
                    initialWinners[product.baseProductId] = itemId;
                }
            });
            setWinners(initialWinners);
        }
    }, [session, allPurchaseItems, products]);


     const calculatePricePerUnit = useCallback((item: PurchaseItem, product: Product, baseProduct: BaseProduct): number | null => {
        if (!product || !baseProduct || !item.price || item.price <= 0) return null;
        try {
            if (baseProduct.category === 'Unidade') {
                if (product.packageSize > 0) {
                    return item.price / product.packageSize;
                }
            }
            if (product.category === baseProduct.category) {
                const quantityInBaseUnit = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                if (quantityInBaseUnit > 0) {
                    return item.price / quantityInBaseUnit;
                }
            }
            return null;
        } catch { return null; }
    }, []);

    const sessionItems = useMemo(() => {
        return allPurchaseItems
            .filter(i => i.sessionId === session.id)
            .map(item => {
                const product = products.find(p => p.id === item.productId);
                const baseProduct = baseProducts.find(bp => bp.id === product?.baseProductId);
                const entity = entities.find(e => e.id === item.entityId);
                
                const pricePerUnit = (product && baseProduct) ? calculatePricePerUnit(item, product, baseProduct) : null;
    
                const lastPriceEntry = priceHistory.find(
                    h => h.baseProductId === baseProduct?.id && h.entityId === item.entityId
                );

                const lastPricePerUnit = lastPriceEntry?.pricePerUnit ?? null;
                
                let priceVariation: number | null = null;
                if (pricePerUnit !== null && lastPricePerUnit !== null && lastPricePerUnit > 0) {
                    priceVariation = ((pricePerUnit / lastPricePerUnit) - 1) * 100;
                }
    
                return {
                    ...item,
                    productName: product ? getProductFullName(product) : 'Insumo não encontrado',
                    entityName: entity?.name || 'Fornecedor não encontrado',
                    pricePerUnit,
                    baseUnit: baseProduct?.unit || '',
                    lastPricePerUnit,
                    priceVariation
                }
            });
    }, [session.id, allPurchaseItems, products, baseProducts, entities, getProductFullName, calculatePricePerUnit, priceHistory]);

    const loading = purchaseLoading || productsLoading;
    
    const itemsByBaseProductMap = useMemo(() => {
        const grouped = new Map<string, { baseProduct: BaseProduct, items: any[] }>();
        
        sessionItems.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            if (!product || !product.baseProductId) return;
            const baseProduct = baseProducts.find(bp => bp.id === product.baseProductId);
            if (!baseProduct) return;
            
            if (!grouped.has(baseProduct.id)) {
                grouped.set(baseProduct.id, { baseProduct, items: [] });
            }
            grouped.get(baseProduct.id)!.items.push(item);
        });

        (session.baseProductIds || []).forEach(baseId => {
            if (!grouped.has(baseId)) {
                const baseProduct = baseProducts.find(bp => bp.id === baseId);
                if (baseProduct) {
                    grouped.set(baseId, { baseProduct, items: [] });
                }
            }
        });

        return grouped;
    }, [sessionItems, session.baseProductIds, products, baseProducts]);

    const handleSelectWinner = (baseProductId: string, purchaseItemId: string) => {
        if (session.status === 'closed') return;
        setWinners(prev => {
            if (prev[baseProductId] === purchaseItemId) {
                const newWinners = { ...prev };
                delete newWinners[baseProductId];
                return newWinners;
            }
            return {
                ...prev,
                [baseProductId]: purchaseItemId
            };
        });
    };
    
    const handleFinalize = async () => {
        await closeSession(session.id, Object.values(winners));
    };

    const handleDelete = async () => {
        await deleteSession(session.id);
        setIsDeleteConfirmOpen(false);
    }
    
    const sessionUser = useMemo(() => users.find(u => u.id === session.userId), [session.userId, users]);
    
    const availableProductsToAdd = useMemo(() => {
        const currentIds = new Set(session.baseProductIds || []);
        return baseProducts.filter(bp => !currentIds.has(bp.id));
    }, [baseProducts, session.baseProductIds]);
    
    const handleAddBaseProduct = async (baseProductId: string) => {
        if (!baseProductId) return;
        await updateSession(session.id, {
            baseProductIds: arrayUnion(baseProductId)
        });
    };
    
    const handleRemoveBaseProduct = async (baseProductIdToRemove: string) => {
        if (!session.baseProductIds) return;
        const newBaseProductIds = session.baseProductIds.filter(id => id !== baseProductIdToRemove);
        await updateSession(session.id, { baseProductIds: newBaseProductIds });
    };

    return (
        <>
            <Card className="overflow-hidden flex flex-col h-full">
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle className="flex items-center gap-2"><ShoppingCart /> {session.description}</CardTitle>
                            <CardDescription className="text-xs mt-1">
                                Por {sessionUser?.username} em {format(new Date(session.createdAt), 'dd/MM/yyyy')}
                            </CardDescription>
                        </div>
                        {session.status === 'open' && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setIsDeleteConfirmOpen(true)}><Trash2 className="h-4 w-4"/></Button>}
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-1 overflow-y-auto">
                    {session.status === 'open' && (
                        <Select onValueChange={handleAddBaseProduct}>
                            <SelectTrigger>
                                <SelectValue placeholder="+ Adicionar Insumo para Cotação" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableProductsToAdd.map(bp => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}

                    {loading ? <Skeleton className="h-48 w-full"/> : 
                     Array.from(itemsByBaseProductMap.values()).length === 0 && session.status === 'open' ? (
                        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                           <Inbox className="mx-auto h-12 w-12 mb-4" />
                           <p className="font-semibold">Nenhum insumo nesta cotação</p>
                           <p className="text-sm">Use o botão "Adicionar Insumo" para começar.</p>
                       </div>
                     ) :
                     Array.from(itemsByBaseProductMap.values()).map(({ baseProduct, items }) => {
                        const lowestPriceItem = items.length > 0 ? items.reduce((lowest, current) => {
                            const currentPrice = current.pricePerUnit ?? Infinity;
                            const lowestPrice = lowest.pricePerUnit ?? Infinity;
                            return currentPrice < lowestPrice ? current : lowest;
                        }) : null;
                        
                        const winnerSelected = !!winners[baseProduct.id];

                        return (
                            <div key={baseProduct.id} className={cn("p-6 border rounded-lg space-y-3", winnerSelected && "winner-group")}>
                                <div className="flex justify-between items-center">
                                    <h3 className="font-semibold">{baseProduct.name}</h3>
                                    {session.status === 'open' && <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleRemoveBaseProduct(baseProduct.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>}
                                </div>
                                
                                <div className="flex overflow-x-auto gap-4 p-1 -m-1 pt-4">
                                    {items.map((item) => {
                                        const isWinner = winners[baseProduct.id] === item.id;
                                        
                                        return (
                                            <div key={item.id} className={cn(winnerSelected && !isWinner && "ghost-card", "transition-all duration-200")}>
                                                <PriceEntryCard 
                                                    item={item} 
                                                    isWinner={isWinner}
                                                    isLowest={lowestPriceItem ? item.id === lowestPriceItem.id : false}
                                                    onSelect={() => handleSelectWinner(baseProduct.id, item.id)}
                                                    onDelete={() => deletePurchaseItem(item.id)}
                                                    canConfirm={session.status === 'open'}
                                                    onPriceChange={(newPrice) => savePrice(item.id, { price: newPrice })}
                                                />
                                            </div>
                                        )
                                    })}
                                    {session.status === 'open' && (
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <div
                                                    className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-3 transition-all duration-300 ease-in-out group cursor-pointer shrink-0 w-64 flex items-center justify-center hover:border-primary hover:text-primary"
                                                >
                                                    <div className="text-center text-muted-foreground group-hover:text-primary">
                                                        <PlusCircle className="mx-auto h-8 w-8" />
                                                        <p className="text-sm font-semibold mt-2">Adicionar Preço</p>
                                                    </div>
                                                </div>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[500px]">
                                                    <AddPurchaseItem baseProductId={baseProduct.id} sessionId={session.id} />
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                </div>
                                {items.length === 0 && session.status !== 'open' && (
                                    <p className="text-sm text-center text-muted-foreground">Nenhuma cotação adicionada para este item.</p>
                                )}
                            </div>
                        )
                    })}
                </CardContent>
                {session.status === 'open' && (
                    <CardFooter className="bg-background/80 backdrop-blur-sm border-t p-4 flex justify-end items-center sticky bottom-0 z-10">
                        <Button onClick={handleFinalize} disabled={Object.keys(winners).length === 0 || loading} size="lg" className="bg-gradient-to-r from-primary to-accent text-white shadow-lg hover:shadow-xl transition-shadow">
                            <Check className="mr-2 h-4 w-4"/> Salvar cotação
                        </Button>
                    </CardFooter>
                )}
            </Card>

            <DeleteConfirmationDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen} onConfirm={handleDelete} itemName={`a sessão de cotação "${session.description}"`} />
        </>
    )
}
