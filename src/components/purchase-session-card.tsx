"use client";

import { useMemo, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEntities } from "@/hooks/use-entities";
import { usePurchase } from "@/hooks/use-purchase";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { type PurchaseSession, type PurchaseItem, type BaseProduct, type Product } from "@/types";
import { Building, Calendar, ShoppingCart, User, Trash2, Download, PlusCircle, Check } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import { convertValue } from '@/lib/conversion';
import { AddPurchaseItem } from './add-purchase-item';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { arrayUnion } from 'firebase/firestore';

interface PurchaseSessionCardProps {
    session: PurchaseSession;
}

const formatCurrency = (value: number | null) => {
    if (value === null || !value || isNaN(value)) return '-';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function PriceEntryCard({ item, isWinner, isLowest, onSelect, onDelete }: { item: any, isWinner: boolean, isLowest: boolean, onSelect: () => void, onDelete: () => void }) {
    return (
        <div
            className={cn(
                "border rounded-lg p-3 cursor-pointer transition-all duration-300 relative group",
                isWinner ? 'border-2 border-primary shadow-lg' : 'border-border hover:border-muted-foreground',
                isLowest && !isWinner && 'border-dashed border-green-500'
            )}
            onClick={onSelect}
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-semibold text-sm">{item.entityName}</p>
                    <p className="text-xs text-muted-foreground">{item.productName}</p>
                </div>
                <div className="text-right">
                    <p className="font-bold text-lg">{formatCurrency(item.price)}</p>
                    {item.pricePerUnit !== null && (
                        <p className="text-xs text-muted-foreground">{formatCurrency(item.pricePerUnit)} / {item.baseUnit}</p>
                    )}
                </div>
            </div>
            <Button variant="ghost" size="icon" className="absolute top-0 right-0 h-7 w-7 text-destructive opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); onDelete();}}>
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}

export function PurchaseSessionCard({ session }: PurchaseSessionCardProps) {
    const { user, users } = useAuth();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { items: allPurchaseItems, closeSession, deleteSession, updateSession, loading: purchaseLoading, deletePurchaseItem } = usePurchase();
    const { products, getProductFullName, loading: productsLoading } = useProducts();
    const { toast } = useToast();
    
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [winners, setWinners] = useState<Record<string, string>>({}); // {[baseProductId]: purchaseItemId}

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
    
                return {
                    ...item,
                    productName: product ? getProductFullName(product) : 'Insumo não encontrado',
                    entityName: entity?.name || 'Fornecedor não encontrado',
                    pricePerUnit,
                    baseUnit: baseProduct?.unit || ''
                }
            });
    }, [session.id, allPurchaseItems, products, baseProducts, entities, getProductFullName, calculatePricePerUnit]);

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
        return grouped;
    }, [sessionItems, products, baseProducts]);

    const handleSelectWinner = (baseProductId: string, purchaseItemId: string) => {
        setWinners(prev => ({
            ...prev,
            [baseProductId]: purchaseItemId
        }));
    };
    
    const handleFinalize = async () => {
        await closeSession(session.id, Object.values(winners));
        toast({ title: "Sessão de compra finalizada!", description: `${Object.keys(winners).length} item(s) tiveram seus preços efetivados.` });
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

    if (session.status === 'closed') {
        // Render history card
        return (
             <Card className="bg-muted/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base text-muted-foreground"><ShoppingCart /> {session.description}</CardTitle>
                    <CardDescription className="text-xs mt-1">
                        Fechada por {sessionUser?.username} em {session.closedAt ? format(new Date(session.closedAt), 'dd/MM/yyyy') : ''}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm">Total da Compra: <span className="font-bold">{formatCurrency(session.valor_total_estimado || 0)}</span></p>
                    <p className="text-sm">{session.confirmedItemIds?.length || 0} item(s) efetivados.</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <>
            <Card className="overflow-hidden">
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle className="flex items-center gap-2"><ShoppingCart /> {session.description}</CardTitle>
                            <CardDescription className="text-xs mt-1">
                                Por {sessionUser?.username} em {format(new Date(session.createdAt), 'dd/MM/yyyy')}
                            </CardDescription>
                        </div>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setIsDeleteConfirmOpen(true)}><Trash2 className="h-4 w-4"/></Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                     <Select onValueChange={handleAddBaseProduct}>
                        <SelectTrigger>
                            <SelectValue placeholder="+ Adicionar Insumo para Cotação" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableProductsToAdd.map(bp => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}
                        </SelectContent>
                    </Select>

                    {loading ? <Skeleton className="h-48 w-full"/> : 
                     (session.baseProductIds || []).map(baseProductId => {
                        const group = itemsByBaseProductMap.get(baseProductId);
                        const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
                        if (!baseProduct) return null;

                        const items = group ? group.items : [];
                        const lowestPriceItem = items.length > 0 ? items.reduce((lowest, current) => {
                            const currentPrice = current.pricePerUnit ?? Infinity;
                            const lowestPrice = lowest.pricePerUnit ?? Infinity;
                            return currentPrice < lowestPrice ? current : lowest;
                        }) : null;
                        
                        return (
                            <div key={baseProduct.id} className={'p-4 border rounded-lg space-y-3'}>
                                <h3 className="font-semibold">{baseProduct.name}</h3>
                                {items.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {items.map((item) => (
                                            <PriceEntryCard 
                                                key={item.id} 
                                                item={item} 
                                                isWinner={winners[baseProduct.id] === item.id}
                                                isLowest={lowestPriceItem ? item.id === lowestPriceItem.id : false}
                                                onSelect={() => handleSelectWinner(baseProduct.id, item.id)}
                                                onDelete={() => deletePurchaseItem(item.id)}
                                            />
                                        ))}
                                    </div>
                                )}
                                <AddPurchaseItem baseProductId={baseProduct.id} sessionId={session.id} />
                            </div>
                        )
                    })}
                </CardContent>
                <CardFooter className="bg-muted/50 border-t p-4 flex justify-end">
                    <Button onClick={handleFinalize} disabled={Object.keys(winners).length === 0}>
                        <Check className="mr-2 h-4 w-4"/> Finalizar e Efetivar Compra
                    </Button>
                </CardFooter>
            </Card>

            <DeleteConfirmationDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen} onConfirm={handleDelete} itemName={`a sessão de cotação "${session.description}"`} />
        </>
    )
}
