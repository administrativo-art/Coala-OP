"use client"

import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, PlusCircle, Warehouse, Search, ClipboardCheck, Inbox } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLocations } from '@/hooks/use-locations';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { type LotEntry } from '@/types';
import { LotCard, type GroupedLot } from './lot-card';
import { LocationManagementModal } from './location-management-modal';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

type ExpiryControlProps = {
  onBack: () => void;
};

export function ExpiryControl({ onBack }: ExpiryControlProps) {
  const { permissions } = useAuth();
  const { locations, addLocation, deleteLocation } = useLocations();
  const { lots, loading, addLot, updateLot, deleteLot, moveLot } = useExpiryProducts();

  const [searchTerm, setSearchTerm] = useState('');
  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [lotToEdit, setLotToEdit] = useState<LotEntry | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [lotToMove, setLotToMove] = useState<LotEntry | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [lotToDelete, setLotToDelete] = useState<LotEntry | null>(null);

  const groupedLots = useMemo(() => {
    const filteredLots = lots.filter(lot => {
      const search = searchTerm.toLowerCase();
      const expiryDateFormatted = format(parseISO(lot.expiryDate), 'dd/MM/yyyy');
      const locationName = locations.find(l => l.id === lot.locationId)?.name.toLowerCase() || '';

      return (
        lot.productName.toLowerCase().includes(search) ||
        lot.lotNumber.toLowerCase().includes(search) ||
        (lot.barcode && lot.barcode.toLowerCase().includes(search)) ||
        expiryDateFormatted.includes(search) ||
        locationName.includes(search)
      );
    });

    const groups: { [key: string]: GroupedLot } = {};
    filteredLots.forEach(lot => {
      const key = `${lot.productName}-${lot.lotNumber}`;
      if (!groups[key]) {
        groups[key] = {
          productName: lot.productName,
          lotNumber: lot.lotNumber,
          barcode: lot.barcode,
          expiryDate: lot.expiryDate,
          totalQuantity: 0,
          locations: [],
        };
      }
      groups[key].totalQuantity += lot.quantity;
      groups[key].locations.push({
        id: lot.id,
        locationId: lot.locationId,
        quantity: lot.quantity,
      });
    });

    return Object.values(groups).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [lots, searchTerm, locations]);
  
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

  const canManageLocations = permissions.locations.add || permissions.locations.delete;

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
                  <PlusCircle className="mr-2 h-5 w-5" /> Adicionar Lote
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

    return (
      <div className="space-y-4">
        {groupedLots.map(group => (
          <LotCard
            key={`${group.productName}-${group.lotNumber}`}
            groupedLot={group}
            locations={locations}
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
          <Button variant="ghost" size="sm" className="absolute top-4 left-4" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Menu
          </Button>
          <CardTitle className="text-center pt-10 font-headline flex items-center justify-center gap-2">
            <ClipboardCheck /> Controle de Validade
          </CardTitle>
          <CardDescription className="text-center">Gerencie os lotes e as datas de vencimento do seu estoque.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por produto, lote, data, cód. de barras..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-4">
              <Button onClick={handleAddClick} className="flex-grow" disabled={!permissions.lots.add}>
                <PlusCircle className="mr-2" /> Adicionar Lote
              </Button>
              <Button variant="outline" onClick={() => setIsLocationsModalOpen(true)} className="flex-grow" disabled={!canManageLocations}>
                <Warehouse className="mr-2" /> Gerenciar Locais
              </Button>
            </div>
          </div>
          {renderContent()}
        </CardContent>
      </Card>

      <LocationManagementModal
        open={isLocationsModalOpen}
        onOpenChange={setIsLocationsModalOpen}
        locations={locations}
        addLocation={addLocation}
        deleteLocation={deleteLocation}
        permissions={permissions.locations}
      />
      
      <AddEditLotModal 
        open={isAddEditModalOpen}
        onOpenChange={setIsAddEditModalOpen}
        lotToEdit={lotToEdit}
        locations={locations}
        addLot={addLot}
        updateLot={updateLot}
      />

      {lotToMove && (
        <MoveStockModal 
            open={isMoveModalOpen}
            onOpenChange={setIsMoveModalOpen}
            lotToMove={lotToMove}
            locations={locations}
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
