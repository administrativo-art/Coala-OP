
"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useAuth } from '@/hooks/use-auth';
import { type Product, type LotEntry } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Skeleton } from './ui/skeleton';
import { ArrowRight, PlusCircle, Trash2, Truck, ChevronsUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from './ui/dropdown-menu';
import { ScrollArea } from './ui/scroll-area';
import { useReposition } from '@/hooks/use-reposition';

interface TransferItem {
  productId: string;
  lots: {
    lotId: string;
    quantity: number;
    maxQuantity: number;
  }[];
}

export function StockTransfer() {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { createRepositionActivity, loading: repositionLoading } = useReposition();
  const { user, permissions } = useAuth();
  const { toast } = useToast();

  const [originKioskId, setOriginKioskId] = useState<string>('');
  const [destinationKioskId, setDestinationKioskId] = useState<string>('');
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [productsToAdd, setProductsToAdd] = useState<Set<string>>(new Set());

  const loading = kiosksLoading || productsLoading || lotsLoading;

  const handleAddProducts = () => {
    const itemsToAdd: TransferItem[] = [];
    productsToAdd.forEach(productId => {
        if (!transferItems.some(item => item.productId === productId)) {
             const productLots = lots.filter(lot => lot.kioskId === originKioskId && lot.productId === productId && lot.quantity > 0);
             if (productLots.length > 0) {
                 itemsToAdd.push({
                    productId: productId,
                    lots: productLots.map(lot => ({
                        lotId: lot.id,
                        quantity: 0,
                        maxQuantity: lot.quantity
                    })),
                });
             }
        }
    });

    if (itemsToAdd.length > 0) {
        setTransferItems(prev => [...prev, ...itemsToAdd]);
    }
    setProductsToAdd(new Set());
  };

  const handleLotQuantityChange = (productIndex: number, lotIndex: number, newQuantity: number) => {
    setTransferItems(prev => {
      const newItems = [...prev];
      const max = newItems[productIndex].lots[lotIndex].maxQuantity;
      newItems[productIndex].lots[lotIndex].quantity = Math.max(0, Math.min(max, newQuantity));
      return newItems;
    });
  };

  const handleRemoveProduct = (productIndex: number) => {
    setTransferItems(prev => prev.filter((_, index) => index !== productIndex));
  };
  
  const handleConfirmTransfer = async () => {
    if (!isTransferReady || !user) return;

    const originKiosk = kiosks.find(k => k.id === originKioskId)!;
    const destinationKiosk = kiosks.find(k => k.id === destinationKioskId)!;

    try {
        await createRepositionActivity({
            kioskOriginId: originKiosk.id,
            kioskOriginName: originKiosk.name,
            kioskDestinationId: destinationKiosk.id,
            kioskDestinationName: destinationKiosk.name,
            items: transferItems.map(item => {
                const product = products.find(p => p.id === item.productId)!;
                return {
                    baseProductId: product.baseProductId || '',
                    productName: product.baseName,
                    quantityNeeded: 0, // Manual transfer, not based on need
                    suggestedLots: item.lots
                        .filter(lot => lot.quantity > 0)
                        .map(lot => {
                            const lotDetails = lots.find(l => l.id === lot.lotId)!;
                            return {
                                lotId: lot.lotId,
                                productId: lotDetails.productId,
                                productName: getProductFullName(product),
                                lotNumber: lotDetails.lotNumber,
                                quantityToMove: lot.quantity,
                            };
                        }),
                };
            }).filter(item => item.suggestedLots.length > 0),
        });

        toast({
            title: 'Atividade de Reposição Criada',
            description: 'Acesse "Gestão de Estoque > Análise > Gerenciar Reposição" para despachar os itens.',
        });

        setTransferItems([]);
        setOriginKioskId('');
        setDestinationKioskId('');

    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Erro ao criar atividade',
            description: error.message || "Não foi possível criar a atividade de reposição.",
        });
    }
  };

  const availableProducts = useMemo(() => {
    if (!originKioskId) return [];
    const productIdsInOrigin = new Set(lots.filter(lot => lot.kioskId === originKioskId).map(lot => lot.productId));
    return products.filter(p => productIdsInOrigin.has(p.id) && !p.isArchived)
        .sort((a,b) => getProductFullName(a).localeCompare(getProductFullName(b)));
  }, [originKioskId, lots, products, getProductFullName]);
  
  const isTransferReady = originKioskId && destinationKioskId && transferItems.length > 0 && transferItems.some(item => item.lots.some(lot => lot.quantity > 0));

  if (!permissions.stock.inventoryControl.transfer) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Acesso negado</CardTitle>
                <CardDescription>Você não tem permissão para realizar transferências de estoque.</CardDescription>
            </CardHeader>
        </Card>
    );
  }

  if (loading) {
      return <Skeleton className="h-96 w-full" />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Truck /> Nova Transferência de Estoque</CardTitle>
        <CardDescription>
          Mova insumos de um quiosque de origem para um quiosque de destino.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center p-4 border rounded-lg">
            <Select value={originKioskId} onValueChange={setOriginKioskId}>
                <SelectTrigger><SelectValue placeholder="Selecione o quiosque de ORIGEM..." /></SelectTrigger>
                <SelectContent>
                    {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                </SelectContent>
            </Select>
            <ArrowRight className="h-6 w-6 text-muted-foreground" />
            <Select value={destinationKioskId} onValueChange={setDestinationKioskId} disabled={!originKioskId}>
                <SelectTrigger><SelectValue placeholder="Selecione o quiosque de DESTINO..." /></SelectTrigger>
                <SelectContent>
                    {kiosks.filter(k => k.id !== originKioskId).map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>

        {originKioskId && destinationKioskId && (
            <div className="space-y-4">
                <div className="flex items-end gap-2">
                    <div className="flex-grow">
                        <label className="text-sm font-medium">Adicionar insumo</label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-between font-normal">
                                    {productsToAdd.size > 0 ? `${productsToAdd.size} insumo(s) selecionado(s)` : "Selecione insumos..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                                <DropdownMenuLabel>Insumos disponíveis</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <ScrollArea className="h-48">
                                    {availableProducts.map(product => (
                                        <DropdownMenuCheckboxItem
                                            key={product.id}
                                            checked={productsToAdd.has(product.id)}
                                            onCheckedChange={(checked) => {
                                                const newSet = new Set(productsToAdd);
                                                if(checked) {
                                                    newSet.add(product.id);
                                                } else {
                                                    newSet.delete(product.id);
                                                }
                                                setProductsToAdd(newSet);
                                            }}
                                            onSelect={(e) => e.preventDefault()}
                                        >
                                            {getProductFullName(product)}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </ScrollArea>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <Button onClick={handleAddProducts} disabled={productsToAdd.size === 0}>
                        <PlusCircle className="mr-2" /> Adicionar
                    </Button>
                </div>
                
                <div className="space-y-4">
                    {transferItems.map((item, productIndex) => {
                        const product = products.find(p => p.id === item.productId)!;
                        return (
                            <div key={item.productId} className="p-4 border rounded-lg">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-semibold">{getProductFullName(product)}</h3>
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleRemoveProduct(productIndex)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Lote</TableHead>
                                            <TableHead>Validade</TableHead>
                                            <TableHead className="text-right">Estoque Origem</TableHead>
                                            <TableHead className="w-[120px]">Qtd. a Mover</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {item.lots.map((lotData, lotIndex) => {
                                            const lotDetails = lots.find(l => l.id === lotData.lotId)!;
                                            return (
                                                <TableRow key={lotData.lotId}>
                                                    <TableCell>{lotDetails.lotNumber}</TableCell>
                                                    <TableCell>{lotDetails.expiryDate ? format(new Date(lotDetails.expiryDate), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                                    <TableCell className="text-right">{lotData.maxQuantity}</TableCell>
                                                    <TableCell>
                                                        <Input
                                                            type="number"
                                                            value={lotData.quantity}
                                                            onChange={(e) => handleLotQuantityChange(productIndex, lotIndex, parseInt(e.target.value))}
                                                            max={lotData.maxQuantity}
                                                            min={0}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )
                    })}
                </div>
            </div>
        )}
      </CardContent>
      <CardFooter className="justify-end border-t pt-6">
        <Button onClick={handleConfirmTransfer} disabled={!isTransferReady || repositionLoading}>
            <Truck className="mr-2"/> 
            {repositionLoading ? "Criando atividade..." : "Criar atividade de transferência"}
        </Button>
      </CardFooter>
    </Card>
  );
}

    
