"use client";

import React, { useState, useMemo, useEffect } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Search, Eraser } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { CompetitorProductModal } from './competitor-product-modal';
import { type CompetitorProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';

export function CompetitorProductManagementModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { competitors, competitorProducts, loading, deleteProduct } = useCompetitors();
  const { simulations } = useProductSimulation();

  const [selectedProduct, setSelectedProduct] = useState<CompetitorProduct | null>(null);
  const [productToDelete, setProductToDelete] = useState<CompetitorProduct | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredProducts = useMemo(() => {
    return competitorProducts.filter(p => 
        p.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (simulations.find(s => s.id === p.ksProductId)?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (competitors.find(c => c.id === p.competitorId)?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [competitorProducts, searchTerm, simulations, competitors]);

  const handleAddNew = () => {
    setSelectedProduct(null);
    setIsProductModalOpen(true);
  };
  
  const handleEdit = (product: CompetitorProduct) => {
    setSelectedProduct(product);
    setIsProductModalOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (productToDelete) {
        deleteProduct(productToDelete.id);
        setProductToDelete(null);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Gerenciar Mercadorias dos Concorrentes</DialogTitle>
            <DialogDescription>
              Visualize, adicione e edite as mercadorias vendidas por seus concorrentes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por mercadoria, concorrente ou vínculo..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full"
                    />
                </div>
                 <Button onClick={handleAddNew}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Adicionar nova mercadoria
                </Button>
            </div>
            
            <div className="flex-1 overflow-auto rounded-md border">
                <ScrollArea className="h-full">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Mercadoria do Concorrente</TableHead>
                                <TableHead>Concorrente</TableHead>
                                <TableHead>Vínculo KS</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={4}><Skeleton className="h-24 w-full" /></TableCell></TableRow>
                            ) : filteredProducts.length > 0 ? filteredProducts.map(p => {
                                const competitor = competitors.find(c => c.id === p.competitorId);
                                const correlatedSim = simulations.find(s => s.id === p.ksProductId);
                                return (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-medium">{p.itemName} ({p.unit})</TableCell>
                                        <TableCell>{competitor ? competitor.name : <Badge variant="destructive">N/A</Badge>}</TableCell>
                                        <TableCell>{correlatedSim ? correlatedSim.name : <Badge variant="outline">Não vinculado</Badge>}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(p)}><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setProductToDelete(p)}><Trash2 className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            }) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">Nenhuma mercadoria encontrada.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </div>
          </div>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompetitorProductModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        productToEdit={selectedProduct}
      />
      
      <DeleteConfirmationDialog 
        open={!!productToDelete}
        onOpenChange={() => setProductToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={`a mercadoria "${productToDelete?.itemName}"`}
        description="Esta ação também excluirá permanentemente todo o histórico de preços associado."
      />
    </>
  );
}
