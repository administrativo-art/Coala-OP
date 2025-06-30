
"use client"

import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusCircle, Search, ClipboardCheck, Inbox } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { type LotEntry } from '@/types';
import { LotCard, type GroupedLot } from './lot-card';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

export function ExpiryControl() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading, addLot, updateLot, deleteLot, moveLot } = useExpiryProducts();

  const [searchTerm, setSearchTerm] = useState('');
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [lotToEdit, setLotToEdit] = useState<LotEntry | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [lotToMove, setLotToMove] = useState<LotEntry | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [lotToDelete, setLotToDelete] = useState<LotEntry | null>(null);

  const visibleLots = useMemo(() => {
    if (!user || loading) return [];
    if (user.username === 'master' || (permissions.lots.edit && permissions.lots.delete)) return lots;
    return lots.filter(lot => lot.kioskId === user.kioskId);
  }, [lots, user, loading, permissions]);

  const groupedLots = useMemo(() => {
    const filteredLots = visibleLots.filter(lot => {
      const search = searchTerm.toLowerCase();
      const expiryDateFormatted = format(parseISO(lot.expiryDate), 'dd/MM/yyyy');
      const kioskName = kiosks.find(l => l.id === lot.kioskId)?.name.toLowerCase() || '';

      return (
        lot.productName.toLowerCase().includes(search) ||
        lot.lotNumber.toLowerCase().includes(search) ||
        (lot.barcode && lot.barcode.toLowerCase().includes(search)) ||
        expiryDateFormatted.includes(search) ||
        kioskName.includes(search)
      );
    });

    const groups: { [key: string]: GroupedLot } = {};
    filteredLots.forEach(lot => {
      const key = `${lot.productName}-${lot.lotNumber}-${lot.expiryDate}`;
      if (!groups[key]) {
        groups[key] = {
          productName: lot.productName,
          lotNumber: lot.lotNumber,
          barcode: lot.barcode,
          expiryDate: lot.expiryDate,
          totalQuantity: 0,
          kiosks: [],
        };
      }
      groups[key].totalQuantity += lot.quantity;
      groups[key].kiosks.push({
        id: lot.id,
        kioskId: lot.kioskId,
        quantity: lot.quantity,
      });
    });

    return Object.values(groups).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [visibleLots, searchTerm, kiosks]);
  
  const handleAddClick = () => {
    setLotToEdit(null);
    setIsAddEditModalOpen(true);
  };
  
  const handleEditClick = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    if(lot) {
      setLotToEdit(lot);
      setIsAddEditModalOpen(true);
    }
  };

  const handleMoveClick = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    if(lot) {
      setLotToMove(lot);
      setIsMoveModalOpen(true);
    }
  }

  const handleDeleteClick = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    if (lot) {
      setLotToDelete(lot);
      setIsDeleteConfirmOpen(true);
    }
  };

  const handleDeleteConfirm = () => {
    if (lotToDelete) {
      deleteLot(lotToDelete.id);
      setIsDeleteConfirmOpen(false);
      setLotToDelete(null);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }
    
    if (lots.length === 0) {
        return (
          <div className="text-center py-16 flex flex-col items-center">
              <Inbox className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold">Nenhum lote no estoque</h3>
              <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                  Comece adicionando um novo lote de produtos para monitorar a validade.
              </p>
              <Button size="lg" onClick={handleAddClick} disabled={!permissions.lots.add}>
                  <PlusCircle className="mr-2 h-5 w-5" /> Adicionar lote
              </Button>
          </div>
        );
    }

    if (groupedLots.length === 0 && searchTerm) {
        return (
            <div className="text-center py-16 text-muted-foreground">
                <p>Nenhum resultado encontrado para "{searchTerm}".</p>
            </div>
        );
    }
    
    if (groupedLots.length === 0) {
        return (
          <div className="text-center py-16 flex flex-col items-center">
              <Search className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold">Nenhum lote visível</h3>
              <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                  Não há lotes correspondentes à sua visão atual. Adicione um novo lote ou verifique os filtros.
              </p>
          </div>
        );
    }

    return (
      <div className="space-y-4">
        {groupedLots.map(group => (
          <LotCard
            key={`${group.productName}-${group.lotNumber}-${group.expiryDate}`}
            groupedLot={group}
            kiosks={kiosks}
            onEdit={handleEditClick}
            onMove={handleMoveClick}
            onDelete={handleDeleteClick}
            canEdit={permissions.lots.edit}
            canMove={permissions.lots.move}
            canDelete={permissions.lots.delete}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <Card className="w-full mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
            <ClipboardCheck /> Controle de validade
          </CardTitle>
          <CardDescription className="text-center">Gerencie os lotes e as datas de vencimento do seu estoque.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por produto, lote, data, quiosque..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button onClick={handleAddClick} className="flex-grow" disabled={!permissions.lots.add}>
              <PlusCircle className="mr-2" /> Adicionar lote
            </Button>
          </div>
          {renderContent()}
        </CardContent>
      </Card>
      
      <AddEditLotModal 
        open={isAddEditModalOpen}
        onOpenChange={setIsAddEditModalOpen}
        lotToEdit={lotToEdit}
        kiosks={kiosks}
        addLot={addLot}
        updateLot={updateLot}
      />

      {lotToMove && (
        <MoveStockModal 
            open={isMoveModalOpen}
            onOpenChange={setIsMoveModalOpen}
            lotToMove={lotToMove}
            kiosks={kiosks}
            onMoveConfirm={moveLot}
        />
      )}

      {lotToDelete && (
        <DeleteConfirmationDialog 
            open={isDeleteConfirmOpen}
            onOpenChange={() => setIsDeleteConfirmOpen(false)}
            onConfirm={handleDeleteConfirm}
            itemName={`a entrada de ${lotToDelete.quantity}x ${lotToDelete.productName} (Lote: ${lotToDelete.lotNumber})`}
        />
      )}
    </>
  );
}
