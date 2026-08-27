"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from 'next/dynamic';
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { type ProductSimulation, type PricingParameters, type SimulationCategory, type Kiosk } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import {
    PlusCircle,
    Inbox,
    Search,
    Eraser,
    Settings,
    Layers,
    Edit,
    CheckCircle2,
    AlertTriangle,
    History,
    ArrowUpDown,
    ChevronsUpDown,
    Check,
    Filter,
    Download,
    FileText,
    Eye,
    MoreHorizontal,
    Trash2,
    Warehouse,
    LayoutDashboard,
    ClipboardList,
    Package,
    Building2,
    Activity,
    CircleMinus,
    TrendingDown,
    X
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type ProductSimulationItem } from '@/types';
import { Skeleton } from "./ui/skeleton";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { useBaseProducts } from "@/hooks/use-base-products";
import { PricingParametersModal } from "./pricing-parameters-modal";
import { useAuth } from "@/hooks/use-auth";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { PriceHistoryModal } from "./price-history-modal";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { BatchEditSimulationModal } from "./batch-edit-simulation-modal";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { useKiosks } from "@/hooks/use-kiosks";
import { useChannels } from "@/hooks/use-channels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { convertValue } from "@/lib/conversion";
import { calculateSimulationMetrics } from "@/lib/pricing-context";
import { comparePricingSkus } from "@/lib/pricing-sort";
import {
    calculateGrossMargin,
    calculatePriceSpread,
    getCmvPercentage,
    getPricingCommercialStatus,
    hasAbnormalCmv,
    type PricingCommercialStatus,
} from "@/lib/pricing-insights";
import { FichaTecnicaDocument } from './pdf/FichaTecnicaDocument';
import type { BlobProviderParams } from '@react-pdf/renderer';
import { GerencialReportDocument } from './pdf/GerencialReportDocument';
import { useToast } from "@/hooks/use-toast";
import { ProductModal } from "./product-modal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { PricingHistoryAnalysis } from "./pricing-history-analysis";
import { BackButton } from "@/components/navigation/back-button";
import {
    canCreateTechnicalSheets,
    canDeleteTechnicalSheets,
    canEditTechnicalSheets,
    canExportTechnicalSheets,
} from "@/lib/commercial-permissions";


const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
);


interface KioskManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation;
  kiosks: Kiosk[];
  onSave: (kioskIds: string[]) => Promise<void>;
}

