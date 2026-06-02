
"use client"

import * as React from 'react';
import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';
import Image from 'next/image';

import Papa from 'papaparse';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Search, ClipboardCheck, Inbox, Camera, Filter, Settings, Truck, Archive, History, Eraser, RefreshCw, ArrowRight, LineChart, Warehouse, MinusCircle, Download, Shield, AlertCircle, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { type LotEntry, type Product, type BaseProduct, type RepositionActivity, type UnitCategory } from '@/types';
import { LotCard } from './lot-card';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LotMovementHistoryModal } from './lot-movement-history-modal';
import { Badge } from '@/components/ui/badge';
import { convertValue, formatQuantity } from '@/lib/conversion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QuickProjectionModal } from './quick-projection-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useReposition } from '@/hooks/use-reposition';
import { ToastAction } from './ui/toast';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

export type GroupedProduct = {
  product: Product;
  lots: LotEntry[];
};

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

const ExpiryControlContext = React.createContext<{ selectedKioskId: string }>({ selectedKioskId: '' });
const useExpiryControlContext = () => React.useContext(ExpiryControlContext);
const ACTIVE_REPOSITION_RESERVATION_STATUSES: RepositionActivity["status"][] = [
  "Aguardando despacho",
  "Aguardando recebimento",
  "Recebido com divergência",
  "Recebido sem divergência",
];

function ActiveReservationsSummary({ selectedKioskId }: { selectedKioskId: string }) {
  const { activities } = useReposition();
  
  const summary = useMemo(() => {
    // Só mostramos o resumo se um quiosque específico (como Matriz) estiver selecionado
    if (!selectedKioskId || selectedKioskId === 'all') return null;

    const activeOutbound = activities.filter(act => 
      act.kioskOriginId === selectedKioskId &&
      ACTIVE_REPOSITION_RESERVATION_STATUSES.includes(act.status)
    );

    if (activeOutbound.length === 0) return null;

    const totalReservedItems = activeOutbound.reduce((sum, act) => {
      const itemsQty = act.items.reduce((iSum, item) => 
        iSum + item.suggestedLots.reduce((lSum, l) => lSum + l.quantityToMove, 0), 0
      );
      return sum + itemsQty;
    }, 0);

    return {
      activityCount: activeOutbound.length,
      itemCount: totalReservedItems
    };
  }, [activities, selectedKioskId]);

  if (!summary) return null;

  return (
    <div className="mx-6 mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between animate-in slide-in-from-top-2">
      <div className="flex items-center gap-3">
        <div className="bg-blue-500 p-2 rounded-full">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <h4 className="font-bold text-blue-900">Reservas Ativas na Matriz</h4>
          <p className="text-sm text-blue-700">
            {summary.activityCount} atividade(s) aguardando movimentação.
          </p>
        </div>
      </div>
      <Link href="/dashboard/stock/analysis">
          <Button variant="outline" size="sm">
              Ver atividades <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
      </Link>
    </div>
  );
}

