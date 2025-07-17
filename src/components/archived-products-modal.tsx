
"use client"

import { useProducts } from '@/hooks/use-products';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArchiveRestore, Inbox } from 'lucide-react';
import { type Product } from '@/types';

interface ArchivedProductsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchivedProductsModal({ open, onOpenChange }: ArchivedProductsModalProps) {
    const { products, getProductFullName, updateProduct } = useProducts();
    const archivedProducts = products.filter(p => p.isArchived);

    const handleUnarchive = (product: Product) => {
        updateProduct({ ...product, isArchived: false });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Insumos arquivados</DialogTitle>
                    <DialogDescription>
                        Gerencie os insumos que foram arquivados. Eles não aparecerão nas buscas a menos que sejam desarquivados.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col h-[50vh]">
                    <ScrollArea className="flex-grow">
                        <div className="space-y-2 pr-4">
                            {archivedProducts.length > 0 ? (
                                archivedProducts.map(product => (
                                    <div key={product.id} className="flex items-center justify-between rounded-md border p-2">
                                        <span className="font-medium">{getProductFullName(product)}</span>
                                        <Button variant="ghost" size="icon" onClick={() => handleUnarchive(product)}>
                                            <ArchiveRestore className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-12 text-muted-foreground flex flex-col items-center">
                                    <Inbox className="h-10 w-10 mb-2" />
                                    <p>Nenhum insumo arquivado.</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
                <DialogFooter className="pt-4 mt-auto border-t">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
