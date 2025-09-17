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
import { PlusCircle, Edit, Trash2, Search, Eraser, Building, Link2 } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { CompetitorProductModal } from './competitor-product-modal';
import { type CompetitorProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';

export function CompetitorProductManagementModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { competitors, competitorProducts, loading, deleteProduct } = useCompetitors();
  const { simulations } = useProductSimulation();

  const [selectedProduct, setSelectedProduct] = useState<CompetitorProduct | null>(null);
  const [productToDelete, setProductToDelete] = useState<CompetitorProduct | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [competitorFilter, setCompetitorFilter] = useState('all');
  const [linkedProductFilter, setLinkedProductFilter] = useState('all');

  const filteredProducts = useMemo(() => {
    return competitorProducts.filter(p => {
        const searchMatch = searchTerm === '' ||
            p.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (simulations.find(s => s.id === p.ksProductId)?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (competitors.find(c => c.id === p.competitorId)?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
            
        const competitorMatch = competitorFilter === 'all' || p.competitorId === competitorFilter;
        const linkedProductMatch = linkedProductFilter === 'all' || p.ksProductId === linkedProductFilter;

        return searchMatch && competitorMatch && linkedProductMatch;
    });
  }, [competitorProducts, searchTerm, simulations, competitors, competitorFilter, linkedProductFilter]);

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
  
  const clearFilters = () => {
      setSearchTerm('');
      setCompetitorFilter('all');
      setLinkedProductFilter('all');
  }

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
            <div className="space-y-3 mb-4">
                <div className="flex items-center gap-2">
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
                <div className="flex flex-col sm:flex-row gap-2">
                     <Select value={competitorFilter} onValueChange={setCompetitorFilter}>
                        <SelectTrigger className="w-full">
                           <div className="flex items-center gap-2 text-muted-foreground">
                             <Building className="h-4 w-4" />
                             <SelectValue placeholder="Filtrar por concorrente..." />
                           </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os concorrentes</SelectItem>
                            {competitors.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <Select value={linkedProductFilter} onValueChange={setLinkedProductFilter}>
                        <SelectTrigger className="w-full">
                           <div className="flex items-center gap-2 text-muted-foreground">
                            <Link2 className="h-4 w-4" />
                            <SelectValue placeholder="Filtrar por vínculo..." />
                           </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as mercadorias vinculadas</SelectItem>
                            {simulations.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Button variant="ghost" onClick={clearFilters}>
                        <Eraser className="mr-2 h-4 w-4"/>
                        Limpar
                    </Button>
                </div>
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
