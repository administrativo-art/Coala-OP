
"use client";

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type LotEntry, type Product } from '@/types';
import { useProducts } from '@/hooks/use-products';
import Image from 'next/image';
import { PlusCircle, Box, PackagePlus, MinusCircle, Eye } from 'lucide-react';
import { AddEditLotModal } from './add-edit-lot-modal';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';

interface ScannedItemActionsModalProps {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
}

export function ScannedItemActionsModal({ product, onOpenChange }: ScannedItemActionsModalProps) {
  const router = useRouter();
  const { getProductFullName } = useProducts();
  const { addLot, updateLot, lots: allLots } = useExpiryProducts();
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  
  const [isAddLotModalOpen, setIsAddLotModalOpen] = useState(false);

  const canAddLot = permissions.stock.inventoryControl.addLot;
  const canConsumeLot = permissions.stock.inventoryControl.writeDown; 

  const handleViewInStock = () => {
    if (!product) return;
    onOpenChange(false);
    router.push(`/dashboard/inventory-control?search=${product.barcode}`);
  };

  const handleAddLot = () => {
    if (!product) return;
    setIsAddLotModalOpen(true);
  };

  const handleConsume = () => {
    // This action is more complex as it requires selecting a specific lot.
    // For now, it will just navigate to the inventory control page filtered for the product.
    handleViewInStock();
  };
  
  const handleAddLotModalClose = (open: boolean) => {
    setIsAddLotModalOpen(open);
    if (!open) {
      onOpenChange(false); // Close the main modal as well
    }
  }

  return (
    <>
      <Dialog open={!!product} onOpenChange={onOpenChange}>
        <DialogContent>
          {product && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4">
                  {product.imageUrl && (
                    <Image
                      src={product.imageUrl}
                      alt={getProductFullName(product)}
                      width={80}
                      height={80}
                      className="rounded-lg object-cover"
                    />
                  )}
                  <div className="space-y-1">
                    <DialogTitle>{getProductFullName(product)}</DialogTitle>
                    <DialogDescription>
                      Selecione uma ação para este insumo.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <Button variant="outline" className="h-20 flex-col gap-1" onClick={handleViewInStock}>
                  <Eye className="h-6 w-6" />
                  <span>Ver no estoque</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col gap-1" onClick={handleAddLot} disabled={!canAddLot}>
                  <PackagePlus className="h-6 w-6" />
                  <span>Adicionar lote</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col gap-1" onClick={handleConsume} disabled={!canConsumeLot}>
                  <MinusCircle className="h-6 w-6" />
                  <span>Registrar baixa/consumo</span>
                </Button>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>Fechar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      {/* We pass a dummy lot to edit to open the modal in 'add' mode, but pre-filled with the scanned product */}
      <AddEditLotModal 
        open={isAddLotModalOpen}
        onOpenChange={handleAddLotModalClose}
        lotToEdit={{ productId: product?.id } as LotEntry} // Hack to pre-select product
        kiosks={kiosks}
        addLot={addLot}
        updateLot={updateLot}
        lots={allLots}
      />
    </>
  );
}
