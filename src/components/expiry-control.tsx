
"use client"

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { format, parseISO, differenceInDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Search, ClipboardCheck, Inbox, Camera, Filter, Settings, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { type LotEntry } from '@/types';
import { LotCard, type GroupedLot } from './lot-card';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ProductManagement } from './product-management';
import { useToast } from "@/hooks/use-toast";


const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

export function ExpiryControl() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading, addLot, updateLot, deleteLot, moveLot } = useExpiryProducts();
  const { products, loading: productsLoading } = useProducts();
  const { locations, loading: locationsLoading } = useLocations();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [selectedKiosks, setSelectedKiosks] = useState<string[]>([]);
  const [initialKioskSelectionMade, setInitialKioskSelectionMade] = useState(false);

  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [lotToEdit, setLotToEdit] = useState<LotEntry | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [lotToMove, setLotToMove] = useState<LotEntry | null>(null);
  const [lotToDelete, setLotToDelete] = useState<LotEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);
  const [isProductManagementOpen, setIsProductManagementOpen] = useState(false);


  const visibleLots = useMemo(() => {
    if (!user || loading) return [];
    if (user.username === 'master' || (permissions.lots.edit && permissions.lots.delete)) return lots;
    return lots.filter(lot => lot.kioskId === user.kioskId);
  }, [lots, user, loading, permissions]);

  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);
  
  useEffect(() => {
    if (!initialKioskSelectionMade && sortedKiosks.length > 0) {
        setSelectedKiosks(sortedKiosks.map(k => k.id));
        setInitialKioskSelectionMade(true);
    }
  }, [sortedKiosks, initialKioskSelectionMade]);


  const groupedLots = useMemo(() => {
    const kioskFilteredLots = (user?.username === 'master')
      ? visibleLots.filter(lot => selectedKiosks.includes(lot.kioskId))
      : visibleLots;

    const preFilteredLots = kioskFilteredLots.filter(lot => {
        if (statusFilters.length === 0) return true; // Show all if no filter is active

        const product = products.find(p => p.id === lot.productId);
        const urgentThreshold = product?.urgentThreshold ?? 7;
        const days = differenceInDays(parseISO(lot.expiryDate), new Date());

        const isExpiring = statusFilters.includes('expiring') && (days >= 0 && days <= urgentThreshold);
        const isExpired = statusFilters.includes('expired') && days < 0;

        return isExpiring || isExpired;
    });

    const filteredLots = preFilteredLots.filter(lot => {
      const search = searchTerm.toLowerCase();
      const product = products.find(p => p.id === lot.productId);
      const expiryDateFormatted = format(parseISO(lot.expiryDate), 'dd/MM/yyyy');
      const kioskName = kiosks.find(l => l.id === lot.kioskId)?.name.toLowerCase() || '';

      return (
        lot.productName.toLowerCase().includes(search) ||
        lot.lotNumber.toLowerCase().includes(search) ||
        (product?.barcode && product.barcode.toLowerCase().includes(search)) ||
        expiryDateFormatted.includes(search) ||
        kioskName.includes(search)
      );
    });

    const groups: { [key: string]: GroupedLot } = {};
    filteredLots.forEach(lot => {
      const key = `${lot.productId}-${lot.lotNumber}-${lot.expiryDate}`;
      const product = products.find(p => p.id === lot.productId);

      if (!groups[key]) {
        groups[key] = {
          productId: lot.productId,
          productName: lot.productName,
          lotNumber: lot.lotNumber,
          barcode: product?.barcode,
          expiryDate: lot.expiryDate,
          imageUrl: lot.imageUrl || product?.imageUrl,
          totalQuantity: 0,
          kiosks: [],
          alertThreshold: product?.alertThreshold,
          urgentThreshold: product?.urgentThreshold,
        };
      }
      groups[key].totalQuantity += lot.quantity;
      groups[key].kiosks.push({
        id: lot.id,
        kioskId: lot.kioskId,
        quantity: lot.quantity,
        locationId: lot.locationId || undefined,
      });
    });

    return Object.values(groups).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [visibleLots, searchTerm, kiosks, statusFilters, products, selectedKiosks, user]);
  
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
    }
  };

  const handleDeleteConfirm = async () => {
    if (!lotToDelete) return;
    setIsDeleting(true);
    try {
      await deleteLot(lotToDelete.id);
      toast({
        title: "Lote excluído",
        description: `O lote de ${lotToDelete.productName} foi removido.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: "Não foi possível remover o lote. Tente novamente.",
      });
      console.error("Deletion failed:", error);
    } finally {
      setIsDeleting(false);
      setLotToDelete(null);
    }
  };

  const handleSearchScanSuccess = (decodedText: string) => {
    setSearchTerm(decodedText);
    setIsSearchScannerOpen(false);
  };

  const handleStatusFilterChange = (filter: string, checked: boolean) => {
    setStatusFilters(current => {
        if (checked) {
            return [...current, filter];
        } else {
            return current.filter(f => f !== filter);
        }
    });
  };

  const handleKioskFilterChange = (kioskId: string, checked: boolean) => {
    setSelectedKiosks(current => {
        if (checked) {
            return [...current, kioskId];
        } else {
            return current.filter(id => id !== kioskId);
        }
    });
  };

  const canManageProducts = permissions.products.add || permissions.products.edit || permissions.products.delete;


  const renderContent = () => {
    if (loading || productsLoading || locationsLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }
    
    if (lots.length === 0) {
        return (
          <div className="text-center py-16 flex flex-col items-center">
              <Inbox className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold">Nenhum lote no estoque</h3>
              <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                  Comece adicionando um novo lote ao estoque para monitorar sua validade.
              </p>
              <Button size="lg" onClick={handleAddClick} disabled={!permissions.lots.add}>
                  <Plus className="mr-2 h-5 w-5" /> Adicionar lote
              </Button>
          </div>
        );
    }

    if (groupedLots.length === 0) {
        return (
            <div className="text-center py-16 text-muted-foreground">
                <p>Nenhum resultado encontrado com os filtros e busca atuais.</p>
            </div>
        );
    }
    
    return (
      <div className="space-y-4">
        {groupedLots.map(group => (
          <LotCard
            key={`${group.productId}-${group.lotNumber}-${group.expiryDate}`}
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
          <CardTitle className="font-headline flex items-center gap-2">
            <ClipboardCheck /> Controle de insumos em estoque
          </CardTitle>
          <CardDescription>Gerencie os insumos em estoque, seus vencimentos e transferências.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por produto, lote, código..."
                        className="pl-10 pr-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                        onClick={() => setIsSearchScannerOpen(true)}
                        aria-label="Escanear código de barras para busca"
                    >
                        <Camera className="h-4 w-4 text-muted-foreground" />
                    </Button>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={handleAddClick} className="w-full sm:w-auto" disabled={!permissions.lots.add}>
                        <Plus className="mr-2" /> Adicionar lote
                    </Button>
                    {canManageProducts && (
                        <Button variant="outline" onClick={() => setIsProductManagementOpen(true)} className="w-full sm:w-auto">
                            <Settings className="mr-2" /> Gerenciar Insumos
                        </Button>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Filter className="mr-2 h-4 w-4" />
                            Status {statusFilters.length > 0 && `(${statusFilters.length})`}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Filtrar por status</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                            checked={statusFilters.includes('expiring')}
                            onCheckedChange={(checked) => handleStatusFilterChange('expiring', !!checked)}
                            onSelect={(e) => e.preventDefault()}
                        >
                            Vencendo em breve
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={statusFilters.includes('expired')}
                            onCheckedChange={(checked) => handleStatusFilterChange('expired', !!checked)}
                            onSelect={(e) => e.preventDefault()}
                        >
                            Vencidos
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setStatusFilters([])} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                            Limpar filtros
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {user?.username === 'master' && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                                <Filter className="mr-2 h-4 w-4" />
                                Quiosques ({selectedKiosks.length})
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-64" align="start">
                            <DropdownMenuLabel>Filtrar por quiosque</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setSelectedKiosks(sortedKiosks.map(k => k.id))}>
                                Selecionar Todos
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setSelectedKiosks([])} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                Limpar Seleção
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <ScrollArea className="h-48">
                            {sortedKiosks.map(kiosk => (
                                <DropdownMenuCheckboxItem
                                    key={kiosk.id}
                                    checked={selectedKiosks.includes(kiosk.id)}
                                    onCheckedChange={(checked) => handleKioskFilterChange(kiosk.id, !!checked)}
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    {kiosk.name}
                                </DropdownMenuCheckboxItem>
                            ))}
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
            <div className="mt-6">
                {renderContent()}
            </div>
        </CardContent>
      </Card>
      
      <AddEditLotModal 
        open={isAddEditModalOpen}
        onOpenChange={setIsAddEditModalOpen}
        lotToEdit={lotToEdit}
        kiosks={kiosks}
        addLot={addLot}
        updateLot={updateLot}
        lots={lots}
      />

      <ProductManagement open={isProductManagementOpen} onOpenChange={setIsProductManagementOpen} />

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
            open={!!lotToDelete}
            isDeleting={isDeleting}
            onOpenChange={(open) => !open && setLotToDelete(null)}
            onConfirm={handleDeleteConfirm}
            itemName={`o lote de ${lotToDelete.productName} (Lote: ${lotToDelete.lotNumber}) com ${lotToDelete.quantity} unidades`}
        />
      )}

      {isSearchScannerOpen && (
        <BarcodeScannerModal
          open={isSearchScannerOpen}
          onOpenChange={setIsSearchScannerOpen}
          onScanSuccess={handleSearchScanSuccess}
        />
      )}
    </>
  );
}
