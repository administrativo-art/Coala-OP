
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompetitors } from '@/hooks/use-competitors';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { 
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Building, History } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { CompetitorProductModal } from './competitor-product-modal';
import { type Competitor, type CompetitorProduct } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CompetitorPriceModal } from './competitor-price-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';

const competitorSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

type CompetitorFormValues = z.infer<typeof competitorSchema>;

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
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Produto do Concorrente</TableHead>
                                <TableHead>Mercadoria KS Correlacionada</TableHead>
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
                                    <TableCell colSpan={4} className="h-24 text-center">Nenhuma mercadoria cadastrada para este concorrente.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
             <CompetitorProductModal
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
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


export function CompetitorManagementModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { competitors, loading, addCompetitor, updateCompetitor, deleteCompetitor } = useCompetitors();
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [competitorToDelete, setCompetitorToDelete] = useState<Competitor | null>(null);

  const form = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorSchema),
    defaultValues: { name: '', address: '', city: '', state: '' },
  });

  useEffect(() => {
    if (editingCompetitor) {
      form.reset(editingCompetitor);
    } else {
      form.reset({ name: '', address: '', city: '', state: '' });
    }
  }, [editingCompetitor, form]);

  const onSubmit = async (values: CompetitorFormValues) => {
    if (editingCompetitor) {
      await updateCompetitor(editingCompetitor.id, { ...editingCompetitor, ...values });
    } else {
      await addCompetitor({ ...values, active: true });
    }
    setEditingCompetitor(null);
    form.reset({ name: '', address: '', city: '', state: '' });
  };
  
  const handleStartEdit = (competitor: Competitor) => {
    setEditingCompetitor(competitor);
  };

  const handleCancelEdit = () => {
    setEditingCompetitor(null);
    form.reset({ name: '', address: '', city: '', state: '' });
  };

  const handleDeleteConfirm = () => {
    if (competitorToDelete) {
        deleteCompetitor(competitorToDelete.id);
        setCompetitorToDelete(null);
    }
  };

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Gerenciamento de Concorrência</DialogTitle>
                <DialogDescription>Adicione, edite e gerencie seus concorrentes e os produtos deles.</DialogDescription>
            </DialogHeader>

            <div className="flex-1 flex flex-col overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-1">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Nome do Concorrente</FormLabel><FormControl><Input {...field} placeholder="Nome do concorrente" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                             <FormField
                                control={form.control}
                                name="address"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Endereço</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="Rua, Número, Bairro" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <FormField
                                control={form.control}
                                name="city"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Cidade</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="São Luís" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                             <FormField
                                control={form.control}
                                name="state"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Estado</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="MA" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                            <div className="flex gap-2">
                                {editingCompetitor ? (
                                    <>
                                        <Button type="submit" className="flex-1">Salvar</Button>
                                        <Button type="button" variant="outline" onClick={handleCancelEdit}>Cancelar</Button>
                                    </>
                                ) : (
                                    <Button type="submit" className="w-full"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar</Button>
                                )}
                            </div>
                        </div>
                    </form>
                </Form>
            
                <div className="flex-1 overflow-auto mt-6">
                    <ScrollArea className="h-full pr-4">
                        <Accordion type="single" collapsible className="w-full">
                            {competitors.map(c => (
                                <AccordionItem value={c.id} key={c.id}>
                                    <div className="flex items-center">
                                        <AccordionTrigger className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <Building className="h-5 w-5 text-muted-foreground" />
                                                <span className="font-medium">{c.name}</span>
                                            </div>
                                        </AccordionTrigger>
                                        <div className="flex gap-1 pr-2">
                                            <Button variant="ghost" size="icon" onClick={() => handleStartEdit(c)}><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setCompetitorToDelete(c)}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                    <AccordionContent className="p-4">
                                        <CompetitorProducts competitor={c} />
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </ScrollArea>
                </div>
            </div>
             <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <DeleteConfirmationDialog 
        open={!!competitorToDelete}
        onOpenChange={() => setCompetitorToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={`o concorrente "${competitorToDelete?.name}" e todos os seus produtos e preços`}
    />
    </>
  );
}
