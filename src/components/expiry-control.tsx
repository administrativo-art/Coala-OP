
"use client"

import * as React from 'react';
import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import Image from 'next/image';

import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Camera, Inbox, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canAccessUnit } from '@/lib/unit-access';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { type LotEntry, type Product, type BaseProduct } from '@/types';
import { AddEditLotModal } from './add-edit-lot-modal';
import { MoveStockModal } from './move-stock-modal';
import { QuickProjectionModal } from './quick-projection-modal';
import { convertValue } from '@/lib/conversion';
import { useReposition } from '@/hooks/use-reposition';
import { UNIFORM_STOCK_ID } from '@/lib/uniform';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { LotDetailPanel } from './stock/lot-detail-panel';
import {
  ACTIVE_REPOSITION_RESERVATION_STATUSES,
  buildReservationsByLot,
  lotMatchesStatusFilters,
  lotQuantityParts,
  lotReservedQuantity,
  lotStatusOf,
  productInitials,
  productSpecLine,
} from './stock/lot-presentation';

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

const STATUS_FILTER_NAMES: Record<string, string> = {
  expiring: 'Vencendo',
  expired: 'Vencidos',
  reserved: 'Com reserva',
  no_expiry: 'Validade indefinida',
};

const ROW_HOVER =
  'transition-[transform,box-shadow,border-radius,background-color] duration-[180ms] ease-[cubic-bezier(.2,.8,.2,1)] hover:z-[3] hover:-translate-y-[3px] hover:rounded-[14px] hover:bg-white hover:shadow-[0_16px_36px_rgba(21,21,28,.16),0_2px_6px_rgba(21,21,28,.06)]';

const DARK_CONTROL =
  'flex h-12 items-center gap-2 whitespace-nowrap rounded-[14px] border border-white/15 bg-transparent px-4 text-[13.5px] font-bold text-[#f3f2ee] hover:bg-white/10';

const MENU_ITEM = 'h-9 cursor-pointer rounded-[9px] px-2.5 text-[13px] font-semibold text-[#1a1b1f] focus:bg-[#f6f4ef]';

/** Total do grupo: quantidade convertida, embalagens e (se houver) caixas. */
function summarizeGroup(baseGroup: GroupedByBaseProduct) {
  let totalPackages = 0;
  const convertedTotals: { [unit: string]: number } = {};

  baseGroup.brands.forEach(brand => {
    brand.products.forEach(prodGroup => {
      prodGroup.lots.forEach(lot => {
        totalPackages += lot.quantity;
        const config = prodGroup.product;
        let value = 0;
        let unit = '';
        if (config.secondaryUnit && typeof config.secondaryUnitValue === 'number' && config.secondaryUnitValue > 0) {
          value = lot.quantity * config.secondaryUnitValue;
          unit = config.secondaryUnit;
        } else {
          value = lot.quantity * config.packageSize;
          unit = config.unit;
        }
        if (value > 0) convertedTotals[unit] = (convertedTotals[unit] ?? 0) + value;
      });
    });
  });

  const firstUnit = Object.keys(convertedTotals)[0];
  let converted = '0';
  if (firstUnit) {
    if (Object.keys(convertedTotals).length === 1) {
      converted = `${convertedTotals[firstUnit].toLocaleString('pt-BR')} ${firstUnit}`;
    } else {
      converted = 'Conversão Indisponível';
      const baseProduct = baseGroup.baseProduct;
      if (baseProduct) {
        try {
          let sum = 0;
          for (const unit in convertedTotals) {
            sum += convertValue(convertedTotals[unit], unit, baseProduct.unit, baseProduct.category);
          }
          converted = `${sum.toLocaleString('pt-BR')} ${baseProduct.unit}`;
        } catch {
          converted = 'Conversão Indisponível';
        }
      }
    }
  }

  const first = baseGroup.brands?.[0]?.products?.[0]?.product;
  const unit = (first?.unit || '').toLowerCase();
  const selfPackage = (unit === 'un' || unit === 'unidade') && first?.packageSize === 1;
  const extra: string[] = [];
  if (totalPackages > 0 && !selfPackage) {
    extra.push(`${totalPackages.toLocaleString('pt-BR')} ${first?.packageType ? `${first.packageType}(s)` : 'unidades'}`);
  }
  if (first?.multiplo_caixa && first.multiplo_caixa > 0 && first.rotulo_caixa && totalPackages > 0) {
    extra.push(`${(totalPackages / first.multiplo_caixa).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${first.rotulo_caixa}(s)`);
  }

  return { totalPackages, converted, extra };
}

