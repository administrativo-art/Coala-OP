"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from 'next/dynamic';
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { type ProductSimulation, type PricingParameters, type SimulationCategory } from '@/types';
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
    Table as TableIcon,
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
    Package
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
import { TechnicalSheetViewerModal } from "./technical-sheet-viewer-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { useKiosks } from "@/hooks/use-kiosks";
import { useChannels } from "@/hooks/use-channels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { convertValue } from "@/lib/conversion";
import { calculateSimulationMetrics } from "@/lib/pricing-context";
import { FichaTecnicaDocument } from './pdf/FichaTecnicaDocument';
import type { BlobProviderParams } from '@react-pdf/renderer';
import { GerencialReportDocument } from './pdf/GerencialReportDocument';
import { useToast } from "@/hooks/use-toast";
import { ProductModal } from "./product-modal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { PricingHistoryAnalysis } from "./pricing-history-analysis";


const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
);


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name' | 'sku' | 'salePrice' | 'totalCmv' | 'profitGoal' | 'profitPercentage' | 'markup';
type SortDirection = 'asc' | 'desc';


export function PricingSimulator() {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation, bulkUpdateSimulations, priceHistory, updateSimulation, resolveSimulationPrice } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();
    const { pricingParameters, loading: loadingParams } = useCompanySettings();
    const { permissions } = useAuth();
    const { kiosks, loading: kiosksLoading } = useKiosks();
    const { channels } = useChannels();
    const { toast } = useToast();
    
    const [selectedSimulations, setSelectedSimulations] = useState<Set<string>>(new Set());
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [initialTab, setInitialTab] = useState<'cost' | 'ficha'>('cost');
    const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isViewerModalOpen, setIsViewerModalOpen] = useState(false);
    const [activeMainTab, setActiveMainTab] = useState<string>("inventory");
    const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToView, setSimulationToView] = useState<ProductSimulation | null>(null);
    const [simulationToDeactivate, setSimulationToDeactivate] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'name', direction: 'asc' });
    const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
    const [lineFilters, setLineFilters] = useState<Set<string>>(new Set());
    const [groupFilters, setGroupFilters] = useState<Set<string>>(new Set());
    const [kioskFilter, setKioskFilter] = useState<string>("all");
    const [contextUnitId, setContextUnitId] = useState<string>("all");
    const [contextChannelId, setContextChannelId] = useState<string>("all");

    const [statusFilter, setStatusFilter] = useState<Set<'sem_meta' | 'na_meta' | 'abaixo'>>(new Set());

    // Column visibility logic
    const ALL_COLS = useMemo(() => [
        { id: 'price', label: 'Preço', tip: 'Preço de venda ao cliente final.' },
        { id: 'cmv', label: 'CMV', tip: 'Custo da Mercadoria Vendida — soma dos insumos.' },
        { id: 'grossPct', label: 'M. Bruta %', tip: 'Margem Bruta = (Preço − CMV) ÷ Preço. Métrica principal de rentabilidade.' },
        { id: 'grossVal', label: 'M. Bruta R$', tip: 'Margem Bruta em reais: Preço menos CMV.' },
        { id: 'contribPct', label: 'M. Contrib %', tip: 'Margem de Contribuição = (Faturamento líquido − CMV) ÷ Preço. Desconta impostos e taxas.' },
        { id: 'markup', label: 'Markup', tip: 'Preço ÷ CMV. Quantas vezes o preço de venda é maior que o custo.' },
        { id: 'goal', label: 'Meta M.B.', tip: 'Meta de Margem Bruta definida para esta mercadoria.' },
    ], []);

    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('pricing-cols');
            return saved ? new Set(JSON.parse(saved)) : new Set(['price', 'cmv', 'grossPct', 'goal']);
        }
        return new Set(['price', 'cmv', 'grossPct', 'goal']);
    });

    useEffect(() => {
        localStorage.setItem('pricing-cols', JSON.stringify(Array.from(visibleColumns)));
    }, [visibleColumns]);

    const toggleColumn = (id: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                if (next.size > 1) next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };


    const handleAddNew = () => {
        setSimulationToEdit(null);
        setInitialTab('cost');
        setIsProductModalOpen(true);
    };

    const handleEdit = (simulation: ProductSimulation, tab: 'cost' | 'ficha' = 'cost') => {
        setSimulationToEdit(simulation);
        setInitialTab(tab);
        setIsProductModalOpen(true);
    };

    const handlePpoClick = (simulation: ProductSimulation) => {
        handleEdit(simulation, 'ficha');
    };
    
    const handleViewTechnicalSheet = (simulation: ProductSimulation) => {
        setSimulationToView(simulation);
        setIsViewerModalOpen(true);
    };

    const handleDelete = async (simulationId: string) => {
        await deleteSimulation(simulationId);
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
    
    const categoryMap = useMemo(() => {
        return new Map(categories.map(c => [c.id, c]));
    }, [categories]);

    const activeChannels = useMemo(() => channels.filter(channel => channel.active), [channels]);

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
            const kioskMatch = kioskFilter === 'all' || (sim.kioskIds || []).includes(kioskFilter);

            let statusMatch = true;
            if (statusFilter.size > 0) {
                const grossMarginPercentage = sim.salePrice > 0 ? ((sim.salePrice - sim.totalCmv) / sim.salePrice) * 100 : 0;
                let simStatus: 'sem_meta' | 'na_meta' | 'abaixo' = 'sem_meta';
                if (sim.profitGoal !== null && sim.profitGoal !== undefined) {
                    simStatus = grossMarginPercentage >= sim.profitGoal ? 'na_meta' : 'abaixo';
                }
                statusMatch = statusFilter.has(simStatus);
            }

            return searchMatch && categoryMatch && lineMatch && groupMatch && kioskMatch && statusMatch;
        };

        const sortFn = (a: ProductSimulation, b: ProductSimulation) => {
            let aValue: any;
            let bValue: any;

            if (sortConfig.key === 'sku') {
                aValue = a.ppo?.sku || '';
                bValue = b.ppo?.sku || '';
            } else if (sortConfig.key === 'grossVal' as any) {
                aValue = a.salePrice - a.totalCmv;
                bValue = b.salePrice - b.totalCmv;
            } else if (sortConfig.key === 'grossPct' as any) {
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

    }, [contextualSimulations, searchTerm, categoryFilters, lineFilters, groupFilters, sortConfig, kioskFilter, statusFilter]);

    const handleSort = (key: SortKey) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

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
    const totalActiveFilters = categoryFilters.size + lineFilters.size + groupFilters.size + statusFilter.size;
    
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
        setKioskFilter('all');
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
                                    <div className="flex-1 flex justify-around gap-2 overflow-hidden">
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
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => handleViewTechnicalSheet(sim)}><Eye className="mr-2 h-4 w-4" />Ficha Técnica de Instrução</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleEdit(sim, 'cost')}><LayoutDashboard className="mr-2 h-4 w-4" /> Editar Ficha</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleEdit(sim, 'ficha')}><ClipboardList className="mr-2 h-4 w-4" /> Ficha Técnica Completa</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={e => e.preventDefault()}>
                                                    <PDFDownloadLink
                                                        document={<FichaTecnicaDocument type="completa" data={{
                                                            ...sim,
                                                            ingredients: simulationItems.filter(i => i.simulationId === sim.id).map(i => ({
                                                                name: baseProductMap.get(i.baseProductId)?.name || 'Insumo não encontrado',
                                                                quantity: i.quantity,
                                                                unit: i.overrideUnit || baseProductMap.get(i.baseProductId)?.unit || ''
                                                            }))
                                                        }} />}
                                                        fileName={`ficha_completa_${sim.name.replace(/ /g, '_')}.pdf`}
                                                        className="w-full text-left"
                                                    >
                                                        {({ loading }: BlobProviderParams) => loading ? 'Gerando...' : 'Ficha Completa (PDF)'}
                                                    </PDFDownloadLink>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(sim.id)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
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
                                                            <DropdownMenuItem onClick={() => handleEdit(sim, 'cost')}><LayoutDashboard className="mr-2 h-4 w-4" /> Editar Ficha</DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(sim.id)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                                <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2" />
                                            </div>
                                            <div className="flex items-center px-4 py-3">
                                                <div className="flex-1 flex justify-around gap-2">
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

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
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
                <Card className="border-none shadow-xl bg-gray-50/50">
                    <CardHeader className="pb-0 pt-6 px-8">
                        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 pb-4">
                            {/* Left side actions & filters */}
                            <div className="flex flex-wrap items-center gap-2">
                                <Button onClick={handleAddNew} className="bg-pink-600 hover:bg-pink-700 text-white gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                    <PlusCircle className="h-4 w-4" />
                                    Mercadoria
                                </Button>
                                <Button variant="outline" onClick={() => setIsBatchEditModalOpen(true)} className="gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                    Alterar em lote
                                </Button>
                                {permissions.pricing.manageParameters && (
                                    <Button variant="outline" onClick={() => setIsParamsModalOpen(true)} className="gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                        <Settings className="h-4 w-4" />
                                        Parâmetros
                                    </Button>
                                )}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" disabled={filteredSimulations.length === 0} className="gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                            <Download className="h-4 w-4" />
                                            Exportar
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem onSelect={e => e.preventDefault()}>
                                            <PDFDownloadLink
                                                document={<GerencialReportDocument data={filteredSimulations} />}
                                                fileName={`relatorio_gerencial_${new Date().toISOString().slice(0, 10)}.pdf`}
                                                className="w-full text-left"
                                            >
                                                {({ loading }: BlobProviderParams) => (loading ? 'Gerando...' : 'Relatório Gerencial (PDF)')}
                                            </PDFDownloadLink>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onSelect={handleExportGerencialCsv}>Relatório Gerencial (CSV)</DropdownMenuItem>
                                        <DropdownMenuItem onSelect={handleExportXlsx}>Relatório Gerencial (XLSX)</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onSelect={handleExportPriceListPdf}>Lista de Preços (PDF)</DropdownMenuItem>
                                        <DropdownMenuItem onSelect={handleExportPriceListCsv}>Lista de Preços (CSV)</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onSelect={e => e.preventDefault()} disabled={!singleFilteredSimulation}>
                                            {singleFilteredSimulation && (
                                                <PDFDownloadLink
                                                    document={<FichaTecnicaDocument type="completa" data={{...singleFilteredSimulation, ingredients: simulationItems.filter(i => i.simulationId === singleFilteredSimulation.id).map(i => ({ name: baseProductMap.get(i.baseProductId)?.name || '', quantity: i.quantity, unit: i.overrideUnit || baseProductMap.get(i.baseProductId)?.unit || '' })) }} />}
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

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                            <TableIcon className="h-4 w-4" />
                                            Colunas
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-64">
                                        <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {ALL_COLS.map(col => (
                                            <DropdownMenuCheckboxItem
                                                key={col.id}
                                                checked={visibleColumns.has(col.id)}
                                                onCheckedChange={() => toggleColumn(col.id)}
                                                onSelect={(e) => e.preventDefault()}
                                            >
                                                <div className="flex flex-col">
                                                    <span>{col.label}</span>
                                                    <span className="text-[10px] text-muted-foreground">{col.tip}</span>
                                                </div>
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                {totalActiveFilters > 0 && (
                                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-pink-600 font-bold text-xs uppercase h-10 px-3">
                                        <Eraser className="mr-2 h-4 w-4" />
                                        Limpar Filtros
                                    </Button>
                                )}
                            </div>
                            
                            {/* Right side search */}
                            <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
                                <Select value={contextUnitId} onValueChange={setContextUnitId}>
                                    <SelectTrigger className="h-10 rounded-xl w-full sm:w-[220px]">
                                        <SelectValue placeholder="Todas as unidades" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Todas as unidades</SelectItem>
                                        {kiosks.map((kiosk) => (
                                            <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={contextChannelId} onValueChange={setContextChannelId}>
                                    <SelectTrigger className="h-10 rounded-xl w-full sm:w-[220px]">
                                        <SelectValue placeholder="Todos os canais" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Todos os canais</SelectItem>
                                        {activeChannels.map((channel) => (
                                            <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <div className="relative w-full xl:w-72">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input placeholder="Filtrar mercadorias..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 h-10 rounded-xl" />
                                </div>
                                <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-xl" onClick={clearFilters}><Eraser className="h-4 w-4" /></Button>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                            <ArrowUpDown className="h-4 w-4" />
                                            Ordenar por
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-56">
                                        <DropdownMenuRadioGroup value={`${sortConfig.key}-${sortConfig.direction}`} onValueChange={(v) => handleSort(v.split('-')[0] as SortKey)}>
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
                                            <DropdownMenuRadioItem value="grossPct-desc">M. Bruta % (Maior-Menor)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="grossPct-asc">M. Bruta % (Menor-Maior)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="profitGoal-desc">Meta (Maior-Menor)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="profitGoal-asc">Meta (Menor-Maior)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="profitPercentage-desc">M. Contrib (Maior-Menor)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="profitPercentage-asc">M. Contrib (Menor-Maior)</DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="gap-2 font-bold text-xs uppercase rounded-xl h-10">
                                            <Filter className="h-4 w-4" />
                                            Filtros
                                            {(categoryFilters.size + lineFilters.size + statusFilter.size) > 0 && (
                                                <Badge className="ml-1 h-5 w-5 p-0 flex items-center justify-center rounded-full bg-pink-600 text-[10px]">
                                                    {categoryFilters.size + lineFilters.size + statusFilter.size}
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
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8 pt-0">
                        {renderTable()}
                    </CardContent>
                </Card>
            ) : (
                <PricingHistoryAnalysis simulations={simulations} priceHistory={priceHistory || []} />
            )}

            <ProductModal 
                open={isProductModalOpen}
                onOpenChange={setIsProductModalOpen}
                simulation={simulationToEdit}
                initialTab={initialTab}
            />

            <TechnicalSheetViewerModal
                open={isViewerModalOpen}
                onOpenChange={() => setSimulationToView(null)}
                simulation={simulationToView}
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