function KioskManagementDialog({ open, onOpenChange, simulation, kiosks, onSave }: KioskManagementDialogProps) {
  const initialIds = (simulation.kioskIds ?? []).length ? simulation.kioskIds ?? [] : kiosks.map((kiosk) => kiosk.id);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) setSelectedIds((simulation.kioskIds ?? []).length ? simulation.kioskIds ?? [] : kiosks.map((kiosk) => kiosk.id));
  }, [kiosks, open, simulation.kioskIds]);

  const toggle = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const persistedIds = (simulation.kioskIds ?? []).length ? simulation.kioskIds ?? [] : kiosks.map((kiosk) => kiosk.id);
  const hasChanged = JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...persistedIds].sort());

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(selectedIds.length === kiosks.length ? [] : selectedIds);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden rounded-[20px] p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-lg font-black">Gerenciar unidades</DialogTitle>
          <DialogDescription className="truncate">{simulation.name} · {selectedIds.length === kiosks.length ? 'ativa em todas as unidades' : `ativa em ${selectedIds.length} de ${kiosks.length} unidades`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-6 py-4">
          {selectedIds.length === 0 && (
            <p className="mb-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
              Selecione pelo menos uma unidade para manter a mercadoria disponível.
            </p>
          )}
          {kiosks.map(kiosk => (
            <div key={kiosk.id} className={cn("flex items-center justify-between rounded-xl border px-4 py-3 transition-colors", selectedIds.includes(kiosk.id) ? 'border-pink-200 bg-pink-50/60' : 'border-slate-200 bg-white')}>
              <label htmlFor={`kiosk-${kiosk.id}`} className="text-sm font-medium cursor-pointer flex-1">{kiosk.name}</label>
              <Switch
                id={`kiosk-${kiosk.id}`}
                checked={selectedIds.includes(kiosk.id)}
                onCheckedChange={() => toggle(kiosk.id)}
              />
            </div>
          ))}
        </div>
        <DialogFooter className="border-t bg-[#faf9f6] px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="bg-pink-600 hover:bg-pink-700" onClick={handleSave} disabled={!hasChanged || isSaving || selectedIds.length === 0}>
            {isSaving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name' | 'sku' | 'salePrice' | 'totalCmv' | 'profitGoal' | 'profitPercentage' | 'markup' | 'grossVal' | 'grossPct';
type SortDirection = 'asc' | 'desc';
type CommercialAlert = 'loss' | 'below' | 'cmv';

function normalizeUnitName(name: string) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function isCommercialSalesUnit(kiosk: Kiosk) {
    const normalized = normalizeUnitName(kiosk.name);
    return !normalized.includes('matriz') && !normalized.includes('centro de distribuicao');
}

function isSimulationAvailableInUnit(simulation: ProductSimulation, unitId: string) {
    const unitIds = simulation.kioskIds ?? [];
    return unitIds.length === 0 || unitIds.includes(unitId);
}


export function PricingSimulator({ pageHeader = false }: { pageHeader?: boolean }) {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation, bulkUpdateSimulations, priceHistory, updateSimulation, resolveSimulationPrice } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();
    const { pricingParameters, loading: loadingParams } = useCompanySettings();
    const { permissions } = useAuth();
    const canCreateSheet = canCreateTechnicalSheets(permissions);
    const canEditSheet = canEditTechnicalSheets(permissions);
    const canDeleteSheet = canDeleteTechnicalSheets(permissions);
    const canExportSheet = canExportTechnicalSheets(permissions);
    const { kiosks, loading: kiosksLoading } = useKiosks();
    const { channels } = useChannels();
    const { toast } = useToast();
    
    const [selectedSimulations, setSelectedSimulations] = useState<Set<string>>(new Set());
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [initialTab, setInitialTab] = useState<'cost' | 'ficha' | 'instruction'>('cost');
    const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [activeMainTab, setActiveMainTab] = useState<string>("inventory");
    const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToDeactivate, setSimulationToDeactivate] = useState<ProductSimulation | null>(null);
    const [simToDeleteFirst, setSimToDeleteFirst] = useState<ProductSimulation | null>(null);
    const [simToDeleteFinal, setSimToDeleteFinal] = useState<ProductSimulation | null>(null);
    const [simToManageKiosks, setSimToManageKiosks] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'grossPct', direction: 'asc' });
    const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
    const [lineFilters, setLineFilters] = useState<Set<string>>(new Set());
    const [groupFilters, setGroupFilters] = useState<Set<string>>(new Set());
    const [contextUnitId, setContextUnitId] = useState<string>("all");
    const [contextChannelId, setContextChannelId] = useState<string>("all");
    const [commercialAlert, setCommercialAlert] = useState<CommercialAlert | null>(null);

    const [statusFilter, setStatusFilter] = useState<Set<'sem_meta' | 'na_meta' | 'abaixo'>>(new Set());
    const ALL_COLS = useMemo(() => [
        { id: 'price', label: 'Preço', tip: 'Preço de venda ao cliente final.' },
        { id: 'cmv', label: 'CMV', tip: 'Custo da Mercadoria Vendida — soma dos insumos.' },
        { id: 'grossPct', label: 'M. Bruta %', tip: 'Margem bruta percentual.' },
        { id: 'grossVal', label: 'M. Bruta R$', tip: 'Preço menos CMV.' },
        { id: 'contribPct', label: 'M. Contrib %', tip: 'Margem após impostos e taxas.' },
        { id: 'markup', label: 'Markup', tip: 'Preço dividido pelo CMV.' },
        { id: 'goal', label: 'Meta M.B.', tip: 'Meta de margem bruta.' },
    ], []);
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(['price', 'cmv', 'grossPct', 'goal']));
    const toggleColumn = (id: string) => setVisibleColumns((current) => {
        const next = new Set(current);
        if (next.has(id) && next.size > 1) next.delete(id);
        else next.add(id);
        return next;
    });


    const handleAddNew = () => {
        setSimulationToEdit(null);
        setInitialTab('cost');
        setIsProductModalOpen(true);
    };

    const handleEdit = (simulation: ProductSimulation, tab: 'cost' | 'ficha' | 'instruction' = 'cost') => {
        setSimulationToEdit(simulation);
        setInitialTab(tab);
        setIsProductModalOpen(true);
    };

    const handlePpoClick = (simulation: ProductSimulation) => {
        handleEdit(simulation, 'ficha');
    };
    
    const handleViewTechnicalSheet = (simulation: ProductSimulation) => {
        handleEdit(simulation, 'instruction');
    };

    const handleDelete = (sim: ProductSimulation) => {
        setSimToDeleteFirst(sim);
    };

    const handleConfirmDeleteFirst = () => {
        if (!simToDeleteFirst) return;
        setSimToDeleteFinal(simToDeleteFirst);
        setSimToDeleteFirst(null);
    };

    const handleConfirmDeleteFinal = async () => {
        if (!simToDeleteFinal) return;
        await deleteSimulation(simToDeleteFinal.id);
        setSimToDeleteFinal(null);
        setIsProductModalOpen(false);
        setSimulationToEdit(null);
    };

    const baseProductMap = useMemo(() => {
        const map = new Map<string, { name: string, unit: string, isArchived?: boolean }>();
        baseProducts.forEach(bp => {
            map.set(bp.id, { name: bp.name, unit: bp.unit, isArchived: bp.isArchived });
        });
        return map;
    }, [baseProducts]);

    const archivedBaseProductIds = useMemo(() => {
        return new Set(baseProducts.filter(bp => bp.isArchived).map(bp => bp.id));
    }, [baseProducts]);

    const simHasArchivedBase = useMemo(() => {
        const map = new Map<string, boolean>();
        simulations.forEach(sim => {
            const hasArchived = simulationItems
                .filter(i => i.simulationId === sim.id)
                .some(i => archivedBaseProductIds.has(i.baseProductId));
            map.set(sim.id, hasArchived);
        });
        return map;
    }, [simulations, simulationItems, archivedBaseProductIds]);

    const handleToggleSimulationActive = async (sim: ProductSimulation, activate: boolean) => {
        if (!activate) {
            setSimulationToDeactivate(sim);
            return;
        }
        await updateSimulation({ id: sim.id, isArchived: false });
    };

    const handleConfirmDeactivate = async () => {
        if (!simulationToDeactivate) return;
        await updateSimulation({ id: simulationToDeactivate.id, isArchived: true });
        setSimulationToDeactivate(null);
    };

    const handleSaveKioskManagement = async (kioskIds: string[]) => {
        if (!simToManageKiosks) return;
        await updateSimulation({ id: simToManageKiosks.id, kioskIds });
        toast({ title: "Unidades atualizadas com sucesso." });
        setSimToManageKiosks(null);
    };
    
    const categoryMap = useMemo(() => {
        return new Map(categories.map(c => [c.id, c]));
    }, [categories]);

    const activeChannels = useMemo(() => channels.filter(channel => channel.active), [channels]);
    const commercialKiosks = useMemo(
        () => kiosks.filter(isCommercialSalesUnit).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        [kiosks]
    );
    const unitNavigationCards = useMemo(
        () => [
            {
                id: 'all',
                name: 'Todas as mercadorias',
                count: simulations.filter((simulation) => !simulation.isArchived).length,
            },
            ...commercialKiosks.map((kiosk) => ({
                id: kiosk.id,
                name: kiosk.name,
                count: simulations.filter(
                    (simulation) => !simulation.isArchived && isSimulationAvailableInUnit(simulation, kiosk.id)
                ).length,
            })),
        ],
        [commercialKiosks, simulations]
    );
    const simulationById = useMemo(
        () => new Map(simulations.map((simulation) => [simulation.id, simulation])),
        [simulations]
    );
    const pricingInsights = useMemo(() => {
        const unitId = contextUnitId === 'all' ? null : contextUnitId;
        const comparisonChannels = activeChannels.filter((channel) => channel.type !== 'balcao');

        return new Map(simulations.map((simulation) => {
            const counterResolution = resolveSimulationPrice(simulation, unitId, null);
            const basePrice = counterResolution.available ? counterResolution.price ?? 0 : 0;
            const channelRows = [
                { id: 'balcao', name: 'Balcão', price: counterResolution.price, available: counterResolution.available },
                ...comparisonChannels.map((channel) => {
                    const resolution = resolveSimulationPrice(simulation, unitId, channel.id);
                    return { id: channel.id, name: channel.name, price: resolution.price, available: resolution.available };
                }),
            ].map((channel) => {
                const price = channel.available ? channel.price ?? 0 : 0;
                const margin = calculateGrossMargin(price, simulation.totalCmv || 0).percentage;
                return { ...channel, price, margin };
            });
            const availablePrices = channelRows.filter((channel) => channel.available).map((channel) => channel.price);
            const bestMargin = Math.max(...channelRows.filter((channel) => channel.available).map((channel) => channel.margin), Number.NEGATIVE_INFINITY);

            return [simulation.id, {
                basePrice,
                status: getPricingCommercialStatus(basePrice, simulation.totalCmv || 0, simulation.profitGoal),
                cmvPercentage: getCmvPercentage(basePrice, simulation.totalCmv || 0),
                abnormalCmv: hasAbnormalCmv(basePrice, simulation.totalCmv || 0),
                spread: calculatePriceSpread(availablePrices),
                channelRows: channelRows.map((channel) => ({ ...channel, isBest: channel.available && channel.margin === bestMargin })),
            }];
        }));
    }, [activeChannels, contextUnitId, resolveSimulationPrice, simulations]);

    const commercialAlertCounts = useMemo(() => {
        const available = simulations.filter((simulation) =>
            !simulation.isArchived
            && (contextUnitId === 'all' || isSimulationAvailableInUnit(simulation, contextUnitId))
        );
        return {
            loss: available.filter((simulation) => pricingInsights.get(simulation.id)?.status === 'loss').length,
            below: available.filter((simulation) => pricingInsights.get(simulation.id)?.status === 'below').length,
            cmv: available.filter((simulation) => pricingInsights.get(simulation.id)?.abnormalCmv).length,
        };
    }, [contextUnitId, pricingInsights, simulations]);

    const contextualSimulations = useMemo(() => {
        if (contextUnitId === 'all' && contextChannelId === 'all') {
            return simulations;
        }

        return simulations.map((simulation) => {
            const resolved = resolveSimulationPrice(
                simulation,
                contextUnitId === 'all' ? null : contextUnitId,
                contextChannelId === 'all' ? null : contextChannelId
            );
            const metrics = calculateSimulationMetrics(
                resolved.price ?? 0,
                simulation.totalCmv || 0,
                pricingParameters?.averageTaxPercentage || 0,
                pricingParameters?.averageCardFeePercentage || 0
            );

            return {
                ...simulation,
                salePrice: resolved.price ?? 0,
                profitValue: metrics.profitValue,
                profitPercentage: metrics.profitPercentage,
                markup: metrics.markup,
                contextAvailable: resolved.available,
                contextSource: resolved.source,
            };
        });
    }, [contextUnitId, contextChannelId, simulations, resolveSimulationPrice, pricingParameters]);

    const { filteredSimulations, archivedSimulations } = useMemo(() => {
        const filterFn = (sim: ProductSimulation) => {
            const searchMatch = searchTerm ? (sim.name.toLowerCase().includes(searchTerm.toLowerCase()) || (sim.ppo?.sku || '').toLowerCase().includes(searchTerm.toLowerCase())) : true;
            const categoryMatch = categoryFilters.size === 0 || (sim.categoryIds || []).some(catId => categoryFilters.has(catId));
            const lineMatch = lineFilters.size === 0 || (sim.lineId && lineFilters.has(sim.lineId));
            const groupMatch = groupFilters.size === 0 || (sim.groupIds || []).some(groupId => groupFilters.has(groupId));
            const kioskMatch = contextUnitId === 'all' || isSimulationAvailableInUnit(sim, contextUnitId);
            const insight = pricingInsights.get(sim.id);
            const alertMatch = !commercialAlert
                || (commercialAlert === 'cmv' ? Boolean(insight?.abnormalCmv) : insight?.status === commercialAlert);

            let statusMatch = true;
            if (statusFilter.size > 0) {
                let simStatus: 'sem_meta' | 'na_meta' | 'abaixo' = 'sem_meta';
                if (insight?.status === 'met') simStatus = 'na_meta';
                if (insight?.status === 'below' || insight?.status === 'loss') simStatus = 'abaixo';
                statusMatch = statusFilter.has(simStatus);
            }

            return searchMatch && categoryMatch && lineMatch && groupMatch && kioskMatch && alertMatch && statusMatch;
        };

        const sortFn = (a: ProductSimulation, b: ProductSimulation) => {
            let aValue: any;
            let bValue: any;

            if (sortConfig.key === 'sku') {
                aValue = a.ppo?.sku || '';
                bValue = b.ppo?.sku || '';

                return comparePricingSkus(aValue, bValue, sortConfig.direction);
            } else if (sortConfig.key === 'grossVal') {
                aValue = a.salePrice - a.totalCmv;
                bValue = b.salePrice - b.totalCmv;
            } else if (sortConfig.key === 'grossPct') {
                aValue = a.salePrice > 0 ? ((a.salePrice - a.totalCmv) / a.salePrice) * 100 : 0;
                bValue = b.salePrice > 0 ? ((b.salePrice - b.totalCmv) / b.salePrice) * 100 : 0;
            } else {
                aValue = a[sortConfig.key as keyof ProductSimulation];
                bValue = b[sortConfig.key as keyof ProductSimulation];
            }

            if (aValue === undefined || aValue === null) return 1;
            if (bValue === undefined || bValue === null) return -1;

            let comparison = 0;
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                comparison = aValue.localeCompare(bValue, undefined, { numeric: true });
            } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                comparison = aValue - bValue;
            }

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        };

        const active = contextualSimulations.filter(s => !s.isArchived && filterFn(s)).sort(sortFn);
        const archived = contextualSimulations.filter(s => s.isArchived && filterFn(s)).sort(sortFn);
        return { filteredSimulations: active, archivedSimulations: archived };

    }, [commercialAlert, contextualSimulations, searchTerm, categoryFilters, lineFilters, groupFilters, pricingInsights, sortConfig, contextUnitId, statusFilter]);

    const handleSort = (key: SortKey) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleSortSelection = (value: string) => {
        const separator = value.lastIndexOf('-');
        setSortConfig({
            key: value.slice(0, separator) as SortKey,
            direction: value.slice(separator + 1) as SortDirection,
        });
    };
    const currentSortLabel = ({
        'grossPct-asc': 'Pior margem primeiro',
        'grossPct-desc': 'Melhor margem primeiro',
        'name-asc': 'Nome (A–Z)',
        'name-desc': 'Nome (Z–A)',
        'salePrice-desc': 'Maior preço',
        'salePrice-asc': 'Menor preço',
        'totalCmv-desc': 'Maior CMV',
        'totalCmv-asc': 'Menor CMV',
    } as Record<string, string>)[`${sortConfig.key}-${sortConfig.direction}`] ?? 'Ordenação personalizada';

    const getProfitColorClass = (percentage: number) => {
        if (!pricingParameters?.profitRanges) return 'text-primary';
        const sortedRanges = [...pricingParameters.profitRanges].sort((a, b) => a.from - b.from);
        
        for (const range of sortedRanges) {
            if (percentage >= range.from && (range.to === Infinity || percentage < range.to)) {
                return range.color;
            }
        }
        
        return 'text-primary'; 
    };

    const handleExportFichaTecnicaSimplificadaPdf = () => {
        toast({
            title: "Exportação em manutenção",
            description: "A função de exportar para PDF está sendo atualizada. Tente a exportação para CSV.",
            variant: "destructive",
        });
    };

    const handleExportFichaTecnicaSimplificadaCsv = () => {
        const dataForCsv = filteredSimulations.flatMap(sim => {
            const ingredients = simulationItems
                .filter(item => item.simulationId === sim.id)
                .map(item => {
                    const bp = baseProductMap.get(item.baseProductId);
                    return `${bp ? bp.name : 'N/A'}: ${item.quantity} ${item.overrideUnit || bp?.unit || ''}`;
                }).join(' | ');
            return {
                'Mercadoria': sim.name,
                'Ingredientes': ingredients,
            };
        });

        const csv = Papa.unparse(dataForCsv);
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", 'fichas_tecnicas_simplificadas.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleExportGerencialCsv = () => {
        const dataForCsv = filteredSimulations.map(sim => {
            const grossMarginValue = sim.salePrice - sim.totalCmv;
            const grossMarginPercentage = sim.salePrice > 0 ? (grossMarginValue / sim.salePrice) * 100 : 0;

            return {
                'Mercadoria': sim.name,
                'SKU': sim.ppo?.sku || '',
                'Preço Venda': sim.salePrice,
                'CMV': sim.totalCmv,
                'Margem Bruta (R$)': grossMarginValue,
                'Margem Bruta (%)': grossMarginPercentage,
                'Margem Contrib. %': sim.profitPercentage,
                'Markup': sim.markup,
                'Meta margem bruta %': sim.profitGoal || '',
                'NCM': sim.ppo?.ncm || '',
                'CEST': sim.ppo?.cest || '',
                'CFOP': sim.ppo?.cfop || '',
            };
        });

        const csv = Papa.unparse(dataForCsv);
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `relatorio_gerencial_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const handleExportXlsx = () => {
        const dataForSheet = filteredSimulations.map(sim => {
            const grossMarginValue = sim.salePrice - sim.totalCmv;
            const grossMarginPercentage = sim.salePrice > 0 ? (grossMarginValue / sim.salePrice) * 100 : 0;

            return {
                'Mercadoria': sim.name,
                'SKU': sim.ppo?.sku || '',
                'Preço Venda': sim.salePrice,
                'CMV': sim.totalCmv,
                'Margem Bruta (R$)': grossMarginValue,
                'Margem Bruta (%)': grossMarginPercentage,
                'M. Contrib (R$)': sim.profitValue,
                'M Contrib (%)': sim.profitPercentage,
                'Markup': sim.markup,
                'Meta margem bruta %': sim.profitGoal || '',
                'NCM': sim.ppo?.ncm || '',
                'CEST': sim.ppo?.cest || '',
                'CFOP': sim.ppo?.cfop || '',
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Relatório Gerencial");

        for (const cellAddress in worksheet) {
            if (cellAddress[0] === '!') continue;
            const col = cellAddress.replace(/[0-9]/g, '');
            const row = parseInt(cellAddress.replace(/[A-Z]/g, ''));
            if (row > 1) { 
                if (['C', 'D', 'E', 'G'].includes(col)) {
                    worksheet[cellAddress].z = 'R$ #,##0.00';
                }
                if (['F', 'H', 'J'].includes(col)) { 
                     worksheet[cellAddress].t = 'n';
                     worksheet[cellAddress].v = worksheet[cellAddress].v / 100;
                     worksheet[cellAddress].z = '0.00%';
                }
                 if (['I'].includes(col)) {
                    worksheet[cellAddress].z = '0.00"x"';
                }
            }
        }


        XLSX.writeFile(workbook, `relatorio_gerencial_${new Date().toISOString().slice(0,10)}.xlsx`);
    };

    const handleExportPriceListPdf = () => {
        toast({
            title: "Exportação em manutenção",
            description: "A função de exportar para PDF está sendo atualizada. Tente a exportação para CSV.",
            variant: "destructive",
        })
    };

    const handleExportPriceListCsv = () => {
        const dataForCsv = filteredSimulations.map(sim => ({
            'Mercadoria': sim.name,
            'Preço de Venda': sim.salePrice,
            'Margem Contrib. %': sim.profitPercentage.toFixed(2) + '%'
        }));

        const csv = Papa.unparse(dataForCsv, {
            quotes: true,
            delimiter: ';',
            header: true,
            newline: '\r\n'
        });
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `lista_de_precos_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const isLoading = loadingSimulations || loadingBaseProducts || loadingCategories || loadingParams || kiosksLoading;
    
    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const groups = useMemo(() => categories.filter(c => c.type === 'group'), [categories]);
    const totalActiveFilters = categoryFilters.size + lineFilters.size + groupFilters.size + statusFilter.size + (commercialAlert ? 1 : 0);
    const toolbarFilterCount = totalActiveFilters + (contextUnitId === 'all' ? 0 : 1) + (contextChannelId === 'all' ? 0 : 1);
    
    const handleFilterChange = (id: string, type: 'category' | 'line' | 'group' | 'status') => {
        if (type === 'status') {
            setStatusFilter(prev => {
                const newSet = new Set(prev);
                if (newSet.has(id as any)) newSet.delete(id as any);
                else newSet.add(id as any);
                return newSet;
            });
            return;
        }
        
        const setter = type === 'category' ? setCategoryFilters : type === 'line' ? setLineFilters : setGroupFilters;
        setter(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const clearFilters = () => {
        setCategoryFilters(new Set());
        setLineFilters(new Set());
        setGroupFilters(new Set());
        setStatusFilter(new Set());
        setSearchTerm('');
        setCommercialAlert(null);
    };

    const handleUnitContextChange = (unitId: string) => {
        setContextUnitId(unitId);
        setSelectedSimulations(new Set());
    };
    
    const handleSelectionChange = (id: string, isSelected: boolean) => {
        setSelectedSimulations(prev => {
            const newSet = new Set(prev);
            if (isSelected) newSet.add(id);
            else newSet.delete(id);
            return newSet;
        });
    };

    const handleSelectAllChange = (isSelected: boolean) => {
        setSelectedSimulations(isSelected ? new Set(filteredSimulations.map(p => p.id)) : new Set());
    };

    const allFilteredSelected = filteredSimulations.length > 0 && filteredSimulations.every(p => selectedSimulations.has(p.id));

    const singleFilteredSimulation = useMemo(() => {
        return filteredSimulations.length === 1 ? filteredSimulations[0] : null;
    }, [filteredSimulations]);

    const pdfDataForSingleSim = useMemo(() => {
        if (!singleFilteredSimulation) return null;

        const ingredients = simulationItems
            .filter(item => item.simulationId === singleFilteredSimulation.id)
            .map(item => {
                const bp = baseProductMap.get(item.baseProductId);
                return {
                    name: bp ? bp.name : 'Insumo não encontrado',
                    quantity: item.quantity,
                    unit: item.overrideUnit || (bp ? bp.unit : '')
                };
            });

        return {
            name: singleFilteredSimulation.name,
            ppo: singleFilteredSimulation.ppo,
            salePrice: singleFilteredSimulation.salePrice,
            grossCost: singleFilteredSimulation.totalCmv,
            profitPercentage: singleFilteredSimulation.profitPercentage,
            markup: singleFilteredSimulation.markup,
            ingredients: ingredients
        };
    }, [singleFilteredSimulation, simulationItems, baseProductMap]);


    const renderTable = () => {
        if (isLoading) {
            return (
                <div className="space-y-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                </div>
            );
        }

        const activeCount = simulations.filter(s => !s.isArchived).length;
        if (activeCount === 0 && archivedSimulations.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise criada</h3>
                    <p className="mt-1 text-sm">Clique no botão "Nova mercadoria" para começar.</p>
                </div>
            );
        }

        if (filteredSimulations.length === 0 && archivedSimulations.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhum resultado encontrado</h3>
                    <p className="mt-1 text-sm">Tente ajustar os filtros de busca.</p>
                </div>
            );
        }
        
        return (
            <div className="space-y-2">
                 <div className="flex items-center gap-4 px-2 py-2 border-y">
                    <Checkbox id="select-all" checked={allFilteredSelected} onCheckedChange={handleSelectAllChange} />
                    <Label htmlFor="select-all" className="text-sm font-medium">Selecionar todos ({filteredSimulations.length})</Label>
                </div>
                
                <Accordion type="multiple" className="space-y-2">
                    {filteredSimulations.map(sim => {
                        const simCategories = (sim.categoryIds || []).map(id => categoryMap.get(id)).filter((c): c is SimulationCategory => !!c);
                        const line = sim.lineId ? categoryMap.get(sim.lineId) : null;
                        const simGroups = (sim.groupIds || []).map(id => categories.find(c => c.id === id && c.type === 'group')).filter(Boolean) as SimulationCategory[];
                        
                        const grossMarginValue = sim.salePrice - sim.totalCmv;
                        const grossMarginPercentage = sim.salePrice > 0 ? (grossMarginValue / sim.salePrice) * 100 : 0;

                        const meetsGoal = sim.profitGoal !== undefined && sim.profitGoal !== null && grossMarginPercentage >= sim.profitGoal;
                        const profitColorClass = getProfitColorClass(grossMarginPercentage);
                        const hasArchivedBase = simHasArchivedBase.get(sim.id) ?? false;

                        let statusInfo = { label: 'Sem meta', color: 'gray', border: 'border-l-[4px] border-l-gray-300' };
                        if (sim.profitGoal !== null && sim.profitGoal !== undefined) {
                            statusInfo = meetsGoal
                                ? { label: 'Na meta', color: 'green', border: 'border-l-[4px] border-l-green-600' }
                                : { label: 'Abaixo', color: 'orange', border: 'border-l-[4px] border-l-orange-500' };
                        }

                        return (
                             <AccordionItem value={sim.id} key={sim.id} className="border-b-0">
                                <Card className={cn("overflow-hidden group transition-all", statusInfo.border)}>
                                <div className="flex items-center p-2 pr-4 bg-muted/30">
                                    <Checkbox className="mx-2" checked={selectedSimulations.has(sim.id)} onCheckedChange={(checked) => handleSelectionChange(sim.id, !!checked)} />
                                    <div className="flex-grow min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-semibold truncate">{sim.name}</p>
                                            <Badge variant={statusInfo.color === 'green' ? 'default' : statusInfo.color === 'orange' ? 'secondary' : 'outline'} className={cn(
                                                "text-[10px] h-4 px-1.5",
                                                statusInfo.color === 'green' ? "bg-green-100 text-green-700 hover:bg-green-100 border-green-200" :
                                                statusInfo.color === 'orange' ? "bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200" :
                                                ""
                                            )}>
                                                {statusInfo.label}
                                            </Badge>
                                            {hasArchivedBase && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-1 cursor-default">
                                                                <AlertTriangle className="h-2.5 w-2.5" />
                                                                Insumo inativo
                                                            </Badge>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Um ou mais insumos base desta mercadoria estão desativados. Revise a composição.
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                            {sim.kioskIds && sim.kioskIds.length > 0 && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1 cursor-default text-gray-500 border-gray-200">
                                                                <Building2 className="h-2.5 w-2.5" />
                                                                {sim.kioskIds.length}
                                                            </Badge>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p className="text-xs">{sim.kioskIds.length} unidade{sim.kioskIds.length !== 1 ? 's' : ''} ativa{sim.kioskIds.length !== 1 ? 's' : ''}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground font-mono">SKU: {sim.ppo?.sku || 'N/A'}</p>
                                    </div>
                                    <div className="flex items-center gap-1 overflow-hidden">
                                        {line && (
                                            <Badge variant="outline" className="text-[10px] truncate" style={{ borderColor: line.color, color: line.color }}>
                                                {line.name}
                                            </Badge>
                                        )}
                                        {simCategories.slice(0, 1).map(cat => (
                                            <Badge key={cat.id} variant="secondary" className="text-[10px] truncate" style={{ backgroundColor: cat.color, color: 'white' }}>{cat.name}</Badge>
                                        ))}
                                    </div>
                                    <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2" />
                                </div>
                                <div className="flex items-center justify-between px-4 py-3">
                                    <div className="flex-1 flex justify-around gap-2 overflow-x-auto">
                                        <TooltipProvider>
                                            {ALL_COLS.filter(c => visibleColumns.has(c.id)).map(col => (
                                                <Tooltip key={col.id}>
                                                    <TooltipTrigger asChild>
                                                        <div className="text-center min-w-[60px] cursor-help">
                                                            <p className="text-[10px] text-muted-foreground underline decoration-dotted decoration-muted-foreground/30">{col.label}</p>
                                                            <div className="text-sm">
                                                                {col.id === 'price' && <p className="font-bold">{formatCurrency(sim.salePrice)}</p>}
                                                                {col.id === 'cmv' && <p className="font-medium text-gray-600">{formatCurrency(sim.totalCmv)}</p>}
                                                                {col.id === 'grossPct' && <p className={cn("font-bold", profitColorClass)}>{grossMarginPercentage.toFixed(1)}%</p>}
                                                                {col.id === 'grossVal' && <p className={cn("font-bold", profitColorClass)}>{formatCurrency(grossMarginValue)}</p>}
                                                                {col.id === 'contribPct' && <p className="font-semibold">{sim.profitPercentage.toFixed(1)}%</p>}
                                                                {col.id === 'markup' && <p className="font-medium">{sim.markup.toFixed(2)}x</p>}
                                                                {col.id === 'goal' && <p className="font-medium text-muted-foreground">{sim.profitGoal ? `${sim.profitGoal}%` : '-'}</p>}
                                                            </div>
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="text-xs">{col.tip}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            ))}
                                        </TooltipProvider>
                                    </div>
                                    
                                    <div className="flex items-center gap-2">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground"><span className="sr-only">Abrir menu</span><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleToggleSimulationActive(sim, false)} className="text-orange-600 focus:text-orange-600"><CheckCircle2 className="mr-2 h-4 w-4" /> Desativar mercadoria</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setSimToManageKiosks(sim)}><Building2 className="mr-2 h-4 w-4" /> Gerenciar Unidades</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => handleViewTechnicalSheet(sim)}><Eye className="mr-2 h-4 w-4" /> Ficha Técnica de Instrução</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleEdit(sim, 'ficha')}><ClipboardList className="mr-2 h-4 w-4" /> Ficha Técnica Completa</DropdownMenuItem>
                                                {canEditSheet && (
                                                    <DropdownMenuItem onClick={() => handleEdit(sim, 'cost')}><LayoutDashboard className="mr-2 h-4 w-4" /> Editar Ficha</DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                {canDeleteSheet && (
                                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(sim)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                <AccordionContent>
                                    <div className="px-4 pb-4 bg-background border-t">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Insumo base</TableHead>
                                                    <TableHead>Quantidade</TableHead>
                                                    <TableHead className="text-right">Custo / unidade</TableHead>
                                                    <TableHead className="text-right">Impacto</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {simulationItems.filter(item => item.simulationId === sim.id).map(item => {
                                                    const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                                                    if (!baseProduct) return null;
                                                    
                                                    const costPerUnit = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
                                                    
                                                    let cost = 0;
                                                    try {
                                                        const valueInBase = item.useDefault 
                                                            ? 1
                                                            : convertValue(1, item.overrideUnit || baseProduct.unit, baseProduct.unit, baseProduct.category);
                                                        
                                                        const effectiveCostPerUnit = item.useDefault ? costPerUnit : (item.overrideCostPerUnit || 0) / valueInBase;
                                                        cost = item.quantity * effectiveCostPerUnit;

                                                    } catch (e) { console.error(e) }
                                                    
                                                    const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
                                                    
                                                    return (
                                                        <TableRow key={item.id}>
                                                            <TableCell>{baseProduct?.name || 'Insumo não encontrado'}</TableCell>
                                                            <TableCell>{item.quantity} {item.overrideUnit || baseProduct?.unit}</TableCell>
                                                            <TableCell className="text-right">{formatCurrency(costPerUnit)}</TableCell>
                                                            <TableCell className="text-right">{impact.toFixed(1)}%</TableCell>
                                                            <TableCell className="text-right font-semibold text-primary">{formatCurrency(cost)}</TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>

                                        {(() => {
                                            const simHistory = (priceHistory || []).filter((h: any) => h.simulationId === sim.id).sort((a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
                                            if (simHistory.length === 0) return null;
                                            return (
                                                <div className="mt-4">
                                                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Histórico de Alterações de Preço</p>
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead>Data</TableHead>
                                                                <TableHead className="text-right">Antes</TableHead>
                                                                <TableHead className="text-right">Depois</TableHead>
                                                                <TableHead className="text-right">Variação</TableHead>
                                                                <TableHead>Usuário</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {simHistory.map((entry: any) => {
                                                                const variation = entry.oldPrice > 0 ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100 : 0;
                                                                const isUp = variation > 0;
                                                                return (
                                                                    <TableRow key={entry.id}>
                                                                        <TableCell className="text-xs text-muted-foreground">
                                                                            {new Date(entry.changedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                                        </TableCell>
                                                                        <TableCell className="text-right font-mono text-xs">{formatCurrency(entry.oldPrice)}</TableCell>
                                                                        <TableCell className="text-right font-mono text-xs font-semibold">{formatCurrency(entry.newPrice)}</TableCell>
                                                                        <TableCell className={cn("text-right text-xs font-semibold", isUp ? "text-green-600" : "text-red-500")}>
                                                                            {isUp ? '+' : ''}{variation.toFixed(1)}%
                                                                        </TableCell>
                                                                        <TableCell className="text-xs text-muted-foreground">{entry.changedBy?.username || '-'}</TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </AccordionContent>
                                </Card>
                            </AccordionItem>
                        );
                    })
                }
            </Accordion>

            {archivedSimulations.length > 0 && (
                <div className="space-y-2 pt-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1">
                        Inativos ({archivedSimulations.length})
                    </p>
                    <div className="opacity-60">
                        <Accordion type="multiple" className="space-y-2">
                            {archivedSimulations.map(sim => {
                                const grossMarginValue = sim.salePrice - sim.totalCmv;
                                const grossMarginPercentage = sim.salePrice > 0 ? (grossMarginValue / sim.salePrice) * 100 : 0;
                                const profitColorClass = getProfitColorClass(grossMarginPercentage);
                                const hasArchivedBase = simHasArchivedBase.get(sim.id) ?? false;

                                return (
                                    <AccordionItem value={sim.id} key={sim.id} className="border-b-0">
                                        <Card className="overflow-hidden border-dashed border-l-[4px] border-l-gray-300">
                                            <div className="flex items-center p-2 pr-4 bg-muted/30">
                                                <div className="mx-2 w-4" />
                                                <div className="flex-grow min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="font-semibold truncate text-muted-foreground">{sim.name}</p>
                                                        {hasArchivedBase && (
                                                            <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-1">
                                                                <AlertTriangle className="h-2.5 w-2.5" />
                                                                Insumo inativo
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground font-mono">SKU: {sim.ppo?.sku || 'N/A'}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => handleToggleSimulationActive(sim, true)} className="text-green-700 focus:text-green-700 font-medium"><CheckCircle2 className="mr-2 h-4 w-4" /> Reativar mercadoria</DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            {canEditSheet && (
                                                                <DropdownMenuItem onClick={() => handleEdit(sim, 'cost')}><LayoutDashboard className="mr-2 h-4 w-4" /> Editar Ficha</DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuSeparator />
                                                            {canDeleteSheet && (
                                                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(sim)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                                <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2" />
                                            </div>
                                            <div className="flex items-center px-4 py-3">
                                                <div className="flex-1 flex justify-around gap-2 overflow-x-auto">
                                                    <TooltipProvider>
                                                        {ALL_COLS.filter(c => visibleColumns.has(c.id)).map(col => (
                                                            <div key={col.id} className="text-center min-w-[60px]">
                                                                <p className="text-[10px] text-muted-foreground">{col.label}</p>
                                                                <div className="text-sm">
                                                                    {col.id === 'price' && <p className="font-bold">{formatCurrency(sim.salePrice)}</p>}
                                                                    {col.id === 'cmv' && <p className="font-medium text-gray-600">{formatCurrency(sim.totalCmv)}</p>}
                                                                    {col.id === 'grossPct' && <p className={cn("font-bold", profitColorClass)}>{grossMarginPercentage.toFixed(1)}%</p>}
                                                                    {col.id === 'grossVal' && <p className={cn("font-bold", profitColorClass)}>{formatCurrency(grossMarginValue)}</p>}
                                                                    {col.id === 'contribPct' && <p className="font-semibold">{sim.profitPercentage.toFixed(1)}%</p>}
                                                                    {col.id === 'markup' && <p className="font-medium">{sim.markup.toFixed(2)}x</p>}
                                                                    {col.id === 'goal' && <p className="font-medium text-muted-foreground">{sim.profitGoal ? `${sim.profitGoal}%` : '-'}</p>}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </TooltipProvider>
                                                </div>
                                            </div>
                                        </Card>
                                    </AccordionItem>
                                );
                            })}
                        </Accordion>
                    </div>
                </div>
            )}
        </div>
        );
    };

    const renderCommercialTable = () => {
        if (isLoading) {
            return <div className="space-y-3"><Skeleton className="h-20 w-full rounded-2xl" /><Skeleton className="h-20 w-full rounded-2xl" /><Skeleton className="h-20 w-full rounded-2xl" /></div>;
        }

        if (simulations.every((simulation) => simulation.isArchived) && archivedSimulations.length === 0) {
            return (
                <div className="rounded-2xl border-2 border-dashed py-16 text-center text-muted-foreground">
                    <Inbox className="mx-auto h-10 w-10" />
                    <h3 className="mt-4 text-base font-bold text-foreground">Nenhuma mercadoria cadastrada</h3>
                    <p className="mt-1 text-sm">Cadastre a primeira ficha para iniciar a análise comercial.</p>
                </div>
            );
        }

        if (filteredSimulations.length === 0 && archivedSimulations.length === 0) {
            return (
                <div className="rounded-2xl border-2 border-dashed py-16 text-center text-muted-foreground">
                    <Search className="mx-auto h-9 w-9" />
                    <h3 className="mt-4 text-base font-bold text-foreground">Nenhuma mercadoria neste recorte</h3>
                    <p className="mt-1 text-sm">Ajuste o alerta, a unidade, o canal ou a busca.</p>
                </div>
            );
        }

        return (
            <div className="overflow-x-auto pb-2">
                <div className="min-w-[940px]">
                    <div className="grid grid-cols-[42px_minmax(270px,1.6fr)_112px_100px_132px_88px_76px] items-center gap-3 border-b-2 border-[#eeece7] px-3 py-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
                        <Checkbox aria-label="Selecionar todas as mercadorias visíveis" checked={allFilteredSelected} onCheckedChange={handleSelectAllChange} />
                        <span>Mercadoria</span>
                        <span className="text-right">Preço</span>
                        <span className="text-right">CMV</span>
                        <span className="text-right">Margem bruta</span>
                        <span className="text-right">Meta</span>
                        <span />
                    </div>

                    <Accordion type="multiple" className="space-y-2 pt-2">
                        {filteredSimulations.map((simulation) => {
                            const originalSimulation = simulationById.get(simulation.id) ?? simulation;
                            const insight = pricingInsights.get(simulation.id);
                            const grossMargin = calculateGrossMargin(simulation.salePrice, simulation.totalCmv || 0);
                            const status = getPricingCommercialStatus(simulation.salePrice, simulation.totalCmv || 0, simulation.profitGoal);
                            const line = simulation.lineId ? categoryMap.get(simulation.lineId) : null;
                            const category = simulation.categoryIds?.[0] ? categoryMap.get(simulation.categoryIds[0]) : null;
                            const hasArchivedBase = simHasArchivedBase.get(simulation.id) ?? false;
                            const statusUi: Record<PricingCommercialStatus, { label: string; bar: string; badge: string; surface: string }> = {
                                loss: { label: 'Prejuízo', bar: 'border-l-red-500', badge: 'border-red-200 bg-red-50 text-red-700', surface: 'hover:border-red-200 hover:bg-red-50/40' },
                                below: { label: 'Abaixo da meta', bar: 'border-l-orange-500', badge: 'border-orange-200 bg-orange-50 text-orange-700', surface: 'hover:border-orange-200 hover:bg-orange-50/40' },
                                met: { label: 'Na meta', bar: 'border-l-emerald-500', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', surface: 'hover:border-emerald-200 hover:bg-emerald-50/40' },
                                none: { label: 'Sem meta', bar: 'border-l-slate-300', badge: 'border-slate-200 bg-slate-50 text-slate-600', surface: 'hover:border-slate-300 hover:bg-slate-50/60' },
                            };
                            const ui = statusUi[status];
                            const composition = simulationItems
                                .filter((item) => item.simulationId === simulation.id)
                                .flatMap((item) => {
                                    const baseProduct = baseProducts.find((product) => product.id === item.baseProductId);
                                    if (!baseProduct) return [];
                                    const defaultCost = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
                                    let cost = item.quantity * defaultCost;
                                    if (!item.useDefault) {
                                        try {
                                            const valueInBase = convertValue(1, item.overrideUnit || baseProduct.unit, baseProduct.unit, baseProduct.category);
                                            cost = item.quantity * ((item.overrideCostPerUnit || 0) / valueInBase);
                                        } catch {
                                            cost = 0;
                                        }
                                    }
                                    return [{
                                        id: item.id,
                                        name: baseProduct.name,
                                        quantity: `${item.quantity} ${item.overrideUnit || baseProduct.unit}`,
                                        cost,
                                        share: simulation.totalCmv > 0 ? (cost / simulation.totalCmv) * 100 : 0,
                                    }];
                                });
                            const itemHistory = (priceHistory || [])
                                .filter((entry: any) => entry.simulationId === simulation.id)
                                .sort((a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
                                .slice(0, 4);

                            return (
                                <AccordionItem key={simulation.id} value={simulation.id} className="border-0">
                                    <Card className={cn("overflow-hidden rounded-2xl border border-l-4 bg-[#fbfaf7] shadow-none transition-all", ui.bar, ui.surface)}>
                                        <div className="grid grid-cols-[42px_minmax(270px,1.6fr)_112px_100px_132px_88px_76px] items-center gap-3 px-3 py-4">
                                            <Checkbox aria-label={`Selecionar ${simulation.name}`} checked={selectedSimulations.has(simulation.id)} onCheckedChange={(checked) => handleSelectionChange(simulation.id, Boolean(checked))} />
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className="truncate text-sm font-bold text-slate-900">{simulation.name}</span>
                                                    <Badge variant="outline" className={cn("h-5 gap-1 rounded-full px-2 text-[9px] font-black uppercase", ui.badge)}>
                                                        {status === 'loss' ? <TrendingDown className="h-3 w-3" /> : status === 'met' ? <Check className="h-3 w-3" /> : status === 'below' ? <AlertTriangle className="h-3 w-3" /> : <CircleMinus className="h-3 w-3" />}
                                                        {ui.label}
                                                    </Badge>
                                                    {insight?.abnormalCmv ? <Badge variant="outline" className="h-5 gap-1 rounded-full border-amber-200 bg-amber-50 px-2 text-[9px] font-black uppercase text-amber-700"><Activity className="h-3 w-3" />CMV {insight.cmvPercentage.toFixed(0)}%</Badge> : null}
                                                    {(insight?.spread ?? 0) > 35 ? <Badge variant="outline" className="h-5 rounded-full border-cyan-200 bg-cyan-50 px-2 text-[9px] font-black uppercase text-cyan-700">Δ canal +{insight?.spread.toFixed(0)}%</Badge> : null}
                                                    {hasArchivedBase ? <Badge variant="destructive" className="h-5 gap-1 rounded-full px-2 text-[9px] font-black uppercase"><AlertTriangle className="h-3 w-3" />Insumo inativo</Badge> : null}
                                                </div>
                                                <p className="mt-1 truncate text-[11px] text-slate-400"><span className="font-mono">{simulation.ppo?.sku || 'Sem SKU'}</span>{category ? ` · ${category.name}` : ''}{line ? ` · ${line.name}` : ''}</p>
                                            </div>
                                            <div className="text-right text-sm font-black text-slate-900">{(simulation as any).contextAvailable === false ? <span className="text-xs text-rose-600">Indisponível</span> : formatCurrency(simulation.salePrice)}</div>
                                            <div className="text-right text-sm font-semibold text-slate-500">{formatCurrency(simulation.totalCmv)}</div>
                                            <div className="text-right">
                                                <p className={cn("text-[15px] font-black", status === 'loss' ? 'text-red-600' : status === 'below' ? 'text-orange-600' : status === 'met' ? 'text-emerald-600' : 'text-slate-600')}>{grossMargin.percentage.toFixed(1)}%</p>
                                                <p className="text-[10px] text-slate-400">{formatCurrency(grossMargin.value)}</p>
                                            </div>
                                            <div className="text-right text-sm font-semibold text-slate-500">{simulation.profitGoal != null ? `${simulation.profitGoal}%` : '—'}</div>
                                            <div className="flex items-center justify-end gap-1">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-500"><span className="sr-only">Ações de {simulation.name}</span><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-60">
                                                        <DropdownMenuItem onClick={() => handleToggleSimulationActive(originalSimulation, false)} className="text-orange-600"><CheckCircle2 className="mr-2 h-4 w-4" />Desativar mercadoria</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setSimToManageKiosks(originalSimulation)}><Building2 className="mr-2 h-4 w-4" />Gerenciar unidades</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem onClick={() => handleViewTechnicalSheet(originalSimulation)}><Eye className="mr-2 h-4 w-4" />Ficha de instrução</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleEdit(originalSimulation, 'ficha')}><ClipboardList className="mr-2 h-4 w-4" />Ficha completa</DropdownMenuItem>
                                                        {canEditSheet ? <DropdownMenuItem onClick={() => handleEdit(originalSimulation, 'cost')}><LayoutDashboard className="mr-2 h-4 w-4" />Editar ficha</DropdownMenuItem> : null}
                                                        {canDeleteSheet ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => handleDelete(originalSimulation)}><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem></> : null}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <AccordionTrigger className="h-8 w-8 justify-center rounded-lg p-0 text-slate-400 hover:no-underline [&>svg]:m-0" aria-label={`Expandir detalhes de ${simulation.name}`} />
                                            </div>
                                        </div>

                                        <AccordionContent className="pb-0">
                                            <div className="grid grid-cols-2 gap-5 border-t bg-white p-5">
                                                <div>
                                                    <div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Preço e margem por canal</h4>{(insight?.spread ?? 0) > 35 ? <span className="text-[10px] font-bold text-cyan-700">Divergência +{insight?.spread.toFixed(0)}%</span> : null}</div>
                                                    <div className="space-y-2">
                                                        {insight?.channelRows.map((channel) => (
                                                            <div key={channel.id} className={cn("flex items-center justify-between rounded-xl border px-3 py-2.5", channel.isBest ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200')}>
                                                                <div><p className="text-xs font-bold text-slate-700">{channel.name}</p>{channel.isBest ? <p className="text-[9px] font-black uppercase text-emerald-600">Melhor margem</p> : null}</div>
                                                                <div className="text-right"><p className="text-sm font-black">{channel.available ? formatCurrency(channel.price) : 'Indisponível'}</p><p className={cn("text-[11px] font-bold", channel.margin < 0 ? 'text-red-600' : channel.margin < (simulation.profitGoal ?? 0) ? 'text-orange-600' : 'text-emerald-600')}>{channel.available ? `${channel.margin.toFixed(1)}%` : '—'}</p></div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div>
                                                    <div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Composição do CMV</h4><span className="text-sm font-black">{formatCurrency(simulation.totalCmv)}</span></div>
                                                    <div className="space-y-3">
                                                        {composition.length ? composition.map((item) => (
                                                            <div key={item.id}>
                                                                <div className="mb-1 flex justify-between gap-3 text-[11px]"><span className="truncate font-semibold text-slate-600">{item.name} · {item.quantity}</span><span className="shrink-0 font-bold text-slate-500">{formatCurrency(item.cost)} · {item.share.toFixed(0)}%</span></div>
                                                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-pink-600 to-pink-400" style={{ width: `${Math.min(100, item.share)}%` }} /></div>
                                                            </div>
                                                        )) : <p className="text-xs text-slate-400">Nenhum insumo vinculado.</p>}
                                                    </div>
                                                </div>

                                                {itemHistory.length ? <div className="col-span-2 border-t pt-4"><h4 className="mb-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Alterações recentes de preço</h4><div className="grid grid-cols-4 gap-2">{itemHistory.map((entry: any) => { const variation = entry.oldPrice > 0 ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100 : 0; return <div key={entry.id} className="rounded-xl border bg-[#faf9f6] p-3"><p className="text-[10px] text-slate-400">{new Date(entry.changedAt).toLocaleDateString('pt-BR')}</p><p className="mt-1 text-xs"><span className="text-slate-400 line-through">{formatCurrency(entry.oldPrice)}</span> <b>{formatCurrency(entry.newPrice)}</b></p><p className={cn("mt-1 text-[10px] font-bold", variation >= 0 ? 'text-emerald-600' : 'text-red-600')}>{variation >= 0 ? '+' : ''}{variation.toFixed(1)}% · {entry.changedBy?.username || 'Sistema'}</p></div>; })}</div></div> : null}
                                            </div>
                                        </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>

                    {archivedSimulations.length ? <div className="mt-5 border-t pt-4"><p className="mb-2 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Mercadorias inativas ({archivedSimulations.length})</p><div className="grid grid-cols-2 gap-2">{archivedSimulations.map((simulation) => <div key={simulation.id} className="flex items-center justify-between rounded-xl border border-dashed bg-slate-50 px-4 py-3 opacity-70"><div><p className="text-sm font-bold text-slate-600">{simulation.name}</p><p className="font-mono text-[10px] text-slate-400">{simulation.ppo?.sku || 'Sem SKU'}</p></div><Button variant="outline" size="sm" onClick={() => handleToggleSimulationActive(simulationById.get(simulation.id) ?? simulation, true)}>Reativar</Button></div>)}</div></div> : null}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-5">
            <div className={cn("flex gap-4", pageHeader ? "flex-col justify-between lg:flex-row lg:items-end" : "justify-end")}>
                {pageHeader && (
                    <div className="flex min-w-0 items-start gap-2">
                        <BackButton
                            fallbackHref="/dashboard/pricing"
                            variant="ghost"
                            iconOnly
                            className="mt-5 h-9 w-9 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-white"
                            ariaLabel="Voltar para gestão de preços e margens"
                        />
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pink-600">Coala · Comercial</p>
                            <h1 className="mt-1 text-[26px] font-black tracking-[-0.02em] text-slate-950">Precificação &amp; CMV</h1>
                            <p className="mt-1 max-w-[620px] text-[13px] text-muted-foreground">Ferramenta de decisão comercial — encontre margens ruins, CMV anormal e divergências de preço por canal sem abrir cada mercadoria.</p>
                        </div>
                    </div>
                )}
                <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="w-full md:w-auto">
                    <TabsList className="bg-white border shadow-sm p-1 h-11 rounded-xl">
                        <TabsTrigger 
                            value="inventory" 
                            className="rounded-lg px-6 font-bold text-xs uppercase data-[state=active]:bg-pink-50 data-[state=active]:text-pink-600 transition-all"
                        >
                            <Package className="mr-2 h-4 w-4" />
                            Mercadorias
                        </TabsTrigger>
                        <TabsTrigger 
                            value="analysis" 
                            className="rounded-lg px-6 font-bold text-xs uppercase data-[state=active]:bg-pink-50 data-[state=active]:text-pink-600 transition-all"
                        >
                            <History className="mr-2 h-4 w-4" />
                            Histórico & Análise
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {activeMainTab === "inventory" ? (
                <Card className="overflow-hidden rounded-[22px] border border-[#e6e3dd] bg-white shadow-sm">
                    <CardHeader className="px-5 pb-0 pt-5 sm:px-6">
                        <p className="pb-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Unidade</p>
                        <div className="grid gap-3 pb-5 sm:grid-cols-2 xl:grid-cols-4">
                            {unitNavigationCards.map((item, index) => {
                                const isActive = contextUnitId === item.id;
                                const Icon = index === 0 ? Package : Building2;

                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        aria-pressed={isActive}
                                        onClick={() => handleUnitContextChange(item.id)}
                                        className={cn(
                                            "flex min-h-[70px] items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition-all",
                                            "hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-md",
                                            isActive && "border-pink-500 bg-pink-50/70 ring-2 ring-pink-100"
                                        )}
                                    >
                                        <span className={cn(
                                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500",
                                            isActive && "bg-pink-600 text-white"
                                        )}>
                                            <Icon className="h-5 w-5" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className={cn(
                                                "block truncate text-sm font-bold text-gray-800",
                                                isActive && "text-pink-700"
                                            )}>
                                                {item.name}
                                            </span>
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                {item.count} mercadoria{item.count === 1 ? '' : 's'}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="border-t border-[#eeece7] pt-4">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Alertas comerciais</p>
                                {commercialAlert ? <button type="button" onClick={() => setCommercialAlert(null)} className="text-[10px] font-bold uppercase text-pink-600 hover:text-pink-700">Limpar alerta</button> : null}
                            </div>
                            <div className="flex flex-wrap gap-2.5 pb-5">
                                {([
                                    { id: 'loss' as const, label: 'Com prejuízo', count: commercialAlertCounts.loss, icon: TrendingDown, tone: 'border-red-200 bg-red-50 text-red-700', active: 'border-red-500 ring-red-100' },
                                    { id: 'below' as const, label: 'Abaixo da meta', count: commercialAlertCounts.below, icon: AlertTriangle, tone: 'border-orange-200 bg-orange-50 text-orange-700', active: 'border-orange-500 ring-orange-100' },
                                    { id: 'cmv' as const, label: 'CMV anormal', count: commercialAlertCounts.cmv, icon: Activity, tone: 'border-amber-200 bg-amber-50 text-amber-700', active: 'border-amber-500 ring-amber-100' },
                                ]).map((alert) => {
                                    const Icon = alert.icon;
                                    const active = commercialAlert === alert.id;
                                    return <button key={alert.id} type="button" aria-pressed={active} onClick={() => setCommercialAlert(active ? null : alert.id)} className={cn("flex min-w-40 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5", alert.tone, active && `ring-2 ${alert.active}`)}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white"><Icon className="h-4 w-4" /></span><span><strong className="block text-lg font-black leading-none">{alert.count}</strong><span className="text-[11px] font-bold">{alert.label}</span></span></button>;
                                })}
                            </div>
                        </div>

                        <div className="space-y-3 border-t border-[#eeece7] py-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                {canCreateSheet && (
                                    <Button onClick={handleAddNew} className="h-10 shrink-0 gap-2 rounded-xl bg-pink-600 text-xs font-bold uppercase text-white hover:bg-pink-700">
                                        <PlusCircle className="h-4 w-4" />
                                        Mercadoria
                                    </Button>
                                )}
                                <div className="relative min-w-0 flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Buscar mercadoria por nome ou código..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="h-10 rounded-xl border-slate-200 bg-white pl-10 shadow-sm"
                                    />
                                </div>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="h-10 shrink-0 gap-2 rounded-xl px-4 text-xs font-bold uppercase">
                                            <Filter className="h-4 w-4" />
                                            Filtros
                                            {toolbarFilterCount > 0 && (
                                                <Badge className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-pink-600 px-1.5 text-[10px]">
                                                    {toolbarFilterCount}
                                                </Badge>
                                            )}
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-64 max-h-[400px] overflow-y-auto">
                                        {lines.length > 0 && (
                                            <>
                                                <DropdownMenuLabel>Linhas</DropdownMenuLabel>
                                                {lines.map(line => (
                                                    <DropdownMenuCheckboxItem
                                                        key={line.id}
                                                        checked={lineFilters.has(line.id)}
                                                        onCheckedChange={() => handleFilterChange(line.id, 'line')}
                                                        onSelect={(e) => e.preventDefault()}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
                                                            {line.name}
                                                        </div>
                                                    </DropdownMenuCheckboxItem>
                                                ))}
                                                <DropdownMenuSeparator />
                                            </>
                                        )}
                                        {mainCategories.length > 0 && (
                                            <>
                                                <DropdownMenuLabel>Categorias</DropdownMenuLabel>
                                                {mainCategories.map(cat => (
                                                    <DropdownMenuCheckboxItem
                                                        key={cat.id}
                                                        checked={categoryFilters.has(cat.id)}
                                                        onCheckedChange={() => handleFilterChange(cat.id, 'category')}
                                                        onSelect={(e) => e.preventDefault()}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                                                            {cat.name}
                                                        </div>
                                                    </DropdownMenuCheckboxItem>
                                                ))}
                                                <DropdownMenuSeparator />
                                            </>
                                        )}
                                        <DropdownMenuLabel>Situação da Meta</DropdownMenuLabel>
                                        <DropdownMenuCheckboxItem checked={statusFilter.has('na_meta')} onCheckedChange={() => handleFilterChange('na_meta', 'status')} onSelect={(e) => e.preventDefault()}>
                                            Na Meta (Verde)
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem checked={statusFilter.has('abaixo')} onCheckedChange={() => handleFilterChange('abaixo', 'status')} onSelect={(e) => e.preventDefault()}>
                                            Abaixo (Laranja)
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem checked={statusFilter.has('sem_meta')} onCheckedChange={() => handleFilterChange('sem_meta', 'status')} onSelect={(e) => e.preventDefault()}>
                                            Sem Meta (Cinza)
                                        </DropdownMenuCheckboxItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="icon" aria-label="Escolher colunas" className="h-10 w-10 shrink-0 rounded-xl">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
                                        {ALL_COLS.map(column => (
                                            <DropdownMenuCheckboxItem
                                                key={column.id}
                                                checked={visibleColumns.has(column.id)}
                                                onCheckedChange={() => toggleColumn(column.id)}
                                                onSelect={(event) => event.preventDefault()}
                                            >
                                                {column.label}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    {canEditSheet && (
                                        <Button variant="outline" onClick={() => setIsBatchEditModalOpen(true)} className="h-10 gap-2 rounded-xl text-xs font-bold uppercase">
                                            Alterar em lote
                                        </Button>
                                    )}
                                    {permissions.pricing.manageParameters && (
                                        <Button variant="outline" onClick={() => setIsParamsModalOpen(true)} className="h-10 gap-2 rounded-xl text-xs font-bold uppercase">
                                            <Settings className="h-4 w-4" />
                                            Parâmetros
                                        </Button>
                                    )}
                                    {canExportSheet && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" disabled={filteredSimulations.length === 0} className="h-10 gap-2 rounded-xl text-xs font-bold uppercase">
                                                    <Download className="h-4 w-4" />
                                                    Exportar
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent>
                                                <DropdownMenuItem onSelect={event => event.preventDefault()}>
                                                    <PDFDownloadLink document={<GerencialReportDocument data={filteredSimulations} />} fileName={`relatorio_gerencial_${new Date().toISOString().slice(0, 10)}.pdf`} className="w-full text-left">
                                                        {({ loading }: BlobProviderParams) => (loading ? 'Gerando...' : 'Relatório Gerencial (PDF)')}
                                                    </PDFDownloadLink>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={handleExportGerencialCsv}>Relatório Gerencial (CSV)</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={handleExportXlsx}>Relatório Gerencial (XLSX)</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onSelect={handleExportPriceListPdf}>Lista de Preços (PDF)</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={handleExportPriceListCsv}>Lista de Preços (CSV)</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onSelect={event => event.preventDefault()} disabled={!singleFilteredSimulation}>
                                                    {singleFilteredSimulation && (
                                                        <PDFDownloadLink
                                                            document={<FichaTecnicaDocument type="completa" data={{...singleFilteredSimulation, ingredients: simulationItems.filter(item => item.simulationId === singleFilteredSimulation.id).map(item => ({ name: baseProductMap.get(item.baseProductId)?.name || '', quantity: item.quantity, unit: item.overrideUnit || baseProductMap.get(item.baseProductId)?.unit || '' })) }} />}
                                                            fileName={`ficha_completa_${singleFilteredSimulation.name.replace(/ /g, '_')}.pdf`}
                                                            className="w-full text-left"
                                                        >
                                                            {({ loading }: BlobProviderParams) => (loading ? 'Gerando...' : 'Ficha de Instrução (PDF)')}
                                                        </PDFDownloadLink>
                                                    )}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={handleExportFichaTecnicaSimplificadaPdf}>Ficha técnica simplificada (PDF)</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={handleExportFichaTecnicaSimplificadaCsv}>Ficha técnica simplificada (CSV)</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </div>

                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <Select value={contextChannelId} onValueChange={setContextChannelId}>
                                        <SelectTrigger className="h-10 w-[180px] shrink-0 rounded-xl">
                                            <SelectValue placeholder="Todos os canais" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Todos os canais</SelectItem>
                                            {activeChannels.map((channel) => (
                                                <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" className="h-10 gap-2 rounded-xl text-xs font-bold uppercase">
                                                <ArrowUpDown className="h-4 w-4" />
                                                {currentSortLabel}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent className="w-56">
                                            <DropdownMenuRadioGroup value={`${sortConfig.key}-${sortConfig.direction}`} onValueChange={handleSortSelection}>
                                                <DropdownMenuRadioItem value="grossPct-asc">Pior margem primeiro</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="grossPct-desc">Melhor margem primeiro</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="name-asc">Nome (A-Z)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="name-desc">Nome (Z-A)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="sku-asc">SKU (Crescente)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="sku-desc">SKU (Decrescente)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="salePrice-desc">Preço (Maior-Menor)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="salePrice-asc">Preço (Menor-Maior)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="totalCmv-desc">Custo (Maior-Menor)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="totalCmv-asc">Custo (Menor-Maior)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="grossVal-desc">M. Bruta R$ (Maior-Menor)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="grossVal-asc">M. Bruta R$ (Menor-Maior)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="profitGoal-desc">Meta (Maior-Menor)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="profitGoal-asc">Meta (Menor-Maior)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="profitPercentage-desc">M. Contrib (Maior-Menor)</DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="profitPercentage-asc">M. Contrib (Menor-Maior)</DropdownMenuRadioItem>
                                            </DropdownMenuRadioGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>

                            {toolbarFilterCount > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    {contextUnitId !== 'all' && (
                                        <button type="button" onClick={() => handleUnitContextChange('all')} className="inline-flex h-7 items-center gap-1 rounded-full border border-pink-200 bg-pink-50 px-3 text-[11px] font-bold text-pink-700">
                                            {unitNavigationCards.find(item => item.id === contextUnitId)?.name ?? 'Unidade selecionada'}
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                    {contextChannelId !== 'all' && (
                                        <button type="button" onClick={() => setContextChannelId('all')} className="inline-flex h-7 items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-3 text-[11px] font-bold text-cyan-700">
                                            {activeChannels.find(channel => channel.id === contextChannelId)?.name ?? 'Canal selecionado'}
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                    {commercialAlert && (
                                        <button type="button" onClick={() => setCommercialAlert(null)} className="inline-flex h-7 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 text-[11px] font-bold text-orange-700">
                                            {commercialAlert === 'loss' ? 'Com prejuízo' : commercialAlert === 'below' ? 'Abaixo da meta' : 'CMV anormal'}
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                    {lines.filter(line => lineFilters.has(line.id)).map(line => (
                                        <button key={line.id} type="button" onClick={() => handleFilterChange(line.id, 'line')} className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600">
                                            {line.name}<X className="h-3 w-3" />
                                        </button>
                                    ))}
                                    {mainCategories.filter(category => categoryFilters.has(category.id)).map(category => (
                                        <button key={category.id} type="button" onClick={() => handleFilterChange(category.id, 'category')} className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600">
                                            {category.name}<X className="h-3 w-3" />
                                        </button>
                                    ))}
                                    {Array.from(statusFilter).map(status => (
                                        <button key={status} type="button" onClick={() => handleFilterChange(status, 'status')} className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600">
                                            {status === 'na_meta' ? 'Na meta' : status === 'abaixo' ? 'Abaixo da meta' : 'Sem meta'}<X className="h-3 w-3" />
                                        </button>
                                    ))}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            clearFilters();
                                            handleUnitContextChange('all');
                                            setContextChannelId('all');
                                        }}
                                        className="h-7 px-2 text-[11px] font-bold text-slate-500 hover:text-pink-600"
                                    >
                                        <Eraser className="mr-1 h-3.5 w-3.5" />
                                        Limpar tudo
                                    </Button>
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-6 pt-0 sm:px-6">
                        {renderCommercialTable()}
                    </CardContent>
                </Card>
            ) : (
                <PricingHistoryAnalysis simulations={simulations} priceHistory={priceHistory || []} />
            )}

            <ProductModal
                open={isProductModalOpen && simulationToEdit !== null}
                onOpenChange={setIsProductModalOpen}
                simulation={simulationToEdit}
                initialTab={initialTab}
            />

            <AddEditSimulationModal
                open={isProductModalOpen && simulationToEdit === null}
                onOpenChange={setIsProductModalOpen}
                simulationToEdit={null}
                onDelete={() => undefined}
            />
            
            <PricingParametersModal
                open={isParamsModalOpen}
                onOpenChange={setIsParamsModalOpen}
            />
            
            <PriceHistoryModal
                open={isHistoryModalOpen}
                onOpenChange={setIsHistoryModalOpen}
                history={priceHistory}
                simulations={simulations}
            />

            <BatchEditSimulationModal
                open={isBatchEditModalOpen}
                onOpenChange={setIsBatchEditModalOpen}
                simulations={simulations}
                filteredSimulations={filteredSimulations}
                selectedSimulationIds={selectedSimulations}
            />

            <AlertDialog open={!!simToDeleteFirst} onOpenChange={(open) => { if (!open) setSimToDeleteFirst(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir mercadoria</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja excluir <strong>{simToDeleteFirst?.name}</strong>? Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmDeleteFirst} className="bg-destructive hover:bg-destructive/90">
                            Sim, excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!simToDeleteFinal} onOpenChange={(open) => { if (!open) setSimToDeleteFinal(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar exclusão definitiva</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta é sua última chance. A mercadoria <strong>{simToDeleteFinal?.name}</strong> será excluída permanentemente e todos os seus dados serão perdidos. Confirma?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmDeleteFinal} className="bg-destructive hover:bg-destructive/90">
                            Excluir definitivamente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {simToManageKiosks && (
                <KioskManagementDialog
                    open={!!simToManageKiosks}
                    onOpenChange={(open) => { if (!open) setSimToManageKiosks(null); }}
                    simulation={simToManageKiosks}
                    kiosks={commercialKiosks}
                    onSave={handleSaveKioskManagement}
                />
            )}

            <AlertDialog open={!!simulationToDeactivate} onOpenChange={(open) => { if (!open) setSimulationToDeactivate(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Desativar mercadoria</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja desativar <strong>{simulationToDeactivate?.name}</strong>? Ela será movida para a seção de inativos e não aparecerá nos relatórios ativos.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmDeactivate} className="bg-destructive hover:bg-destructive/90">
                            Desativar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