function ExpiryControlContent() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading, addLot, updateLot, deleteLotsByIds, forceDeleteLotById, moveMultipleLots } = useExpiryProducts();
  const { products, loading: productsLoading, getProductFullName } = useProducts();
  const { locations, loading: locationsLoading } = useLocations();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { activeCategories } = useOperationalItemCategories();
  const { activities } = useReposition();

  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const scannedLotId = searchParams.get('lotId');
  const searchQuery = searchParams.get('search');
  const kioskQuery = searchParams.get('kioskId');


  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [selectedKioskId, setSelectedKioskId] = useState<string>('');
  const [selectedOperationalCategoryId, setSelectedOperationalCategoryId] = useState<string>('all');
  const [inventoryViewMode, setInventoryViewMode] = useState<'cards' | 'table'>('cards');

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
    if (kioskQuery) {
        setSelectedKioskId(kioskQuery);
    }
  }, [searchQuery, kioskQuery]);


  const visibleLots = useMemo(() => {
    if (!user || loading) return [];
    if (user.username === 'Tiago Brasil' || (permissions.stock.inventoryControl.editLot && permissions.stock.inventoryControl.writeDown)) return lots;
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
    if (!kioskQuery && kiosks.length > 0 && !selectedKioskId) {
      if (user?.username === 'Tiago Brasil') {
        setSelectedKioskId('all');
      } else if (user?.assignedKioskIds && user.assignedKioskIds.length > 0) {
        setSelectedKioskId(user.assignedKioskIds[0]);
      }
    }
  }, [kiosks, selectedKioskId, user, kioskQuery]);
  
  useEffect(() => {
    if (scannedLotId) {
      const element = document.getElementById(`lot-instance-${scannedLotId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('animate-pulse-once');
      }
    }
  }, [scannedLotId, loading]);


  const stockOperationalCategories = useMemo(
    () => activeCategories.filter((category) => category.destination !== 'asset'),
    [activeCategories],
  );

  const productMatchesOperationalCategory = (product: Product, categoryId: string) => {
    if (categoryId === 'all') return true;
    const category = activeCategories.find((entry) => entry.id === categoryId);
    if (!category) return false;
    if (category.destination === 'uniform') return product.operationalDestination === 'uniform';
    return product.operationalCategoryId === category.id ||
      (!product.operationalCategoryId && category.destination === 'stock' && category.id === 'insumo');
  };

  const filteredLotsBeforeCategory = useMemo(() => {
    const isAllKiosks = selectedKioskId === 'all';
    
    const kioskFilteredLots = isAllKiosks
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

    const searchedLots = preFilteredLots.filter(lot => {
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

    return searchedLots;
  }, [visibleLots, searchTerm, kiosks, statusFilters, products, selectedKioskId, user, baseProducts]);

  const operationalCategoryCounts = useMemo(() => {
    return stockOperationalCategories.reduce((acc, category) => {
      acc[category.id] = filteredLotsBeforeCategory.filter((lot) => {
        const product = products.find((entry) => entry.id === lot.productId);
        return !!product && productMatchesOperationalCategory(product, category.id);
      }).length;
      return acc;
    }, {} as Record<string, number>);
  }, [filteredLotsBeforeCategory, products, stockOperationalCategories, activeCategories]);

  const stockStats = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const productIds = new Set<string>();
    let expiringSoon = 0;
    let expired = 0;
    let healthy = 0;
    let noExpiry = 0;
    let reserved = 0;

    filteredLotsBeforeCategory.forEach((lot) => {
      productIds.add(lot.productId);
      reserved += Number(lot.reservedQuantity ?? 0);

      if (!lot.expiryDate) {
        noExpiry += 1;
        return;
      }

      const product = products.find((entry) => entry.id === lot.productId);
      const urgentThreshold = product?.urgentThreshold ?? 7;
      const days = differenceInDays(parseISO(lot.expiryDate), now);
      if (days < 0) {
        expired += 1;
      } else if (days <= urgentThreshold) {
        expiringSoon += 1;
      } else {
        healthy += 1;
      }
    });

    return {
      products: productIds.size,
      lots: filteredLotsBeforeCategory.length,
      expiringSoon,
      expired,
      healthy,
      noExpiry,
      reserved,
    };
  }, [filteredLotsBeforeCategory, products]);

  const activeReservationsByLot = useMemo(() => {
    const map = new Map<string, { total: number; destinations: Record<string, number> }>();
    activities
      .filter((activity) => ACTIVE_REPOSITION_RESERVATION_STATUSES.includes(activity.status))
      .forEach((activity) => {
        activity.items.forEach((item) => {
          item.suggestedLots.forEach((suggestedLot) => {
            const current = map.get(suggestedLot.lotId) ?? { total: 0, destinations: {} };
            current.total += suggestedLot.quantityToMove;
            current.destinations[activity.kioskDestinationName] =
              (current.destinations[activity.kioskDestinationName] ?? 0) + suggestedLot.quantityToMove;
            map.set(suggestedLot.lotId, current);
          });
        });
      });
    return map;
  }, [activities]);

 const groupedData = useMemo(() => {
    const categoryFilteredLots = selectedOperationalCategoryId === 'all'
      ? filteredLotsBeforeCategory
      : filteredLotsBeforeCategory.filter((lot) => {
          const product = products.find((entry) => entry.id === lot.productId);
          return !!product && productMatchesOperationalCategory(product, selectedOperationalCategoryId);
        });

    const lotsByProduct = categoryFilteredLots.reduce((acc, lot) => {
        if (!acc[lot.productId]) {
            acc[lot.productId] = [];
        }
        acc[lot.productId].push(lot);
        return acc;
    }, {} as Record<string, LotEntry[]>);

    const groupedLotsByProduct: Record<string, LotEntry[]> = {};
    for (const productId in lotsByProduct) {
        const productLots = lotsByProduct[productId];
        const lotsByKey: Record<string, LotEntry> = {};

        productLots.forEach(lot => {
            const key = `${lot.lotNumber}-${lot.expiryDate || 'no-expiry'}-${lot.kioskId}`;
            if (lotsByKey[key]) {
                lotsByKey[key].quantity += lot.quantity;
                if (lot.reservedQuantity) {
                    lotsByKey[key].reservedQuantity = (lotsByKey[key].reservedQuantity || 0) + lot.reservedQuantity;
                }
            } else {
                lotsByKey[key] = { ...lot };
            }
        });
        groupedLotsByProduct[productId] = Object.values(lotsByKey);
    }
    const finalLotsToGroup = Object.values(groupedLotsByProduct).flat();
    

    const groups: Map<string, GroupedByBaseProduct> = new Map();

    finalLotsToGroup.forEach(lot => {
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
          baseProductId: product.baseProductId ?? null,
          baseProduct: baseProduct ?? null,
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

    groups.forEach(baseGroup => {
        baseGroup.brands.forEach(brandGroup => {
            brandGroup.products.sort((a,b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product)))
        });
        baseGroup.brands.sort((a,b) => a.brandName.localeCompare(b.brandName));
    });

    return Array.from(groups.values()).sort((a,b) => a.name.localeCompare(b.name));
  }, [filteredLotsBeforeCategory, selectedOperationalCategoryId, products, baseProducts, getProductFullName, activeCategories]);

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

  const toggleStatusFilter = (filter: string) => {
    handleStatusFilterChange(filter, !statusFilters.includes(filter));
  };

  const canManageProducts = permissions.registration.items.add || permissions.registration.items.edit || permissions.registration.items.delete;

  const handleExportPdf = () => {
    toast({
        title: "Exportação em manutenção",
        description: "A função de exportar para PDF está sendo atualizada. Tente a exportação para CSV.",
        variant: "destructive",
    })
  };
  
  const handleExportCsv = () => {
    const csvData: any[] = [];
    groupedData.forEach(baseGroup => {
        baseGroup.brands.forEach(brandGroup => {
            brandGroup.products.forEach(productGroup => {
                productGroup.lots.forEach(lot => {
                    csvData.push({
                        "Produto Base": baseGroup.name,
                        "Insumo": getProductFullName(productGroup.product),
                        "Marca": productGroup.product.brand || 'N/A',
                        "Lote": lot.lotNumber,
                        "Quantidade": lot.quantity,
                        "Validade": lot.expiryDate ? format(parseISO(lot.expiryDate), 'dd/MM/yyyy') : 'N/A',
                        "Quiosque": kiosks.find(k => k.id === lot.kioskId)?.name || 'N/A',
                        "Localizacao": locations.find(l => l.id === lot.locationId)?.name || 'N/A',
                    });
                });
            });
        });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const kioskName = selectedKioskId === 'all' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKioskId)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    link.setAttribute("href", url);
    link.setAttribute("download", `estoque_${kioskName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderTableContent = () => (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-[34%]">Insumo / marca</TableHead>
            <TableHead>Lote</TableHead>
            <TableHead>Local</TableHead>
            <TableHead>Validade</TableHead>
            <TableHead className="text-right">Quantidade</TableHead>
            <TableHead>Reserva</TableHead>
            <TableHead className="w-24 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupedData.map((baseGroup) => {
            const rows = baseGroup.brands.flatMap((brandGroup) =>
              brandGroup.products.flatMap((productGroup) =>
                productGroup.lots.map((lot) => ({ productGroup, lot }))
              )
            );

            return (
              <React.Fragment key={baseGroup.baseProductId || baseGroup.name}>
                <TableRow className="bg-muted/25 hover:bg-muted/25">
                  <TableCell colSpan={7} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase tracking-tight">{baseGroup.name}</span>
                        {baseGroup.hasLeadTime && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-blue-500 hover:text-blue-600"
                            onClick={() => setQuickProjectionProduct(baseGroup.baseProduct)}
                          >
                            <LineChart className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <Badge variant="secondary">{rows.length} lote(s)</Badge>
                    </div>
                  </TableCell>
                </TableRow>
                {rows.map(({ productGroup, lot }) => {
                  const product = productGroup.product;
                  const kiosk = kiosks.find((entry) => entry.id === lot.kioskId);
                  const location = locations.find((entry) => entry.id === lot.locationId);
                  const reserved = activeReservationsByLot.get(lot.id);
                  const displayReservedQty = Math.max(Number(lot.reservedQuantity ?? 0), reserved?.total ?? 0);
                  const reservationDestinations = reserved
                    ? Object.entries(reserved.destinations).map(([name, quantity]) => ({ name, quantity }))
                    : [];
                  const totalUnits = lot.quantity * product.packageSize;
                  const quantityDetails =
                    totalUnits === lot.quantity && ['un', 'unidade'].includes(product.unit.toLowerCase())
                      ? `${lot.quantity.toLocaleString('pt-BR')} unidade(s)`
                      : `${formatQuantity(totalUnits, product.unit)} · ${lot.quantity.toLocaleString('pt-BR')} ${product.packageType || 'pct'}`;
                  const days = lot.expiryDate ? differenceInDays(parseISO(lot.expiryDate), new Date()) : null;
                  const urgentThreshold = product.urgentThreshold ?? 7;
                  const expiryTone =
                    days === null ? 'secondary' :
                    days < 0 ? 'destructive' :
                    days <= urgentThreshold ? 'outline' :
                    'secondary';
                  const expiryLabel =
                    days === null ? 'Validade indefinida' :
                    days < 0 ? `Vencido há ${Math.abs(days)} dia(s)` :
                    days === 0 ? 'Vence hoje' :
                    `Vence em ${days} dia(s)`;

                  return (
                    <TableRow key={`${product.id}-${lot.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {product.imageUrl ? (
                            <Image
                              src={product.imageUrl}
                              alt={`Foto de ${product.baseName}`}
                              width={32}
                              height={32}
                              className="h-8 w-8 rounded-md object-cover"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-muted" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{getProductFullName(product)}</div>
                            <div className="text-xs text-muted-foreground">
                              {product.brand || 'Sem marca'} · {product.packageType || 'un'} com {product.packageSize}{product.unit}
                              {product.multiplo_caixa && product.rotulo_caixa
                                ? ` · ${product.rotulo_caixa}: ${product.multiplo_caixa}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{lot.lotNumber}</TableCell>
                      <TableCell>
                        <div className="text-sm">{kiosk?.name || 'Quiosque desconhecido'}</div>
                        {location && <div className="text-xs text-muted-foreground">{location.name}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={expiryTone as any}>{expiryLabel}</Badge>
                          {lot.expiryDate && (
                            <div className="text-xs text-muted-foreground">
                              {format(parseISO(lot.expiryDate), 'dd/MM/yyyy')}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-semibold">{quantityDetails}</div>
                      </TableCell>
                      <TableCell>
                        {displayReservedQty > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary" className="rounded-full text-xs text-blue-700">
                              Reserva: {displayReservedQty}
                            </Badge>
                            {reservationDestinations.length > 0 ? (
                              reservationDestinations.map((destination) => (
                                <Badge key={destination.name} variant="outline" className="rounded-full text-xs">
                                  {destination.name}: {destination.quantity}
                                </Badge>
                              ))
                            ) : (
                              <Badge variant="outline" className="rounded-full text-xs">Em processamento</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditClick(lot.id)} disabled={!permissions.stock.inventoryControl.editLot}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleViewHistoryClick(lot)}>
                            <History className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteClick(lot.id)} disabled={!permissions.stock.inventoryControl.writeDown}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );


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
              <Button size="lg" onClick={handleAddClick} disabled={!permissions.stock.inventoryControl.addLot}>
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
    
    if (inventoryViewMode === 'table') {
      return renderTableContent();
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
                               if (baseProduct) {
                                   sumInFirstUnit += convertValue(convertedTotals[unit], unit, baseProduct.unit, baseProduct.category);
                                   totalConvertedDisplay = `${sumInFirstUnit.toLocaleString('pt-BR')} ${baseProduct.unit}`;
                               } else {
                                   possible = false;
                                   break;
                               }
                           } catch (e) {
                               possible = false;
                               break;
                           }
                       }
                       if (!possible) {
                           totalConvertedDisplay = "Conversão Indisponível";
                       }
                  }
              } else if (totalPackages > 0) {
                  totalConvertedDisplay = "0"; // Handle cases with packages but no convertible value
              } else {
                  totalConvertedDisplay = "0";
              }
              
              const firstProductInGroup = baseGroup.brands?.[0]?.products?.[0]?.product;
              const packageTypeForDisplay = firstProductInGroup?.packageType ? `${firstProductInGroup.packageType}(s)` : 'unidades';

              const logisticDetails = firstProductInGroup 
                  ? { multiplo: firstProductInGroup.multiplo_caixa, rotulo: firstProductInGroup.rotulo_caixa } 
                  : { multiplo: undefined, rotulo: undefined };

              let totalBoxes: number | null = null;
              if (logisticDetails.multiplo && logisticDetails.multiplo > 0) {
                  totalBoxes = totalPackages / logisticDetails.multiplo;
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
                                <Badge variant="secondary" className="px-3 py-1 text-sm">
                                    {totalPackages.toLocaleString('pt-BR')} {packageTypeForDisplay}
                                </Badge>
                                {totalBoxes !== null && logisticDetails.rotulo && (
                                    <>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0"/>
                                        <Badge variant="outline" className="px-3 py-1 text-sm">
                                            {totalBoxes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} {logisticDetails.rotulo}(s)
                                        </Badge>
                                    </>
                                )}
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
        <div className='mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 space-y-4'>
            <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar por insumo base, produto, lote, cód. de barras..."
                    className="h-11 rounded-lg border-border bg-background pl-10 pr-12"
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
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleAddClick} className="w-full sm:w-auto rounded-lg" disabled={!permissions.stock.inventoryControl.addLot}>
                    <Plus className="mr-2 h-4 w-4" /> Adicionar lote
                </Button>
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className='w-full sm:w-auto rounded-lg'>
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
                    <SelectTrigger className="w-full rounded-lg sm:w-56">
                        <Warehouse className="mr-2 h-4 w-4" />
                        <SelectValue placeholder="Selecione um quiosque..." />
                    </SelectTrigger>
                    <SelectContent>
                        {user?.username === 'Tiago Brasil' && <SelectItem value="all">Todos os quiosques</SelectItem>}
                        {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full sm:w-auto rounded-lg" disabled={groupedData.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Exportar
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={handleExportPdf}>Exportar como PDF</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportCsv}>Exportar como CSV</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto">
                <Button
                  type="button"
                  variant={inventoryViewMode === 'cards' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 flex-1 rounded-md sm:flex-none"
                  onClick={() => setInventoryViewMode('cards')}
                >
                  Cards
                </Button>
                <Button
                  type="button"
                  variant={inventoryViewMode === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 flex-1 rounded-md sm:flex-none"
                  onClick={() => setInventoryViewMode('table')}
                >
                  Tabela
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                    { label: 'Insumos', value: stockStats.products, tone: 'text-foreground' },
                    { label: 'Lotes ativos', value: stockStats.lots, tone: 'text-foreground' },
                    { label: 'Vencendo', value: stockStats.expiringSoon, tone: 'text-orange-600' },
                    { label: 'Vencidos', value: stockStats.expired, tone: 'text-rose-600' },
                    { label: 'Reservas ativas', value: stockStats.reserved, tone: 'text-blue-600' },
                ].map((stat) => (
                    <div key={stat.label} className="rounded-lg border bg-card p-4 shadow-sm">
                        <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
                        <div className={`mt-2 text-2xl font-bold ${stat.tone}`}>{stat.value}</div>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant={selectedOperationalCategoryId === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedOperationalCategoryId('all')}
                    className="h-9 rounded-full px-4"
                >
                    Todas
                    <span className="ml-2 rounded-full bg-background/20 px-1.5 text-xs font-bold">
                        {filteredLotsBeforeCategory.length}
                    </span>
                </Button>
                {stockOperationalCategories.map((category) => {
                    const active = selectedOperationalCategoryId === category.id;
                    const count = operationalCategoryCounts[category.id] ?? 0;
                    return (
                        <Button
                            key={category.id}
                            type="button"
                            variant={active ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setSelectedOperationalCategoryId(category.id)}
                            className="h-9 rounded-full px-4"
                        >
                            {category.name}
                            <span className="ml-2 rounded-full bg-background/20 px-1.5 text-xs font-bold">
                                {count}
                            </span>
                        </Button>
                    );
                })}
            </div>
        </div>
        <div className="mx-auto w-full max-w-6xl flex-1 overflow-hidden px-4 pb-6 pt-0 sm:px-6">
                <ActiveReservationsSummary selectedKioskId={selectedKioskId} />
                {renderContent()}
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
