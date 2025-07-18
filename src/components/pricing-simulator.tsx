
"use client";

import { useState, useMemo } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useBaseProducts } from "@/hooks/use-base-products";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Inbox, Search, Eraser, Settings, Layers, Edit } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type ProductSimulation } from "@/types";
import { Skeleton } from "./ui/skeleton";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { CategoryManagementModal } from "./category-management-modal";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { PricingParametersModal } from "./pricing-parameters-modal";
import { BatchPriceUpdateModal } from "./batch-price-update-modal";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PricingDashboard } from "./pricing-dashboard";
import { BarChart3, Table as TableIcon } from "lucide-react";


const formatCurrency = (value: number) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

export function PricingSimulator() {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation, bulkUpdatePrices } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();
    const { pricingParameters } = useCompanySettings();
    const { permissions } = useAuth();

    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
    const [isBatchUpdateModalOpen, setIsBatchUpdateModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToDelete, setSimulationToDelete] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [lineFilter, setLineFilter] = useState('all');


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
        setIsAddEditModalOpen(false); // Fecha o modal de edição
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
    
    const mainCategories = useMemo(() => categories.filter(c => c.parentId === null), [categories]);
    const lines = useMemo(() => categories.filter(c => c.parentId !== null), [categories]);
    
    const simulationsByCategory = useMemo(() => {
        const filtered = simulations.filter(sim => {
            const searchMatch = sim.name.toLowerCase().includes(searchTerm.toLowerCase());
            const categoryMatch = categoryFilter === 'all' || sim.categoryId === categoryFilter;
            const lineMatch = lineFilter === 'all' || sim.lineId === lineFilter;
            return searchMatch && categoryMatch && lineMatch;
        });

        return filtered.sort((a,b) => a.name.localeCompare(b.name));

    }, [simulations, searchTerm, categoryFilter, lineFilter]);

    const getProfitColorClass = (percentage: number) => {
        if (!pricingParameters?.profitRanges) return 'text-primary';

        const sortedRanges = [...pricingParameters.profitRanges].sort((a, b) => a.from - b.from);
        
        for (const range of sortedRanges) {
            if (percentage >= range.from && percentage < range.to) {
                return range.color;
            }
        }
        
        return 'text-primary'; // Default color if no range matches
    };

    const isLoading = loadingSimulations || loadingBaseProducts || loadingCategories;
    
    const activeFilters = useMemo(() => {
        const categoryName = categoryFilter === 'all' ? null : categoryMap.get(categoryFilter)?.name || null;
        const lineName = lineFilter === 'all' ? null : categoryMap.get(lineFilter)?.name || null;
        return { categoryName, lineName };
    }, [categoryFilter, lineFilter, categoryMap]);

    const gridClass = "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-4 text-sm";
    
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
                    <h3 className="mt-4 text-lg font-semibold text-foreground">nenhuma análise criada</h3>
                    <p className="mt-1 text-sm">Clique no botão abaixo para criar sua primeira análise de custo.</p>
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
                <div className={cn("px-4 py-2 font-semibold text-muted-foreground", gridClass)}>
                    <div className="text-left">Mercadoria</div>
                    <div className="text-right">Venda</div>
                    <div className="text-right">CMV</div>
                    <div className="text-right">Lucro</div>
                    <div className="text-right">Lucro %</div>
                </div>
                <Accordion type="multiple" className="w-full space-y-3">
                {simulationsByCategory.map(sim => {
                        const category = sim.categoryId ? categoryMap.get(sim.categoryId) : null;
                        const profitColorClass = getProfitColorClass(sim.profitPercentage);
                        
                        return (
                            <AccordionItem value={sim.id} key={sim.id} className="border-l-4 rounded-lg overflow-hidden bg-muted/40" style={{ borderColor: category?.color || 'hsl(var(--border))' }}>
                                <AccordionTrigger className={cn("p-4 hover:no-underline", gridClass)}>
                                    <div
                                        className="font-semibold text-left hover:underline cursor-pointer"
                                        onClick={(e) => { e.stopPropagation(); handleEdit(sim); }}
                                    >
                                        {sim.name}
                                    </div>
                                    <div className="text-right">{formatCurrency(sim.salePrice)}</div>
                                    <div className="text-right">{formatCurrency(sim.totalCmv)}</div>
                                    <div className={cn("text-right font-bold", profitColorClass)}>{formatCurrency(sim.profitValue)}</div>
                                    <div className={cn("text-right font-bold", profitColorClass)}>{sim.profitPercentage.toFixed(2)}%</div>
                                </AccordionTrigger>
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
                        Análise de custo de mercadorias
                    </CardTitle>
                    <CardDescription>
                        Crie composições, analise o CMV e simule preços de venda para entender a lucratividade.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                     <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                             <Button onClick={handleAddNew}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Nova análise
                            </Button>
                            <Button variant="outline" onClick={() => setIsBatchUpdateModalOpen(true)} disabled={simulationsByCategory.length === 0}>
                                <Layers className="mr-2 h-4 w-4" /> Alterar em lote
                            </Button>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                            <div className="relative flex-grow">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Buscar por nome da mercadoria..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                <SelectTrigger className="w-full sm:w-[200px]">
                                    <SelectValue placeholder="Filtrar por categoria" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as categorias</SelectItem>
                                    {mainCategories.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={lineFilter} onValueChange={setLineFilter}>
                                <SelectTrigger className="w-full sm:w-[200px]">
                                    <SelectValue placeholder="Filtrar por linha" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as linhas</SelectItem>
                                    {lines.map(l => (
                                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button variant="ghost" onClick={() => { setSearchTerm(""); setCategoryFilter("all"); setLineFilter("all"); }}>
                                <Eraser className="mr-2 h-4 w-4" />
                                Limpar
                            </Button>
                        </div>
                    </div>
                     <Tabs defaultValue="table" className="w-full">
                        <TabsList>
                            <TabsTrigger value="table"><TableIcon />Análise detalhada</TabsTrigger>
                            <TabsTrigger value="dashboard"><BarChart3 />Dashboard gerencial</TabsTrigger>
                        </TabsList>
                        <TabsContent value="table" className="mt-4">
                            {renderTable()}
                        </TabsContent>
                        <TabsContent value="dashboard" className="mt-4">
                            <PricingDashboard 
                                simulations={simulationsByCategory} 
                                isLoading={isLoading}
                                getProfitColorClass={getProfitColorClass}
                                formatCurrency={formatCurrency}
                                pricingParameters={pricingParameters}
                            />
                        </TabsContent>
                    </Tabs>

                </CardContent>
                 <CardFooter className="border-t px-6 py-4">
                    {permissions.pricing.manageParameters && (
                        <Button variant="outline" onClick={() => setIsParamsModalOpen(true)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Configurar parâmetros
                        </Button>
                    )}
                </CardFooter>
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
        </div>
    );
}
