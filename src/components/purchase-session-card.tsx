
"use client";

import { useMemo, useState } from 'react';
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

interface PurchaseSessionCardProps {
    session: PurchaseSession;
}

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function BidCard({ item, product, baseProduct, isWinner, isLowest, onSelect }: { item: PurchaseItem, product: Product, baseProduct: BaseProduct, isWinner: boolean, isLowest: boolean, onSelect: () => void }) {
    const { entities } = useEntities();
    const entity = entities.find(e => e.id === item.entityId);

    const pricePerUnit = useMemo(() => {
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
    }, [item, product, baseProduct]);

    return (
        <div
            className={cn(
                "border rounded-lg p-3 cursor-pointer transition-all duration-300 relative",
                isWinner ? 'border-2 border-primary shadow-lg' : 'border-border hover:border-muted-foreground',
                isLowest && !isWinner && 'border-dashed border-green-500',
                !isWinner && 'ghost-card'
            )}
            onClick={onSelect}
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-semibold text-sm">{entity?.name || 'Fornecedor não informado'}</p>
                    <p className="text-xs text-muted-foreground">{getProductFullName(product)}</p>
                </div>
                <div className="text-right">
                    <p className="font-bold text-lg">{formatCurrency(item.price)}</p>
                    {pricePerUnit !== null && <p className="text-xs text-muted-foreground">{formatCurrency(pricePerUnit)} / {baseProduct.unit}</p>}
                </div>
            </div>
        </div>
    );
}

export function PurchaseSessionCard({ session }: PurchaseSessionCardProps) {
    const { user, users } = useAuth();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { items: allPurchaseItems, closeSession, deleteSession, loading: purchaseLoading } = usePurchase();
    const { products, getProductFullName, loading: productsLoading } = useProducts();
    const { toast } = useToast();
    
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [winners, setWinners] = useState<Record<string, string>>({}); // {[baseProductId]: purchaseItemId}

    const sessionItems = useMemo(() => allPurchaseItems.filter(i => i.sessionId === session.id), [session.id, allPurchaseItems]);
    const loading = purchaseLoading || productsLoading;

    const itemsByBaseProduct = useMemo(() => {
        const grouped: Record<string, { baseProduct: BaseProduct, items: { item: PurchaseItem, product: Product }[] }> = {};
        sessionItems.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            if (!product || !product.baseProductId) return;
            const baseProduct = baseProducts.find(bp => bp.id === product.baseProductId);
            if (!baseProduct) return;
            
            if (!grouped[baseProduct.id]) {
                grouped[baseProduct.id] = { baseProduct, items: [] };
            }
            grouped[baseProduct.id].items.push({ item, product });
        });
        return Object.values(grouped).sort((a,b) => a.baseProduct.name.localeCompare(b.baseProduct.name));
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
                    {loading ? <Skeleton className="h-48 w-full"/> : itemsByBaseProduct.map(({ baseProduct, items }) => {
                        const lowestPriceItem = items.length > 0 ? items.reduce((lowest, current) => {
                            return current.item.price < lowest.item.price ? current : lowest;
                        }) : null;
                        
                        const hasWinner = !!winners[baseProduct.id];

                        return (
                            <div key={baseProduct.id} className={cn('p-4 border rounded-lg space-y-3', hasWinner && 'winner-group')}>
                                <h3 className="font-semibold">{baseProduct.name}</h3>
                                {items.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {items.map(({ item, product }) => (
                                            <BidCard
                                                key={item.id}
                                                item={item}
                                                product={product}
                                                baseProduct={baseProduct}
                                                isWinner={winners[baseProduct.id] === item.id}
                                                isLowest={lowestPriceItem ? item.id === lowestPriceItem.item.id : false}
                                                onSelect={() => handleSelectWinner(baseProduct.id, item.id)}
                                            />
                                        ))}
                                    </div>
                                ) : <p className="text-xs text-muted-foreground">Nenhuma cotação para este item ainda.</p>}
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
