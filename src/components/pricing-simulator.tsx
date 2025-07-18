

"use client";

import { useState, useMemo } from "react";
import { type ProductSimulation, type PricingParameters } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import { PlusCircle, Inbox, Search, Eraser, Settings, Layers, Edit, BarChart3, Table as TableIcon, CheckCircle2, AlertTriangle, BadgePercent, History } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type SimulationCategory } from "@/types";
import { Skeleton } from "./ui/skeleton";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { CategoryManagementModal } from "./category-management-modal";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { PricingParametersModal } from "./pricing-parameters-modal";
import { BatchPriceUpdateModal } from "./batch-price-update-modal";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PricingDashboard } from "./pricing-dashboard";
import { PriceHistoryModal } from "./price-history-modal";


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

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
    const [simulationForHistory, setSimulationForHistory] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [lineFilter, setLineFilter] = useState('all');
    const [profitGoalFilter, setProfitGoalFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedDashboardItem, setSelectedDashboardItem] = useState<ProductSimulation | null>(null);


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
    
    const handleViewHistory = (simulation: ProductSimulation) => {
        setSimulationForHistory(simulation);
        setIsHistoryModalOpen(true);
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
    
    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    
    const simulationsByCategory = useMemo(() => {
        const filtered = simulations.filter(sim => {
            const searchMatch = sim.name.toLowerCase().includes(searchTerm.toLowerCase());
            const categoryMatch = categoryFilter === 'all' || sim.categoryId === categoryFilter;
            const lineMatch = lineFilter === 'all' || sim.lineId === lineFilter;
            const profitGoalMatch = profitGoalFilter === 'all' || (sim.profitGoal !== null && sim.profitGoal !== undefined && sim.profitGoal.toString() === profitGoalFilter);
            
            const meetsGoal = sim.profitGoal !== undefined && sim.profitGoal !== null && sim.profitPercentage >= sim.profitGoal;
            const statusMatch = statusFilter === 'all' || (statusFilter === 'ok' && meetsGoal) || (statusFilter === 'revisar' && !meetsGoal);

            return searchMatch && categoryMatch && lineMatch && profitGoalMatch && statusMatch;
        });

        return filtered.sort((a,b) => a.name.localeCompare(b.name));

    }, [simulations, searchTerm, categoryFilter, lineFilter, profitGoalFilter, statusFilter]);

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
        const categoryName = categoryFilter === 'all' ? null : categoryMap.get(categoryFilter)?.name || null;
        const lineName = lineFilter === 'all' ? null : categoryMap.get(lineFilter)?.name || null;
        return { categoryName, lineName, profitGoalFilter, statusFilter };
    }, [categoryFilter, lineFilter, profitGoalFilter, statusFilter, categoryMap]);
    
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
                    <p className="mt-1 text-sm">Clique no botão "Nova análise" para começar.</p>
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
                <div className="grid grid-cols-[minmax(0,2.5fr)_auto_repeat(6,minmax(0,1fr))] items-center gap-4 text-sm px-4 py-2 font-semibold text-muted-foreground">
                    <div className="text-left">Mercadoria</div>
                    <div className="w-6"></div> {/* Spacer for trigger */}
                    <div className="text-right">Preço atual</div>
                    <div className="text-right">Custo Total</div>
                    <div className="text-right">Markup</div>
                    <div className="text-right">Meta Lucro</div>
                    <div className="text-right">Lucro %</div>
                    <div className="text-center">Status</div>
                </div>
                <Accordion type="multiple" className="w-full space-y-3">
                {simulationsByCategory.map(sim => {
                        const category = sim.categoryId ? categoryMap.get(sim.categoryId) : null;
                        const meetsGoal = sim.profitGoal !== undefined && sim.profitGoal !== null && sim.profitPercentage >= sim.profitGoal;
                        const profitColorClass = getProfitColorClass(sim.profitPercentage);

                        return (
                             <AccordionItem value={sim.id} key={sim.id} className="border-l-4 rounded-lg overflow-hidden bg-muted/40" style={{ borderColor: category?.color || 'hsl(var(--border))' }}>
                                <div className="grid grid-cols-[minmax(0,2.5fr)_auto_repeat(6,minmax(0,1fr))] items-center gap-4 px-4 py-2 group">
                                     <div
                                        className="font-semibold text-left hover:underline cursor-pointer flex items-center gap-2"
                                        onClick={(e) => { e.stopPropagation(); handleEdit(sim); }}
                                    >
                                        <Edit className="h-4 w-4 text-muted-foreground invisible group-hover:visible" />
                                        <span>{sim.name}</span>
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
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Custo do item</th>
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
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        Custo e preço
                    </CardTitle>
                    <CardDescription>
                        Crie composições, analise o CMV e simule preços de venda para entender a lucratividade.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="dashboard" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 max-w-sm">
                            <TabsTrigger value="dashboard"><BarChart3 className="mr-2" />Painel de análise</TabsTrigger>
                            <TabsTrigger value="table"><TableIcon className="mr-2" />Análise de custo</TabsTrigger>
                        </TabsList>
                        <TabsContent value="dashboard" className="mt-4">
                             <PricingDashboard 
                                simulations={simulationsByCategory} 
                                isLoading={isLoading}
                                getProfitColorClass={getProfitColorClass}
                                pricingParameters={pricingParameters}
                                onSelectItem={setSelectedDashboardItem}
                                activeFilters={activeFilters}
                            />
                        </TabsContent>
                        <TabsContent value="table" className="mt-4">
                             <div className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button onClick={handleAddNew}>
                                                <PlusCircle className="mr-2 h-4 w-4" />
                                                Nova análise
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
                                         <div className="relative flex-grow w-full">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input 
                                                placeholder="Buscar por nome da mercadoria..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                className="pl-10"
                                            />
                                        </div>
                                         <div className="flex gap-2 w-full md:w-auto">
                                             <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                                <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">Todas as Categorias</SelectItem>
                                                    {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Select value={lineFilter} onValueChange={setLineFilter}>
                                                <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Linha" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">Todas as Linhas</SelectItem>
                                                    {lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Select value={profitGoalFilter} onValueChange={setProfitGoalFilter}>
                                                <SelectTrigger className="w-full md:w-auto"><SelectValue placeholder="Meta de lucro" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">Todas as Metas</SelectItem>
                                                    {(pricingParameters?.profitGoals || []).map(g => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                                <SelectTrigger className="w-full md:w-auto"><SelectValue placeholder="Status" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">Todos os Status</SelectItem>
                                                    <SelectItem value="ok">OK</SelectItem>
                                                    <SelectItem value="revisar">Revisar</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button variant="ghost" onClick={() => { setSearchTerm(""); setCategoryFilter("all"); setLineFilter("all"); setProfitGoalFilter("all"); setStatusFilter("all");}}>
                                                <Eraser className="mr-2 h-4 w-4" />Limpar
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-4">
                                  {renderTable()}
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

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
