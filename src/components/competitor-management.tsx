
"use client";

import React, { useState, useMemo } from 'react';
import { useCompetitors } from '@/hooks/use-competitors';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Building, ChevronsUpDown, DollarSign, History } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { CompetitorProductModal } from './competitor-product-modal';
import { type Competitor, type CompetitorProduct } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CompetitorPriceModal } from './competitor-price-modal';

function CompetitorProducts({ competitor }: { competitor: Competitor }) {
    const { competitorProducts, competitorPrices, loading, deleteProduct } = useCompetitors();
    const { simulations, loading: loadingSimulations } = useProductSimulation();
    const [selectedProduct, setSelectedProduct] = useState<CompetitorProduct | null>(null);
    const [productForPriceHistory, setProductForPriceHistory] = useState<CompetitorProduct | null>(null);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);

    const products = useMemo(() => {
        return competitorProducts.filter(p => p.competitorId === competitor.id);
    }, [competitorProducts, competitor.id]);

    const latestPrices = useMemo(() => {
        const priceMap = new Map<string, { price: number; date: string }>();
        competitorPrices.forEach(price => {
            if (!priceMap.has(price.competitorProductId) || new Date(price.data_coleta) > new Date(priceMap.get(price.competitorProductId)!.date)) {
                priceMap.set(price.competitorProductId, { price: price.price, date: price.data_coleta });
            }
        });
        return priceMap;
    }, [competitorPrices]);

    const handleAddProduct = () => {
        setSelectedProduct(null);
        setIsProductModalOpen(true);
    };

    const handleEditProduct = (product: CompetitorProduct) => {
        setSelectedProduct(product);
        setIsProductModalOpen(true);
    };
    
    const handlePriceHistory = (product: CompetitorProduct) => {
        setProductForPriceHistory(product);
        setIsPriceModalOpen(true);
    };

    if (loading || loadingSimulations) {
        return <Skeleton className="h-24 w-full" />;
    }

    return (
        <>
            <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={handleAddProduct}><PlusCircle className="mr-2 h-4 w-4" /> Adicionar produto para {competitor.name}</Button>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Produto do Concorrente</TableHead>
                                <TableHead>Produto KS Correlacionado</TableHead>
                                <TableHead className="text-right">Último Preço (R$)</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {products.length > 0 ? products.map(p => {
                                const correlatedSim = simulations.find(s => s.id === p.ksProductId);
                                const latestPrice = latestPrices.get(p.id);
                                return (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-medium">{p.itemName} ({p.unit})</TableCell>
                                        <TableCell>{correlatedSim ? correlatedSim.name : <Badge variant="outline">Não correlacionado</Badge>}</TableCell>
                                        <TableCell className="text-right">
                                            {latestPrice ? `${latestPrice.price.toFixed(2)} (${format(parseISO(latestPrice.date), 'dd/MM/yy')})` : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => handlePriceHistory(p)}><History className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleEditProduct(p)}><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteProduct(p.id)}><Trash2 className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            }) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">Nenhum produto cadastrado para este concorrente.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
             <CompetitorProductModal
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                competitorId={competitor.id}
                productToEdit={selectedProduct}
            />
            {productForPriceHistory && (
                <CompetitorPriceModal
                    isOpen={isPriceModalOpen}
                    onClose={() => setIsPriceModalOpen(false)}
                    product={productForPriceHistory}
                />
            )}
        </>
    );
}

export function CompetitorManagement() {
  const { competitors, loading, addCompetitor, updateCompetitor, deleteCompetitor } = useCompetitors();
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);

  const handleAddCompetitor = async () => {
    if (newCompetitorName.trim()) {
      await addCompetitor(newCompetitorName.trim());
      setNewCompetitorName('');
    }
  };

  const handleUpdateCompetitor = async () => {
    if (editingCompetitor && newCompetitorName.trim()) {
      await updateCompetitor(editingCompetitor.id, { ...editingCompetitor, name: newCompetitorName.trim() });
      setNewCompetitorName('');
      setEditingCompetitor(null);
    }
  };
  
  const handleStartEdit = (e: React.MouseEvent, competitor: Competitor) => {
    e.stopPropagation();
    setEditingCompetitor(competitor);
    setNewCompetitorName(competitor.name);
  };

  const handleCancelEdit = () => {
    setEditingCompetitor(null);
    setNewCompetitorName('');
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gerenciamento de Concorrência</CardTitle>
        <CardDescription>Adicione concorrentes e gerencie seus produtos e preços para análise comparativa.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 p-4 border rounded-lg">
          <Input 
            placeholder={editingCompetitor ? `Editando "${editingCompetitor.name}"` : "Nome do novo concorrente"}
            value={newCompetitorName}
            onChange={(e) => setNewCompetitorName(e.target.value)}
          />
          {editingCompetitor ? (
            <>
              <Button onClick={handleUpdateCompetitor}>Salvar</Button>
              <Button variant="outline" onClick={handleCancelEdit}>Cancelar</Button>
            </>
          ) : (
            <Button onClick={handleAddCompetitor}>
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
            </Button>
          )}
        </div>
        <Accordion type="single" collapsible className="w-full">
            {competitors.map(c => (
                <AccordionItem value={c.id} key={c.id}>
                    <AccordionTrigger>
                        <div className='flex justify-between items-center w-full'>
                            <div className="flex items-center gap-2">
                                <Building className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium">{c.name}</span>
                            </div>
                             <div className="flex gap-1 pr-2" onClick={e => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" onClick={(e) => handleStartEdit(e, c)}><Edit className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteCompetitor(c.id)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4">
                        <CompetitorProducts competitor={c} />
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
