
"use client"

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Search, ClipboardCheck, Inbox, Camera, Filter, Settings, Truck, Archive, History, Eraser, RefreshCw, ArrowRight, LineChart, Warehouse } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { useBaseProducts } from '@/hooks/use-base-products';
import { type LotEntry, type Product, type BaseProduct } from '@/types';
import { LotCard, type GroupedProduct } from './lot-card';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LotMovementHistoryModal } from './lot-movement-history-modal';
import { Badge } from '@/components/ui/badge';
import { convertValue } from '@/lib/conversion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QuickProjectionModal } from './quick-projection-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';


const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

export type GroupedByBrand = {
  brandName: string;
  products: GroupedProduct[];
};

export type GroupedByBaseProduct = {
  isBaseProduct: boolean;
  baseProductId: string | null;
  baseProduct: BaseProduct | null;
  name: string;
  brands: GroupedByBrand[];
  hasLeadTime: boolean;
};


function ExpiryControlContent() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading, addLot, updateLot, deleteLotsByIds, forceDeleteLotById, moveMultipleLots } = useExpiryProducts();
  const { products, loading: productsLoading, getProductFullName } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { locations, loading: locationsLoading } = useLocations();

  const searchParams = useSearchParams();
  const scannedLotId = searchParams.get('lotId');
  const searchQuery = searchParams.get('search');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [selectedKioskId, setSelectedKioskId] = useState<string>('');

  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [lotToEdit, setLotToEdit] = useState<LotEntry | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [lotToMove, setLotToMove] = useState<LotEntry | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [lotForHistory, setLotForHistory] = useState<LotEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);
  const [quickProjectionProduct, setQuickProjectionProduct] = useState<BaseProduct | null>(null);

  useEffect(() => {
    if (searchQuery) {
        setSearchTerm(searchQuery);
    }
  }, [searchQuery]);


  const visibleLots = useMemo(() => {
    if (!user || loading) return [];
    if (user.username === 'Tiago Brasil' || (permissions.lots.edit && permissions.lots.delete)) return lots;
    return lots.filter(lot => user.assignedKioskIds.includes(lot.kioskId));
  }, [lots, user, loading, permissions]);

  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);
  
  useEffect(() => {
    if (kiosks.length > 0 && !selectedKioskId) {
      if (user?.username === 'Tiago Brasil') {
        setSelectedKioskId('all');
      } else if (user?.assignedKioskIds && user.assignedKioskIds.length > 0) {
        setSelectedKioskId(user.assignedKioskIds[0]);
      }
    }
  }, [kiosks, selectedKioskId, user]);
  
  useEffect(() => {
    if (scannedLotId) {
      const element = document.getElementById(`lot-instance-${scannedLotId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('animate-pulse-once');
      }
    }
  }, [scannedLotId, loading]);


 const groupedData = useMemo(() => {
    const kioskFilteredLots = (selectedKioskId === 'all')
      ? visibleLots
      : visibleLots.filter(lot => lot.kioskId === selectedKioskId);

    const activeLots = kioskFilteredLots.filter(lot => lot.quantity > 0);
    
    const preFilteredLots = activeLots.filter(lot => {
        if (statusFilters.length === 0) return true;
        
        if (statusFilters.includes('no_expiry') && !lot.expiryDate) {
            return true;
        }

        if (!lot.expiryDate) return false;

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
      if (!product) return false;
      const expiryDateFormatted = lot.expiryDate ? format(parseISO(lot.expiryDate), 'dd/MM/yyyy') : 'indefinida';
      const kioskName = kiosks.find(l => l.id === lot.kioskId)?.name.toLowerCase() || '';

      const productBase = baseProducts.find(bp => bp.id === product.baseProductId);
      const baseProductMatch = productBase?.name.toLowerCase().includes(search);

      return (
        product.baseName.toLowerCase().includes(search) ||
        (product.brand && product.brand.toLowerCase().includes(search)) ||
        lot.lotNumber.toLowerCase().includes(search) ||
        (product?.barcode && product.barcode.toLowerCase().includes(search)) ||
        expiryDateFormatted.includes(search) ||
        kioskName.includes(search) ||
        baseProductMatch
      );
    });

    const groups: Map<string, GroupedByBaseProduct> = new Map();

    filteredLots.forEach(lot => {
      const product = products.find(p => p.id === lot.productId);
      if (!product) return;

      const baseProductId = product.baseProductId || `avulso-${product.id}`;
      const baseProduct = product.baseProductId ? baseProducts.find(bp => bp.id === product.baseProductId) : null;
      const groupName = baseProduct ? baseProduct.name : getProductFullName(product);
      const isBaseProdGroup = !!baseProduct;
      const brandName = product.brand || 'Sem Marca';
      
      const hasLeadTime = !!(baseProduct && Object.values(baseProduct.stockLevels).some(sl => sl.leadTime && sl.leadTime > 0));

      if (!groups.has(baseProductId)) {
        groups.set(baseProductId, {
          isBaseProduct: isBaseProdGroup,
          baseProductId: product.baseProductId || null,
          baseProduct,
          name: groupName,
          brands: [],
          hasLeadTime,
        });
      }

      const baseProductGroup = groups.get(baseProductId)!;
      let brandGroup = baseProductGroup.brands.find(b => b.brandName === brandName);

      if (!brandGroup) {
        brandGroup = { brandName, products: [] };
        baseProductGroup.brands.push(brandGroup);
      }
      
      let productGroup = brandGroup.products.find(p => p.product.id === product.id);
      
      if (!productGroup) {
        productGroup = { product: product, lots: [] };
        brandGroup.products.push(productGroup);
      }
      
      productGroup.lots.push(lot);
    });

    // Sort lots within each product group by expiry date
    groups.forEach(baseGroup => {
        baseGroup.brands.forEach(brandGroup => {
            brandGroup.products.forEach(productGroup => {
                productGroup.lots.sort((a,b) => {
                    if (!a.expiryDate && !b.expiryDate) return 0;
                    if (!a.expiryDate) return 1;
                    if (!b.expiryDate) return -1;
                    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
                });
            });
            brandGroup.products.sort((a,b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product)))
        });
        baseGroup.brands.sort((a,b) => a.brandName.localeCompare(b.name));
    });

    return Array.from(groups.values()).sort((a,b) => a.name.localeCompare(b.name));
  }, [visibleLots, searchTerm, kiosks, statusFilters, products, selectedKioskId, user, baseProducts, getProductFullName]);

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
    setDeleteTargetId(lotId);
  };
  
  const handleViewHistoryClick = (lot: LotEntry) => {
    setLotForHistory(lot);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;

    setIsDeleting(true);
    const success = await forceDeleteLotById(deleteTargetId);
    
    if (!success) {
      console.error(`Failed to delete lot with target ID: ${deleteTargetId}.`);
    }
    
    setDeleteTargetId(null);
    setIsDeleting(false);
    setForceDelete(false);
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

  const canManageProducts = permissions.products.add || permissions.products.edit || permissions.products.delete;


  const renderContent = () => {
    if (loading || productsLoading || locationsLoading || baseProductsLoading) {
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

    if (groupedData.length === 0) {
        return (
            <div className="text-center py-16 text-muted-foreground">
                <p>Nenhum resultado encontrado com os filtros e busca atuais.</p>
            </div>
        );
    }
    
    return (
      <div className="space-y-6">
         {groupedData.map(baseGroup => {
              let totalPackages = 0;
              const convertedTotals: { [unit: string]: number } = {};
              const baseProduct = baseProducts.find(bp => bp.id === baseGroup.baseProductId);

              baseGroup.brands.forEach(brand => {
                brand.products.forEach(prodGroup => {
                  prodGroup.lots.forEach(lot => {
                    totalPackages += lot.quantity;
                    const productConfig = prodGroup.product;
                    let lotTotalValue = 0;
                    let lotTotalUnit = '';

                    if (productConfig.secondaryUnit && typeof productConfig.secondaryUnitValue === 'number' && productConfig.secondaryUnitValue > 0) {
                        lotTotalValue = lot.quantity * productConfig.secondaryUnitValue;
                        lotTotalUnit = productConfig.secondaryUnit;
                    } else {
                        lotTotalValue = lot.quantity * productConfig.packageSize;
                        lotTotalUnit = productConfig.unit;
                    }

                    if (lotTotalValue > 0) {
                        if (!convertedTotals[lotTotalUnit]) {
                            convertedTotals[lotTotalUnit] = 0;
                        }
                        convertedTotals[lotTotalUnit] += lotTotalValue;
                    }
                  });
                });
              });

              const firstUnit = Object.keys(convertedTotals)[0];
              let totalConvertedDisplay = "Conversão Indisponível";

              if (firstUnit) {
                  const allInSameUnit = Object.keys(convertedTotals).length === 1;
                  if (allInSameUnit) {
                      totalConvertedDisplay = `${convertedTotals[firstUnit].toLocaleString('pt-BR')} ${firstUnit}`;
                  } else {
                       let sumInFirstUnit = 0;
                       let possible = true;
                       
                       for (const unit in convertedTotals) {
                           try {
                               sumInFirstUnit += convertValue(convertedTotals[unit], unit, firstUnit, baseProduct!.category);
                           } catch (e) {
                               possible = false;
                               break;
                           }
                       }
                       if (possible) {
                           totalConvertedDisplay = `${sumInFirstUnit.toLocaleString('pt-BR')} ${firstUnit}`;
                       }
                  }
              } else if (totalPackages > 0) {
                  totalConvertedDisplay = "0"; // Handle cases with packages but no convertible value
              } else {
                  totalConvertedDisplay = "0";
              }

             return (
                 <div key={baseGroup.baseProductId || baseGroup.name} className="space-y-4">
                     <div className="flex items-baseline justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-bold tracking-tight">{baseGroup.name}</h2>
                          {baseGroup.hasLeadTime && (
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-500 hover:text-blue-600" onClick={() => setQuickProjectionProduct(baseGroup.baseProduct)}>
                                  <LineChart className="h-5 w-5" />
                              </Button>
                          )}
                        </div>
                         {totalPackages > 0 && (
                            <div className="flex items-center gap-2 text-sm sm:text-base">
                              <span className="font-semibold text-primary">{totalConvertedDisplay}</span>
                              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0"/>
                              <Badge variant="secondary" className="px-3 py-1 text-sm">{totalPackages.toLocaleString('pt-BR')} pacotes/unidade</Badge>
                            </div>
                         )}
                     </div>
                     <div className="space-y-4">
                        {baseGroup.brands.flatMap(brandGroup => brandGroup.products).map(productGroup => (
                            <LotCard
                                key={productGroup.product.id}
                                productGroup={productGroup}
                                getProductFullName={getProductFullName}
                                kiosks={kiosks}
                                locations={locations}
                                onEdit={handleEditClick}
                                onMove={handleMoveClick}
                                onDelete={handleDeleteClick}
                                onViewHistory={handleViewHistoryClick}
                                canEdit={permissions.lots.edit}
                                canMove={permissions.lots.move}
                                canDelete={permissions.lots.delete}
                                canViewHistory={permissions.lots.viewMovementHistory}
                            />
                        ))}
                     </div>
                 </div>
             )
         })}
      </div>
    );
  };

  return (
    <>
      <div className="w-full mx-auto animate-in fade-in zoom-in-95 h-full flex flex-col">
        <div className='p-6 border-b'>
          <CardTitle className="font-headline flex items-center gap-2">
            Controle de estoque
          </CardTitle>
          <CardDescription>Gerencie os lotes, vencimentos, transferências e reposições do seu estoque.</CardDescription>
        </div>
        <div className="p-6 space-y-4">
            <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar por insumo base, produto, lote, código..."
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
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className='w-full sm:w-auto'>
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
                        >
                            Vencendo em breve
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={statusFilters.includes('expired')}
                            onCheckedChange={(checked) => handleStatusFilterChange('expired', !!checked)}
                        >
                            Vencidos
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={statusFilters.includes('no_expiry')}
                            onCheckedChange={(checked) => handleStatusFilterChange('no_expiry', !!checked)}
                        >
                            Validade indefinida
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setStatusFilters([])} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                            Limpar filtros
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                 <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
                    <SelectTrigger className="w-full sm:w-auto">
                        <Warehouse className="mr-2 h-4 w-4" />
                        <SelectValue placeholder="Selecione um quiosque..." />
                    </SelectTrigger>
                    <SelectContent>
                        {user?.username === 'Tiago Brasil' && <SelectItem value="all">Todos os quiosques</SelectItem>}
                        {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>
        <div className="p-6 pt-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
                {renderContent()}
            </ScrollArea>
        </div>
      </div>
      
      <AddEditLotModal 
        open={isAddEditModalOpen}
        onOpenChange={setIsAddEditModalOpen}
        lotToEdit={lotToEdit}
        kiosks={kiosks}
        addLot={addLot}
        updateLot={updateLot}
        lots={lots}
      />
      
      {lotForHistory && (
          <LotMovementHistoryModal lot={lotForHistory} onOpenChange={() => setLotForHistory(null)} />
      )}

      {lotToMove && (
        <MoveStockModal 
            open={isMoveModalOpen}
            onOpenChange={setIsMoveModalOpen}
            lotToMove={lotToMove}
            kiosks={kiosks}
            onMoveConfirm={moveMultipleLots}
        />
      )}

      {deleteTargetId && (
        <DeleteConfirmationDialog 
            open={!!deleteTargetId}
            isDeleting={isDeleting}
            onOpenChange={(open) => {
              if (!open) {
                setDeleteTargetId(null);
                setForceDelete(false);
              }
            }}
            onConfirm={handleDeleteConfirm}
            itemName={`o lote selecionado`}
        />
      )}

      {isSearchScannerOpen && (
        <BarcodeScannerModal
          open={isSearchScannerOpen}
          onOpenChange={setIsSearchScannerOpen}
          onScanSuccess={handleSearchScanSuccess}
        />
      )}
      
      {quickProjectionProduct && (
        <QuickProjectionModal 
            baseProduct={quickProjectionProduct}
            onOpenChange={() => setQuickProjectionProduct(null)}
        />
      )}
    </>
  );
}

export function ExpiryControl() {
    return (
        <Suspense fallback={<Skeleton className="h-[90vh] w-full" />}>
            <ExpiryControlContent />
        </Suspense>
    );
}
