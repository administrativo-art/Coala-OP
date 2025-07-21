
"use client";

import { useState, useMemo } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { type ProductSimulation, type PricingParameters, type SimulationCategory } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import { PlusCircle, Inbox, Search, Eraser, Settings, Layers, Edit, BarChart3, Table as TableIcon, CheckCircle2, AlertTriangle, History, ArrowUpDown, ChevronsUpDown, Check } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type ProductSimulationItem } from '@/types';
import { Skeleton } from "./ui/skeleton";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { useBaseProducts } from "@/hooks/use-base-products";
import { CategoryManagementModal } from "./category-management-modal";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { PricingParametersModal } from "./pricing-parameters-modal";
import { BatchPriceUpdateModal } from "./batch-price-update-modal";
import { useAuth } from "@/hooks/use-auth";
import { PriceHistoryModal } from "./price-history-modal";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Badge } from "./ui/badge";


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name';
type SortDirection = 'asc' | 'desc';

export function PricingSimulator() {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation, bulkUpdatePrices, priceHistory } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();
    const { pricingParameters, loading: loadingParams } = useCompanySettings();
    const { permissions } = useAuth();

    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
    const [isBatchUpdateModalOpen, setIsBatchUpdateModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [filterValue, setFilterValue] = useState("");
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'name', direction: 'asc' });


    const handleAddNew = () => {
        setSimulationToEdit(null);
        setIsAddEditModalOpen(true);
    };

    const handleEdit = (simulation: ProductSimulation) => {
        setSimulationToEdit(simulation);
        setIsAddEditModalOpen(true);
    };

    const handleDelete = async (simulationId: string) => {
        await deleteSimulation(simulationId);
        setIsAddEditModalOpen(false); 
        setSimulationToEdit(null);
    };

    const baseProductMap = useMemo(() => {
        const map = new Map<string, { name: string, unit: string }>();
        baseProducts.forEach(bp => {
            map.set(bp.id, { name: bp.name, unit: bp.unit });
        });
        return map;
    }, [baseProducts]);
    
    const categoryMap = useMemo(() => {
        return new Map(categories.map(c => [c.id, c]));
    }, [categories]);
    
    const simulationsByCategory = useMemo(() => {
        const filtered = simulations.filter(sim => {
            if (!filterValue) return true;

            const filterLower = filterValue.toLowerCase();
            const category = sim.categoryId ? categoryMap.get(sim.categoryId) : null;
            const line = sim.lineId ? categoryMap.get(sim.lineId) : null;
            
            return sim.name.toLowerCase().includes(filterLower) ||
                   (category && category.name.toLowerCase().includes(filterLower)) ||
                   (line && line.name.toLowerCase().includes(filterLower));
        });
        
        return filtered.sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];

            if (aValue === undefined || aValue === null) return 1;
            if (bValue === undefined || bValue === null) return -1;

            let comparison = 0;
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                comparison = aValue.localeCompare(bValue);
            } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                comparison = aValue - bValue;
            }

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });

    }, [simulations, filterValue, categoryMap, sortConfig]);

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

    const isLoading = loadingSimulations || loadingBaseProducts || loadingCategories || loadingParams;
    
    const activeFilters = useMemo(() => {
      return {
          categoryName: null,
          lineName: null,
          profitGoalFilter: 'all',
          statusFilter: 'all'
      };
    }, []);

    const filterOptions = useMemo(() => {
        const mercadorias = simulations.map(s => ({ value: s.name.toLowerCase(), label: s.name, group: 'Mercadorias' }));
        const mainCategories = categories.filter(c => c.type === 'category').map(c => ({ value: c.name.toLowerCase(), label: c.name, group: 'Categorias' }));
        const lines = categories.filter(c => c.type === 'line').map(l => ({ value: l.name.toLowerCase(), label: l.name, group: 'Linhas' }));
        
        return {
            'Mercadorias': mercadorias,
            'Categorias': mainCategories,
            'Linhas': lines
        };
    }, [simulations, categories]);
    
    const renderSortableHeader = (label: string, key: SortKey) => (
        <Button variant="ghost" onClick={() => handleSort(key)} className="justify-end w-full p-0 h-auto hover:bg-transparent text-muted-foreground font-semibold hover:text-foreground">
            {label}
            {sortConfig.key === key && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
    );

    const renderTable = () => {
        if (isLoading) {
            return (
                <div className="space-y-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                </div>
            );
        }

        if (simulations.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise criada</h3>
                    <p className="mt-1 text-sm">Clique no botão "Nova mercadoria" para começar.</p>
                </div>
            );
        }
        
        if (simulationsByCategory.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhum resultado encontrado</h3>
                    <p className="mt-1 text-sm">Tente ajustar os filtros de busca.</p>
                </div>
            );
        }
        
        return (
            <div className="space-y-4">
                 <div className="grid grid-cols-[minmax(0,2.5fr)_repeat(7,minmax(0,1fr))] items-center gap-4 text-sm px-4 py-2 font-semibold text-muted-foreground">
                    <Button variant="ghost" onClick={() => handleSort('name')} className="justify-start w-full p-0 h-auto hover:bg-transparent text-muted-foreground font-semibold hover:text-foreground">
                        Mercadoria
                        {sortConfig.key === 'name' && <ArrowUpDown className="ml-2 h-4 w-4" />}
                    </Button>
                    <div className="w-6"></div> {/* Spacer for trigger */}
                    {renderSortableHeader("Preço atual", "salePrice")}
                    {renderSortableHeader("Custo total", "grossCost")}
                    {renderSortableHeader("Markup", "markup")}
                    {renderSortableHeader("Meta lucro", "profitGoal")}
                    {renderSortableHeader("Lucro %", "profitPercentage")}
                    <div className="text-center">Status</div>
                </div>
                <Accordion type="multiple" className="w-full space-y-3">
                {simulationsByCategory.map(sim => {
                        const category = sim.categoryId ? categoryMap.get(sim.categoryId) : null;
                        const line = sim.lineId ? categoryMap.get(sim.lineId) : null;
                        const meetsGoal = sim.profitGoal !== undefined && sim.profitGoal !== null && sim.profitPercentage >= sim.profitGoal;
                        const profitColorClass = getProfitColorClass(sim.profitPercentage);

                        return (
                             <AccordionItem value={sim.id} key={sim.id} className="border-l-4 rounded-lg overflow-hidden bg-muted/40" style={{ borderColor: category?.color || 'hsl(var(--border))' }}>
                                <div className="grid grid-cols-[minmax(0,2.5fr)_auto_repeat(6,minmax(0,1fr))] items-center gap-4 px-4 py-2 group">
                                     <div
                                        className="font-semibold text-left"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div
                                            className="hover:underline cursor-pointer"
                                            onClick={(e) => { e.stopPropagation(); handleEdit(sim); }}
                                            >
                                                {sim.name}
                                            </div>
                                            <Edit className="h-4 w-4 text-muted-foreground invisible group-hover:visible cursor-pointer" onClick={(e) => { e.stopPropagation(); handleEdit(sim); }}/>
                                        </div>
                                        <div className="flex items-center gap-1 mt-1">
                                            {category && <Badge style={{backgroundColor: `${category.color}20`, color: category.color, borderColor: `${category.color}80`}} variant="outline">{category.name}</Badge>}
                                            {line && <Badge variant="secondary">{line.name}</Badge>}
                                        </div>
                                    </div>
                                    <AccordionTrigger className="p-0 hover:no-underline [&>svg]:ml-2" />
                                    <div className="text-right font-bold">{formatCurrency(sim.salePrice)}</div>
                                    <div className="text-right">{formatCurrency(sim.grossCost)}</div>
                                    <div className="text-right">{sim.markup.toFixed(1)}x</div>
                                    <div className="text-right font-medium text-muted-foreground">{sim.profitGoal ? `${sim.profitGoal}%` : '-'}</div>
                                    <div className={cn("text-right font-bold", profitColorClass)}>{sim.profitPercentage.toFixed(2)}%</div>
                                    <div className="flex justify-center">
                                        {sim.profitGoal !== undefined && sim.profitGoal !== null ? (
                                            meetsGoal ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-600" />
                                            ) : (
                                                <AlertTriangle className="h-5 w-5 text-orange-500" />
                                            )
                                        ) : <div className="h-5 w-5" />}
                                    </div>
                                </div>
                                <AccordionContent className="px-4 pb-4 bg-background">
                                    <div className="overflow-x-auto pt-2">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b">
                                                    <th className="p-2 text-left text-sm font-medium text-muted-foreground">Insumo base</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Quantidade</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Custo / unidade</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {simulationItems.filter(item => item.simulationId === sim.id).map(item => {
                                                    const baseProductInfo = baseProductMap.get(item.baseProductId);
                                                    const cost = (item.overrideCostPerUnit || 0) * item.quantity;
                                                    return (
                                                        <tr key={item.id} className="border-b">
                                                            <td className="p-2">{baseProductInfo?.name || 'Insumo não encontrado'}</td>
                                                            <td className="p-2 text-right">{item.quantity} {item.overrideUnit || baseProductInfo?.unit}</td>
                                                            <td className="p-2 text-right">{formatCurrency(item.overrideCostPerUnit || 0)}</td>
                                                            <td className="p-2 text-right font-semibold text-primary">{formatCurrency(cost)}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr className="border-t font-bold">
                                                    <td colSpan={3} className="p-2 text-right">Total</td>
                                                    <td className="p-2 text-right text-primary">{formatCurrency(sim.totalCmv)}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        );
                    })
                }
            </Accordion>
        </div>
        )
    };

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={handleAddNew}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Mercadoria
                            </Button>
                            <Button variant="outline" onClick={() => setIsBatchUpdateModalOpen(true)} disabled={simulationsByCategory.length === 0}>
                                <Layers className="mr-2 h-4 w-4" /> Alterar em lote
                            </Button>
                                <Button variant="outline" onClick={() => setIsHistoryModalOpen(true)}>
                                <History className="mr-2 h-4 w-4" /> Histórico de ajustes
                            </Button>
                            {permissions.pricing.manageParameters && (
                                <Button variant="outline" onClick={() => setIsParamsModalOpen(true)}>
                                    <Settings className="mr-2 h-4 w-4" />
                                    Parâmetros
                                </Button>
                            )}
                        </div>
                    </div>
                        <div className="flex flex-col md:flex-row items-center justify-between gap-2">
                            <div className="flex-grow w-full md:w-auto">
                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={popoverOpen}
                                    className="w-full justify-between font-normal"
                                >
                                    {filterValue
                                    ? Object.values(filterOptions).flat().find(option => option.value === filterValue)?.label || "Filtrar..."
                                    : "Filtrar mercadoria, categoria..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                    <CommandInput placeholder="Buscar..." />
                                    <CommandList>
                                        <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
                                        
                                        {Object.entries(filterOptions).map(([groupName, options]) => (
                                          options.length > 0 && (
                                            <CommandGroup key={groupName} heading={groupName}>
                                                {options.map((option) => (
                                                    <CommandItem
                                                        key={option.value}
                                                        value={option.value}
                                                        onSelect={(currentValue) => {
                                                            setFilterValue(currentValue === filterValue ? "" : currentValue);
                                                            setPopoverOpen(false);
                                                        }}
                                                    >
                                                        <Check
                                                            className={cn("mr-2 h-4 w-4", filterValue === option.value ? "opacity-100" : "opacity-0")}
                                                        />
                                                        {option.label}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                          )
                                        ))}
                                    </CommandList>
                                </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </div>
                <div className="mt-4">
                    {renderTable()}
                </div>
            </div>

            <AddEditSimulationModal 
                open={isAddEditModalOpen}
                onOpenChange={setIsAddEditModalOpen}
                simulationToEdit={simulationToEdit}
                onDelete={handleDelete}
            />
            
            <CategoryManagementModal
                open={isCategoryModalOpen}
                onOpenChange={setIsCategoryModalOpen}
            />

            <PricingParametersModal
                open={isParamsModalOpen}
                onOpenChange={setIsParamsModalOpen}
            />

            <BatchPriceUpdateModal
                open={isBatchUpdateModalOpen}
                onOpenChange={setIsBatchUpdateModalOpen}
                simulationsToUpdate={simulationsByCategory}
                onConfirm={bulkUpdatePrices}
                activeFilters={activeFilters}
            />
            
            <PriceHistoryModal
                open={isHistoryModalOpen}
                onOpenChange={setIsHistoryModalOpen}
                history={priceHistory}
                simulations={simulations}
            />
        </div>
    );
}
