

"use client"

import { useState, useMemo, useEffect } from 'react';
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
import { Plus, Search, ClipboardCheck, Inbox, Camera, Filter, Settings, Truck, Archive, History, Eraser } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { useBaseProducts } from '@/hooks/use-base-products';
import { type LotEntry, type Product } from '@/types';
import { LotCard, type GroupedProduct } from './lot-card';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LotMovementHistoryModal } from './lot-movement-history-modal';
import { ZeroedLotsAuditModal } from './zeroed-lots-audit-modal';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Badge } from './ui/badge';
import { convertValue } from '@/lib/conversion';


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
  name: string;
  brands: GroupedByBrand[];
};


export function ExpiryControl() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading, addLot, updateLot, deleteLotsByIds, forceDeleteLotById, moveMultipleLots } = useExpiryProducts();
  const { products, loading: productsLoading, getProductFullName } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { locations, loading: locationsLoading } = useLocations();

  const searchParams = useSearchParams();
  const scannedLotId = searchParams.get('lotId');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [selectedKiosks, setSelectedKiosks] = useState<string[]>([]);
  const [initialKioskSelectionMade, setInitialKioskSelectionMade] = useState(false);

  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [lotToEdit, setLotToEdit] = useState<LotEntry | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [lotToMove, setLotToMove] = useState<LotEntry | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [lotForHistory, setLotForHistory] = useState<LotEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);


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
    if (!initialKioskSelectionMade && sortedKiosks.length > 0) {
        setSelectedKiosks(sortedKiosks.map(k => k.id));
        setInitialKioskSelectionMade(true);
    }
  }, [sortedKiosks, initialKioskSelectionMade]);
  
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
    const kioskFilteredLots = (user?.username === 'Tiago Brasil')
      ? visibleLots.filter(lot => selectedKiosks.includes(lot.kioskId))
      : visibleLots;

    const activeLots = kioskFilteredLots.filter(lot => lot.quantity > 0);
    
    const preFilteredLots = activeLots.filter(lot => {
        if (statusFilters.length === 0) return true;
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
      const expiryDateFormatted = format(parseISO(lot.expiryDate), 'dd/MM/yyyy');
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

      if (!groups.has(baseProductId)) {
        groups.set(baseProductId, {
          isBaseProduct: isBaseProdGroup,
          baseProductId: product.baseProductId || null,
          name: groupName,
          brands: [],
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
                productGroup.lots.sort((a,b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
            });
            brandGroup.products.sort((a,b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product)))
        });
        baseGroup.brands.sort((a,b) => a.brandName.localeCompare(b.name));
    });

    return Array.from(groups.values()).sort((a,b) => a.name.localeCompare(b.name));
  }, [visibleLots, searchTerm, kiosks, statusFilters, products, selectedKiosks, user, baseProducts, getProductFullName]);

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
      <div className="space-y-4">
         <Accordion type="multiple" className="w-full space-y-4">
            {groupedData.map(baseGroup => {
                const baseProductConfig = baseProducts.find(bp => bp.id === baseGroup.baseProductId);
                
                let totalGroupQuantity = 0;
                let displayUnit = baseGroup.isBaseProduct ? 'pacotes' : '';

                if (baseGroup.isBaseProduct && baseProductConfig) {
                    displayUnit = baseProductConfig.unit;
                    
                    totalGroupQuantity = baseGroup.brands.reduce((brandTotal, brand) => {
                        return brandTotal + brand.products.reduce((prodTotal, prodGroup) => {
                            const productConfig = prodGroup.product;
                            const valueInBaseUnits = prodGroup.lots.reduce((lotTotal, lot) => {
                                let singleItemValue = 0;
                                // Scenario 1: Direct conversion (e.g., Massa to Massa)
                                if (productConfig.category === baseProductConfig.category) {
                                    singleItemValue = convertValue(productConfig.packageSize, productConfig.unit, baseProductConfig.unit, productConfig.category);
                                } 
                                // Scenario 2: Secondary Unit conversion (e.g., Unidade to Massa, Embalagem to Unidade)
                                else if (productConfig.secondaryUnit && productConfig.secondaryUnitValue) {
                                     // Determine the category for the secondary conversion (e.g., if product is 'Unidade', its secondary value is likely 'Massa')
                                    const secondaryUnitCategory = productConfig.category === 'Unidade' ? 'Massa' : productConfig.category === 'Embalagem' ? 'Unidade' : productConfig.category;
                                    singleItemValue = convertValue(productConfig.secondaryUnitValue, productConfig.secondaryUnit, baseProductConfig.unit, secondaryUnitCategory);
                                }
                                return lotTotal + (lot.quantity * singleItemValue);
                            }, 0);
                            return prodTotal + valueInBaseUnits;
                        }, 0);
                    }, 0);

                } else {
                     totalGroupQuantity = baseGroup.brands.reduce((brandAcc, brand) => 
                        brandAcc + brand.products.reduce((prodAcc, prod) => 
                            prodAcc + prod.lots.reduce((lotAcc, lot) => lotAcc + lot.quantity, 0)
                        , 0)
                    , 0);
                }
                
                const displayQuantity = totalGroupQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 });

                return (
                    <AccordionItem value={baseGroup.baseProductId || baseGroup.name} key={baseGroup.baseProductId || baseGroup.name} className="border-none">
                        <Card className="bg-muted/30">
                            <AccordionTrigger className="p-4 hover:no-underline rounded-lg text-xl font-semibold [&[data-state=open]]:bg-muted [&[data-state=open]]:rounded-b-none">
                                <div className="flex justify-between items-center w-full">
                                    <span>{baseGroup.name}</span>
                                    <Badge variant="secondary" className="ml-4">{displayQuantity} {displayUnit}</Badge>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 space-y-3">
                            {baseGroup.brands.map(brandGroup => (
                                <div key={brandGroup.brandName}>
                                    <h3 className="font-semibold text-lg text-muted-foreground mb-2 pl-1">{brandGroup.brandName}</h3>
                                    <div className="space-y-4">
                                        {brandGroup.products.map(productGroup => (
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
                            ))}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                )
            })}
        </Accordion>
      </div>
    );
  };

  return (
    <>
      <Card className="w-full mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2">
            <ClipboardCheck /> Controle de insumos
          </CardTitle>
          <CardDescription>Gerencie os lotes em estoque, seus vencimentos e transferências.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
            <div className="mb-4">
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
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <Button onClick={handleAddClick} className="w-full sm:w-auto" disabled={!permissions.lots.add}>
                    <Plus className="mr-2" /> Adicionar lote
                </Button>
                {permissions.lots.viewMovementHistory && (
                    <Button variant="outline" onClick={() => setIsAuditModalOpen(true)} className="w-full sm:w-auto">
                        <History className="mr-2" /> Histórico de movimentações
                    </Button>
                )}
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

                {user?.username === 'Tiago Brasil' && (
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
                                Selecionar todos
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setSelectedKiosks([])} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                Limpar seleção
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
      
      
      <ZeroedLotsAuditModal
        open={isAuditModalOpen}
        onOpenChange={setIsAuditModalOpen}
      />
    </>
  );
}
