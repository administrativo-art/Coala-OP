
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
import { ArrowRight, PlusCircle, Trash2, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

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
  const { user } = useAuth();
  const { toast } = useToast();

  const [originKioskId, setOriginKioskId] = useState<string>('');
  const [destinationKioskId, setDestinationKioskId] = useState<string>('');
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [productToAdd, setProductToAdd] = useState<string>('');

  const loading = kiosksLoading || productsLoading || lotsLoading;

  const handleAddProduct = () => {
    if (!productToAdd || transferItems.some(item => item.productId === productToAdd)) {
      return;
    }
    const productLots = lots.filter(lot => lot.kioskId === originKioskId && lot.productId === productToAdd && lot.quantity > 0);
    if (productLots.length > 0) {
      setTransferItems(prev => [
        ...prev,
        {
          productId: productToAdd,
          lots: productLots.map(lot => ({
            lotId: lot.id,
            quantity: 0,
            maxQuantity: lot.quantity
          })),
        },
      ]);
    } else {
        toast({
            variant: "destructive",
            title: "Produto sem estoque",
            description: "Este produto não possui lotes com estoque no quiosque de origem.",
        })
    }
    setProductToAdd('');
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
  
  const handleConfirmTransfer = () => {
    // Placeholder for actual transfer logic
    console.log({
        originKioskId,
        destinationKioskId,
        transferItems,
    });
    toast({
        title: "Transferência confirmada (simulação)",
        description: "Os dados foram registrados no console. A lógica de back-end será implementada em seguida.",
    });
  };

  const availableProducts = useMemo(() => {
    if (!originKioskId) return [];
    const productIdsInOrigin = new Set(lots.filter(lot => lot.kioskId === originKioskId).map(lot => lot.productId));
    return products.filter(p => productIdsInOrigin.has(p.id));
  }, [originKioskId, lots, products]);
  
  const isTransferReady = originKioskId && destinationKioskId && transferItems.length > 0 && transferItems.some(item => item.lots.some(lot => lot.quantity > 0));

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
                        <label className="text-sm font-medium">Adicionar Insumo</label>
                        <Select value={productToAdd} onValueChange={setProductToAdd}>
                            <SelectTrigger><SelectValue placeholder="Selecione um insumo para transferir..." /></SelectTrigger>
                            <SelectContent>
                                {availableProducts.map(p => (
                                    <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button onClick={handleAddProduct} disabled={!productToAdd}>
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
                                            <TableHead className="w-[150px]">Qtd. a Mover</TableHead>
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
        <Button onClick={handleConfirmTransfer} disabled={!isTransferReady}>
            <Truck className="mr-2"/> Concluir Transferência
        </Button>
      </CardFooter>
    </Card>
  );
}