type ExpiryControlProps = {
  onOpenHistory?: () => void;
  onOpenConsumption?: () => void;
  /** Ações que antes ficavam no botão flutuante; agora moram no menu "Ações" do painel. */
  onOpenWriteDown?: () => void;
  onOpenTransfer?: () => void;
  onOpenLabels?: () => void;
  /** Voltar e título da tela, dentro do painel escuro (uma só massa escura por tela). */
  heading?: React.ReactNode;
};

function ExpiryControlContent({ onOpenHistory, onOpenConsumption, onOpenWriteDown, onOpenTransfer, onOpenLabels, heading }: ExpiryControlProps) {
  const { user, permissions, isDefaultAdmin } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading, addLot, updateLot, forceDeleteLotById, moveMultipleLots } = useExpiryProducts();
  const { products, loading: productsLoading, getProductFullName } = useProducts();
  const { locations, loading: locationsLoading } = useLocations();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { activeCategories } = useOperationalItemCategories();
  const { activities } = useReposition();

  const searchParams = useSearchParams();
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
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);
  const [quickProjectionProduct, setQuickProjectionProduct] = useState<BaseProduct | null>(null);

  useEffect(() => {
    if (searchQuery) setSearchTerm(searchQuery);
    if (kioskQuery) setSelectedKioskId(kioskQuery);
  }, [searchQuery, kioskQuery]);

  const canSeeAllKiosks = isDefaultAdmin || user?.unitAccessScope === 'all';

  const visibleLots = useMemo(() => {
    if (!user || loading) return [];
    const uniformProductIds = new Set(
      products
        .filter((product) => product.operationalDestination === 'uniform' || product.category === 'Vestimenta')
        .map((product) => product.id),
    );
    const commonStockLots = lots.filter(
      (lot) => lot.kioskId !== UNIFORM_STOCK_ID && !uniformProductIds.has(lot.productId),
    );
    return commonStockLots.filter((lot) => canAccessUnit(user, lot.kioskId, { isDefaultAdmin }));
  }, [isDefaultAdmin, lots, products, user, loading]);

  const sortedKiosks = useMemo(() => {
    const visibleKiosks = user
      ? kiosks.filter((kiosk) => canAccessUnit(user, kiosk.id, { isDefaultAdmin }))
      : [];
    return visibleKiosks.sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [isDefaultAdmin, kiosks, user]);

  useEffect(() => {
    if (!kioskQuery && sortedKiosks.length > 0 && !selectedKioskId) {
      setSelectedKioskId(canSeeAllKiosks ? 'all' : sortedKiosks[0].id);
    }
  }, [canSeeAllKiosks, kioskQuery, selectedKioskId, sortedKiosks]);

  useEffect(() => {
    if (scannedLotId) {
      const element = document.getElementById(`lot-instance-${scannedLotId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('animate-pulse-once');
      }
    }
  }, [scannedLotId, loading]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

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

  const reservationsByLot = useMemo(() => buildReservationsByLot(activities), [activities]);

  // Lotes ativos do quiosque escolhido: base dos indicadores.
  const kioskLots = useMemo(() => {
    const scoped = selectedKioskId === 'all' ? visibleLots : visibleLots.filter(lot => lot.kioskId === selectedKioskId);
    return scoped.filter(lot => lot.quantity > 0);
  }, [visibleLots, selectedKioskId]);

  // Busca aplicada: base das contagens por categoria.
  const searchedLots = useMemo(() => {
    const search = searchTerm.toLowerCase();
    return kioskLots.filter(lot => {
      const product = productById.get(lot.productId);
      if (!product) return false;
      const expiryDateFormatted = lot.expiryDate ? format(parseISO(lot.expiryDate), 'dd/MM/yyyy') : 'indefinida';
      const kioskName = kiosks.find(l => l.id === lot.kioskId)?.name.toLowerCase() || '';
      const productBase = baseProducts.find(bp => bp.id === product.baseProductId);

      return (
        product.baseName.toLowerCase().includes(search) ||
        (product.brand && product.brand.toLowerCase().includes(search)) ||
        lot.lotNumber.toLowerCase().includes(search) ||
        (product?.barcode && product.barcode.toLowerCase().includes(search)) ||
        expiryDateFormatted.includes(search) ||
        kioskName.includes(search) ||
        !!productBase?.name.toLowerCase().includes(search)
      );
    });
  }, [kioskLots, searchTerm, kiosks, productById, baseProducts]);

  const filteredLotsBeforeCategory = useMemo(
    () => searchedLots.filter(lot => lotMatchesStatusFilters(
      statusFilters,
      lotStatusOf(lot, productById.get(lot.productId)),
      lotReservedQuantity(lot, reservationsByLot.get(lot.id)),
    )),
    [searchedLots, statusFilters, productById, reservationsByLot],
  );

  const operationalCategoryCounts = useMemo(() => {
    return stockOperationalCategories.reduce((acc, category) => {
      acc[category.id] = filteredLotsBeforeCategory.filter((lot) => {
        const product = productById.get(lot.productId);
        return !!product && productMatchesOperationalCategory(product, category.id);
      }).length;
      return acc;
    }, {} as Record<string, number>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLotsBeforeCategory, productById, stockOperationalCategories, activeCategories]);

  // Indicadores do quiosque inteiro: não mudam ao filtrar por um deles.
  const stockStats = useMemo(() => {
    const productIds = new Set<string>();
    let expiringSoon = 0;
    let expired = 0;
    let reserved = 0;

    kioskLots.forEach((lot) => {
      productIds.add(lot.productId);
      if (lotReservedQuantity(lot, reservationsByLot.get(lot.id)) > 0) reserved += 1;
      const status = lotStatusOf(lot, productById.get(lot.productId));
      if (status.key === 'expired') expired += 1;
      else if (status.key === 'expiring') expiringSoon += 1;
    });

    return { products: productIds.size, lots: kioskLots.length, expiringSoon, expired, reserved };
  }, [kioskLots, productById, reservationsByLot]);

  const groupedData = useMemo(() => {
    const categoryFilteredLots = selectedOperationalCategoryId === 'all'
      ? filteredLotsBeforeCategory
      : filteredLotsBeforeCategory.filter((lot) => {
          const product = productById.get(lot.productId);
          return !!product && productMatchesOperationalCategory(product, selectedOperationalCategoryId);
        });

    const lotsByKey: Record<string, LotEntry> = {};
    categoryFilteredLots.forEach(lot => {
      const key = `${lot.productId}-${lot.lotNumber}-${lot.expiryDate || 'no-expiry'}-${lot.kioskId}`;
      if (lotsByKey[key]) {
        lotsByKey[key].quantity += lot.quantity;
        if (lot.reservedQuantity) {
          lotsByKey[key].reservedQuantity = (lotsByKey[key].reservedQuantity || 0) + lot.reservedQuantity;
        }
      } else {
        lotsByKey[key] = { ...lot };
      }
    });

    const groups: Map<string, GroupedByBaseProduct> = new Map();

    Object.values(lotsByKey).forEach(lot => {
      const product = productById.get(lot.productId);
      if (!product) return;

      const baseProductId = product.baseProductId || `avulso-${product.id}`;
      const baseProduct = product.baseProductId ? baseProducts.find(bp => bp.id === product.baseProductId) : null;
      const groupName = baseProduct ? baseProduct.name : getProductFullName(product);
      const brandName = product.brand || 'Sem Marca';
      const hasLeadTime = !!(baseProduct && Object.values(baseProduct.stockLevels).some(sl => sl.leadTime && sl.leadTime > 0));

      if (!groups.has(baseProductId)) {
        groups.set(baseProductId, {
          isBaseProduct: !!baseProduct,
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
        productGroup = { product, lots: [] };
        brandGroup.products.push(productGroup);
      }
      productGroup.lots.push(lot);
    });

    groups.forEach(baseGroup => {
      baseGroup.brands.forEach(brandGroup => {
        brandGroup.products.sort((a,b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product)));
        // Lista já vem ordenada por validade; sem validade vai para o fim.
        brandGroup.products.forEach(productGroup => {
          productGroup.lots.sort((a, b) => (a.expiryDate || '9999') < (b.expiryDate || '9999') ? -1 : 1);
        });
      });
      baseGroup.brands.sort((a,b) => a.brandName.localeCompare(b.brandName));
    });

    return Array.from(groups.values()).sort((a,b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLotsBeforeCategory, selectedOperationalCategoryId, productById, baseProducts, getProductFullName, activeCategories]);

  const shownLots = useMemo(
    () => groupedData.reduce((sum, group) => sum + group.brands.reduce((s, b) => s + b.products.reduce((p, pg) => p + pg.lots.length, 0), 0), 0),
    [groupedData],
  );
  const shownProducts = useMemo(
    () => groupedData.reduce((sum, group) => sum + group.brands.reduce((s, b) => s + b.products.length, 0), 0),
    [groupedData],
  );

  const selectedLot = useMemo(() => {
    if (!selectedLotId) return null;
    for (const group of groupedData) {
      for (const brand of group.brands) {
        for (const productGroup of brand.products) {
          const lot = productGroup.lots.find(entry => entry.id === selectedLotId);
          if (lot) return { lot, product: productGroup.product };
        }
      }
    }
    return null;
  }, [groupedData, selectedLotId]);

  // Se o lote sair da lista (baixa total, filtro), o painel fecha junto.
  useEffect(() => {
    if (selectedLotId && !selectedLot && !loading) setSelectedLotId(null);
  }, [selectedLot, selectedLotId, loading]);

  const reservationBanner = useMemo(() => {
    if (!selectedKioskId || selectedKioskId === 'all') return null;
    const outbound = activities.filter(act =>
      act.kioskOriginId === selectedKioskId && ACTIVE_REPOSITION_RESERVATION_STATUSES.includes(act.status),
    );
    return outbound.length ? { activityCount: outbound.length } : null;
  }, [activities, selectedKioskId]);

  const handleAddClick = () => {
    setLotToEdit(null);
    setIsAddEditModalOpen(true);
  };

  const handleEditClick = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    if (lot) {
      setLotToEdit(lot);
      setIsAddEditModalOpen(true);
    }
  };

  const handleMoveClick = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    if (lot) {
      setLotToMove(lot);
      setIsMoveModalOpen(true);
    }
  };

  const handleSearchScanSuccess = (decodedText: string) => {
    setSearchTerm(decodedText);
    setIsSearchScannerOpen(false);
  };

  const toggleStatusFilter = (filter: string) => {
    setStatusFilters(current => current.includes(filter) ? current.filter(f => f !== filter) : [...current, filter]);
  };

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
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const kioskName = selectedKioskId === 'all' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKioskId)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    link.setAttribute("href", url);
    link.setAttribute("download", `estoque_${kioskName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const kioskLabel = selectedKioskId === 'all'
    ? 'Todos os quiosques'
    : kiosks.find(k => k.id === selectedKioskId)?.name || 'Selecione…';

  const getLotView = (lot: LotEntry, product: Product) => {
    const status = lotStatusOf(lot, product);
    const reservation = reservationsByLot.get(lot.id);
    const reserved = lotReservedQuantity(lot, reservation);
    const destinations = reservation ? Object.entries(reservation.destinations) : [];
    return {
      status,
      reservation,
      reserved,
      destinations,
      parts: lotQuantityParts(lot, product),
      kioskName: kiosks.find(k => k.id === lot.kioskId)?.name || 'Quiosque desconhecido',
      locationName: lot.locationId ? locations.find(l => l.id === lot.locationId)?.name : null,
      expiry: lot.expiryDate ? format(parseISO(lot.expiryDate), 'dd/MM/yyyy') : 'Indefinida',
    };
  };

  const openLotProps = (lotId: string) => ({
    id: `lot-instance-${lotId}`,
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => setSelectedLotId(lotId),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelectedLotId(lotId);
      }
    },
  });

  const ProductThumb = ({ product, size }: { product: Product; size: number }) => (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden border border-[#ebe7df] bg-[#f3f1ec] font-mono font-bold text-[#9a9ba1]"
      style={{ width: size, height: size, borderRadius: size >= 56 ? 14 : 8, fontSize: size >= 56 ? 13 : 10 }}
    >
      {product.imageUrl ? (
        <Image src={product.imageUrl} alt={`Foto de ${product.baseName}`} width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        productInitials(product)
      )}
    </div>
  );

  const renderTableContent = () => (
    <div className="overflow-auto rounded-[18px] border border-[#e3dfd6] bg-white">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[minmax(0,2.4fr)_130px_minmax(0,1.3fr)_150px_170px_minmax(0,1.2fr)] gap-3.5 border-b border-[#e3dfd6] bg-[#f6f4ef] px-[18px] py-3 text-[10.5px] font-extrabold uppercase tracking-[.1em] text-[#9a9ba1]">
          <span>Insumo / marca</span><span>Lote</span><span>Local</span><span>Validade</span><span className="text-right">Quantidade</span><span>Reserva</span>
        </div>
        {groupedData.map((baseGroup) => {
          const rows = baseGroup.brands.flatMap(b => b.products.flatMap(pg => pg.lots.map(lot => ({ product: pg.product, lot }))))
            .sort((a, b) => (a.lot.expiryDate || '9999') < (b.lot.expiryDate || '9999') ? -1 : 1);
          const summary = summarizeGroup(baseGroup);
          return (
            <React.Fragment key={baseGroup.baseProductId || baseGroup.name}>
              <div className="flex items-center justify-between border-b border-[#efece6] bg-[#fbfaf7] px-[18px] py-2.5">
                <span className="text-[12.5px] font-extrabold uppercase tracking-[.02em]">{baseGroup.name}</span>
                <span className="text-xs text-[#70757d]">{rows.length} lotes · <b className="text-[#a6325b]">{summary.converted}</b></span>
              </div>
              {rows.map(({ product, lot }) => {
                const view = getLotView(lot, product);
                return (
                  <div
                    key={`${product.id}-${lot.id}`}
                    {...openLotProps(lot.id)}
                    className={cn(
                      'relative grid cursor-pointer grid-cols-[minmax(0,2.4fr)_130px_minmax(0,1.3fr)_150px_170px_minmax(0,1.2fr)] items-center gap-3.5 border-b border-[#f1eee8] px-[18px] py-[11px]',
                      ROW_HOVER,
                      selectedLotId === lot.id ? 'bg-[#fbf3f6] shadow-[inset_3px_0_0_#a6325b]' : 'bg-white',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProductThumb product={product} size={30} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-bold">{getProductFullName(product)}</span>
                        <span className="truncate text-[11.5px] text-[#9a9ba1]">{productSpecLine({ ...product, multiplo_caixa: undefined, rotulo_caixa: undefined })}</span>
                      </span>
                    </div>
                    <span className="font-mono text-xs font-semibold">{lot.lotNumber}</span>
                    <span className="flex min-w-0 flex-col"><span className="text-[13px]">{view.kioskName}</span><span className="text-[11.5px] text-[#9a9ba1]">{view.locationName}</span></span>
                    <span className="flex flex-col items-start gap-[3px]"><span className={view.status.pillClass}>{view.status.text}</span><span className="font-mono text-[11.5px] text-[#70757d]">{view.expiry}</span></span>
                    <span className="text-right text-[13px] font-bold">{view.parts.map(p => `${p.value} ${p.unit}`).join(' · ')}</span>
                    <span className="text-xs font-semibold text-[#1d4ed8]">
                      {view.reserved > 0
                        ? `${view.reserved.toLocaleString('pt-BR')} · ${view.destinations.length ? view.destinations.map(([name]) => name).join(', ') : 'Em processamento'}`
                        : '—'}
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );

  const renderCardsContent = () => (
    <div className="flex flex-col gap-7">
      {groupedData.map(baseGroup => {
        const summary = summarizeGroup(baseGroup);
        const groupLots = baseGroup.brands.reduce((s, b) => s + b.products.reduce((p, pg) => p + pg.lots.length, 0), 0);
        return (
          <section key={baseGroup.baseProductId || baseGroup.name} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3dfd6] px-1 pb-2">
              <div className="flex items-center gap-2.5">
                <h2 className="m-0 text-[19px] font-extrabold uppercase tracking-[-.01em]">{baseGroup.name}</h2>
                {baseGroup.hasLeadTime && baseGroup.baseProduct && (
                  <button
                    type="button"
                    title="Projeção de consumo"
                    onClick={() => setQuickProjectionProduct(baseGroup.baseProduct)}
                    className="h-6 rounded-[7px] border border-[#d7e2fb] bg-[#eef3fe] px-2 text-[11.5px] font-bold text-[#1d4ed8]"
                  >
                    Projeção
                  </button>
                )}
                <span className="text-xs text-[#9a9ba1]">{groupLots} lotes</span>
              </div>
              {summary.totalPackages > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                  <span className="font-extrabold text-[#a6325b]">{summary.converted}</span>
                  {summary.extra.map(item => (
                    <React.Fragment key={item}>
                      <span className="text-[#c4c0b8]">→</span>
                      <span className="inline-flex h-[26px] items-center rounded-full bg-[#e6e3dc] px-2.5 text-[12.5px] font-bold">{item}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            {baseGroup.brands.flatMap(brandGroup => brandGroup.products).map(({ product, lots: productLots }) => (
              <div key={product.id} className="rounded-[18px] border border-[#e3dfd6] bg-white">
                <div className="flex items-center gap-3.5 px-[18px] py-3.5">
                  <ProductThumb product={product} size={56} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15.5px] font-extrabold">{getProductFullName(product)}</span>
                      {product.isArchived && <span className="rounded-full bg-[#eceae5] px-2 py-0.5 text-[11px] font-bold text-[#70757d]">Desativado</span>}
                    </div>
                    {(product.apparelSize || product.apparelColor || product.apparelType) && (
                      <span className="text-xs font-semibold text-[#b45309]">
                        {[product.apparelType, product.apparelColor, product.apparelSize && `Tam. ${product.apparelSize}`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <span className="text-[12.5px] text-[#70757d]">{productSpecLine(product, { withBarcode: true })}</span>
                  </div>
                  <span className="whitespace-nowrap text-[12.5px] text-[#9a9ba1]">{productLots.length} {productLots.length === 1 ? 'lote' : 'lotes'}</span>
                </div>
                <div className="rounded-b-[18px] border-t border-[#efece6]">
                  {productLots.map(lot => {
                    const view = getLotView(lot, product);
                    return (
                      <div
                        key={lot.id}
                        {...openLotProps(lot.id)}
                        className={cn(
                          'relative cursor-pointer border-b border-[#f1eee8] px-[18px] py-[13px] last:border-b-0',
                          ROW_HOVER,
                          selectedLotId === lot.id ? 'bg-[#fbf3f6] shadow-[inset_3px_0_0_#a6325b]' : 'bg-transparent',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex w-[170px] flex-col gap-1">
                            <span className="font-mono text-[12.5px] font-bold">{lot.lotNumber}</span>
                            <span className={view.status.pillClass}>{view.status.text}</span>
                          </div>
                          <div className="flex min-w-[160px] flex-1 flex-col gap-0.5">
                            <span className="text-[13px] font-semibold">{view.kioskName}</span>
                            <span className="text-xs text-[#9a9ba1]">{view.locationName}</span>
                          </div>
                          <div className="flex w-[110px] flex-col gap-0.5">
                            <span className="text-[10.5px] font-bold uppercase tracking-[.08em] text-[#9a9ba1]">Validade</span>
                            <span className="font-mono text-[12.5px] font-semibold">{view.expiry}</span>
                          </div>
                          <div className="ml-auto flex min-w-[220px] items-baseline justify-end gap-3.5">
                            {view.parts.map((part, index) => (
                              <span key={`${part.unit}-${index}`} className="flex items-baseline gap-1">
                                <b className="text-[19px] font-extrabold tracking-[-.02em]">{part.value}</b>
                                <span className="text-xs text-[#70757d]">{part.unit}</span>
                              </span>
                            ))}
                          </div>
                          <span className="w-4 text-right text-base text-[#c4c0b8]">›</span>
                        </div>
                        {view.reserved > 0 && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[#e3dfd6] pt-2.5">
                            <span className="text-xs font-extrabold text-[#1d4ed8]">Reserva ativa · {view.reserved.toLocaleString('pt-BR')}</span>
                            {view.destinations.length > 0 ? view.destinations.map(([name, quantity]) => (
                              <span key={name} className="whitespace-nowrap rounded-full bg-[#eef3fe] px-[9px] py-0.5 text-[11.5px] font-semibold text-[#1d4ed8]">{name}: {quantity}</span>
                            )) : (
                              <span className="whitespace-nowrap rounded-full bg-[#eef3fe] px-[9px] py-0.5 text-[11.5px] font-semibold text-[#1d4ed8]">Em processamento</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
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
            <div className="rounded-[18px] border border-dashed border-[#d6d2c8] bg-white px-5 py-16 text-center text-sm text-[#70757d]">
                Nenhum resultado com os filtros e a busca atuais.
            </div>
        );
    }

    return inventoryViewMode === 'table' ? renderTableContent() : renderCardsContent();
  };

  const kpis: { label: string; value: number; color: string; key?: string; hint?: string }[] = [
    { label: 'Insumos', value: stockStats.products, color: '#ffffff' },
    { label: 'Lotes ativos', value: stockStats.lots, color: '#ffffff' },
    { label: 'Vencendo', value: stockStats.expiringSoon, color: '#fb923c', key: 'expiring', hint: '≤ 7 dias' },
    { label: 'Vencidos', value: stockStats.expired, color: '#fb7185', key: 'expired' },
    { label: 'Reservas ativas', value: stockStats.reserved, color: '#93b4ff', key: 'reserved' },
  ];

  const categoryChips = [
    { id: 'all', name: 'Todas', count: searchedLots.filter(lot => lotMatchesStatusFilters(
        statusFilters, lotStatusOf(lot, productById.get(lot.productId)), lotReservedQuantity(lot, reservationsByLot.get(lot.id)),
      )).length },
    ...stockOperationalCategories.map(category => ({ id: category.id, name: category.name, count: operationalCategoryCounts[category.id] ?? 0 })),
  ];

  const activeFilterPills = [
    ...statusFilters.map(key => ({ label: STATUS_FILTER_NAMES[key] ?? key, clear: () => toggleStatusFilter(key) })),
    ...(selectedOperationalCategoryId !== 'all'
      ? [{ label: stockOperationalCategories.find(c => c.id === selectedOperationalCategoryId)?.name ?? 'Categoria', clear: () => setSelectedOperationalCategoryId('all') }]
      : []),
  ];

  return (
    <>
      <div className="mx-auto flex h-full w-full flex-col animate-in fade-in zoom-in-95">
        <div className="mx-auto w-full max-w-[1520px] px-4 pb-0 pt-3 sm:px-6">
          <div className="flex flex-col gap-[18px] rounded-[28px] bg-[#15151c] px-[26px] pb-5 pt-[22px] text-[#f3f2ee] shadow-[0_24px_60px_rgba(21,21,28,.18)]">
            {heading}
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#f08bb1]">Estoque · {kioskLabel}</span>

            <div className="grid grid-cols-2 gap-1 border-b border-white/10 md:grid-cols-5">
              {kpis.map((kpi) => {
                const on = !!kpi.key && statusFilters.includes(kpi.key);
                const content = (
                  <>
                    <span className="text-[34px] font-extrabold leading-none tracking-[-.04em]" style={{ color: kpi.value > 0 ? kpi.color : '#5d5c68' }}>
                      {kpi.value}
                    </span>
                    <span className="flex items-center gap-1.5 text-[13px] font-bold">
                      {kpi.label}
                      <span className="text-[10.5px] font-bold text-[#8e8d99]">{kpi.key ? (on ? 'filtrando' : kpi.hint ?? '') : ''}</span>
                    </span>
                  </>
                );
                const className = cn(
                  'flex flex-col items-start gap-1 rounded-t-xl border-b-2 px-3.5 pb-3.5 pt-1.5 text-left',
                  on ? 'bg-white/5 text-white' : 'text-[#c8c7d0]',
                  kpi.key ? 'cursor-pointer hover:bg-white/5' : 'cursor-default',
                );
                return kpi.key ? (
                  <button key={kpi.label} type="button" aria-pressed={on} onClick={() => toggleStatusFilter(kpi.key!)} className={className} style={{ borderBottomColor: on ? kpi.color : 'transparent' }}>
                    {content}
                  </button>
                ) : (
                  <div key={kpi.label} className={className} style={{ borderBottomColor: 'transparent' }}>{content}</div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-12 min-w-[260px] flex-1 items-center gap-3 rounded-[14px] border border-white/10 bg-white/[.07] pl-[18px] pr-2">
                <Search className="h-[18px] w-[18px] shrink-0 text-[#8e8d99]" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por insumo base, produto, lote, cód. de barras…"
                  className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] text-white outline-none placeholder:text-[#8e8d99]"
                />
                {searchTerm && (
                  <button type="button" onClick={() => setSearchTerm('')} aria-label="Limpar busca" className="text-[#8e8d99] hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsSearchScannerOpen(true)}
                  title="Escanear código de barras"
                  aria-label="Escanear código de barras para busca"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-white/[.08] text-[#c8c7d0] hover:bg-white/15"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={DARK_CONTROL}>
                    <span className="text-[10.5px] font-semibold text-[#8e8d99]">Quiosque</span>
                    {kioskLabel} <span className="text-[10px] text-[#8e8d99]">▾</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[250px] rounded-[14px] border-[#e3dfd6] bg-white p-1.5 shadow-[0_18px_44px_rgba(0,0,0,.24)]">
                  {canSeeAllKiosks && (
                    <DropdownMenuItem className={cn(MENU_ITEM, 'justify-between')} onSelect={() => setSelectedKioskId('all')}>
                      <span>Todos os quiosques</span><span className="text-[#a6325b]">{selectedKioskId === 'all' ? '✓' : ''}</span>
                    </DropdownMenuItem>
                  )}
                  {sortedKiosks.map(k => (
                    <DropdownMenuItem key={k.id} className={cn(MENU_ITEM, 'justify-between')} onSelect={() => setSelectedKioskId(k.id)}>
                      <span>{k.name}</span><span className="text-[#a6325b]">{selectedKioskId === k.id ? '✓' : ''}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={DARK_CONTROL}>Ações ▾</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px] rounded-[14px] border-[#e3dfd6] bg-white p-1.5 shadow-[0_18px_44px_rgba(0,0,0,.24)]">
                  {onOpenWriteDown && <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenWriteDown}>Realizar baixa</DropdownMenuItem>}
                  {onOpenTransfer && <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenTransfer}>Realizar transferência</DropdownMenuItem>}
                  {(onOpenWriteDown || onOpenTransfer) && <DropdownMenuSeparator className="mx-1.5 my-1 bg-[#efece6]" />}
                  {onOpenHistory && <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenHistory}>Consultar histórico</DropdownMenuItem>}
                  {onOpenConsumption && <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenConsumption}>Consumo por período</DropdownMenuItem>}
                  {onOpenLabels && <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenLabels}>Configurar etiquetas</DropdownMenuItem>}
                  {(onOpenHistory || onOpenConsumption || onOpenLabels) && <DropdownMenuSeparator className="mx-1.5 my-1 bg-[#efece6]" />}
                  <DropdownMenuItem className={MENU_ITEM} onSelect={handleExportPdf}>Exportar como PDF</DropdownMenuItem>
                  <DropdownMenuItem className={MENU_ITEM} disabled={groupedData.length === 0} onSelect={handleExportCsv}>Exportar como CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                onClick={handleAddClick}
                disabled={!permissions.stock.inventoryControl.addLot}
                className="h-12 whitespace-nowrap rounded-[14px] bg-[#e0457f] px-[22px] text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(224,69,127,.35)] hover:bg-[#c93a6f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Adicionar lote
              </button>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {categoryChips.map(chip => {
                const on = selectedOperationalCategoryId === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setSelectedOperationalCategoryId(chip.id)}
                    className={cn(
                      'inline-flex h-[34px] cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-bold',
                      on ? 'border-[#e0457f] bg-[#e0457f] text-white' : 'border-white/10 bg-transparent text-[#c8c7d0] hover:bg-white/5',
                    )}
                  >
                    {chip.name}
                    <span className={cn('text-[11.5px] font-extrabold', on ? 'text-white/85' : 'text-[#8e8d99]')}>{chip.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1520px] flex-1 px-4 pb-24 pt-5 sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[28px] font-extrabold tracking-[-.03em]">{shownLots}</span>
                <span className="text-[13px] text-[#70757d]">lotes em {shownProducts} insumos</span>
                {activeFilterPills.map(pill => (
                  <button
                    key={pill.label}
                    type="button"
                    onClick={pill.clear}
                    className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-[#e3dfd6] bg-white px-2.5 text-xs font-bold"
                  >
                    {pill.label} <span className="text-[#9a9ba1]">×</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-0.5 rounded-[11px] bg-[#e6e3dc] p-[3px]">
                {(['cards', 'table'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setInventoryViewMode(mode)}
                    className={cn(
                      'h-8 rounded-[9px] px-3.5 text-[13px] font-bold',
                      inventoryViewMode === mode ? 'bg-white text-[#1a1b1f] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d]',
                    )}
                  >
                    {mode === 'cards' ? 'Cards' : 'Tabela'}
                  </button>
                ))}
              </div>
            </div>

            {reservationBanner && (
              <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-[#d7e2fb] bg-[#eef3fe] px-[18px] py-3.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#1d4ed8]" />
                <span className="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <b className="text-[13.5px] text-[#1e3a8a]">Reservas ativas em {kioskLabel}</b>
                  <span className="text-[12.5px] text-[#1e40af]">{reservationBanner.activityCount} atividade(s) aguardando movimentação.</span>
                </span>
                <button
                  type="button"
                  onClick={() => setStatusFilters(current => current.includes('reserved') ? current : [...current, 'reserved'])}
                  className="h-[34px] whitespace-nowrap rounded-[10px] border border-[#c7d6f8] bg-white px-3.5 text-[12.5px] font-bold text-[#1d4ed8]"
                >
                  Ver lotes reservados
                </button>
                <Link href="/dashboard/stock/analysis" className="whitespace-nowrap text-[12.5px] font-bold text-[#1d4ed8]">
                  Abrir reposição →
                </Link>
              </div>
            )}

            {renderContent()}
          </div>
        </div>
      </div>

      {selectedLot && (
        <LotDetailPanel
          lot={selectedLot.lot}
          product={selectedLot.product}
          fullName={getProductFullName(selectedLot.product)}
          kioskName={kiosks.find(k => k.id === selectedLot.lot.kioskId)?.name || 'Quiosque desconhecido'}
          locationName={selectedLot.lot.locationId ? locations.find(l => l.id === selectedLot.lot.locationId)?.name : null}
          reservation={reservationsByLot.get(selectedLot.lot.id)}
          onClose={() => setSelectedLotId(null)}
          onEdit={handleEditClick}
          onMove={handleMoveClick}
          onDelete={forceDeleteLotById}
        />
      )}

      <AddEditLotModal
        open={isAddEditModalOpen}
        onOpenChange={setIsAddEditModalOpen}
        lotToEdit={lotToEdit}
        kiosks={kiosks}
        addLot={addLot}
        updateLot={updateLot}
        lots={lots}
      />

      {lotToMove && (
        <MoveStockModal
            open={isMoveModalOpen}
            onOpenChange={setIsMoveModalOpen}
            lotToMove={lotToMove}
            kiosks={kiosks}
            onMoveConfirm={moveMultipleLots}
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

export function ExpiryControl(props: ExpiryControlProps) {
    return (
        <Suspense fallback={<Skeleton className="h-[90vh] w-full" />}>
            <ExpiryControlContent {...props} />
        </Suspense>
    );
}
