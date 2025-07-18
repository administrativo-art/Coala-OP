

"use client";

import { useState, useMemo } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useBaseProducts } from "@/hooks/use-base-products";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Inbox, Trash2, Edit, Search, Eraser, Folder } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ProductSimulation, type SimulationCategory } from "@/types";
import { Skeleton } from "./ui/skeleton";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "@/lib/utils";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { CategoryManagementModal } from "./category-management-modal";

const formatCurrency = (value: number) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};


export function PricingSimulator() {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();

    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
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

    const handleDelete = async () => {
        if (simulationToDelete) {
            await deleteSimulation(simulationToDelete.id);
            setSimulationToDelete(null);
        }
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

    const isLoading = loadingSimulations || loadingBaseProducts || loadingCategories;

    const renderContent = () => {
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
                 <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2 text-sm font-semibold text-muted-foreground">
                    <div className="text-left">Mercadoria</div>
                    <div className="text-right">Venda</div>
                    <div className="text-right">CMV</div>
                    <div className="text-right">Lucro</div>
                    <div className="text-right">Lucro %</div>
                    <div className="text-center w-20">Ações</div>
                </div>
                 <Accordion type="multiple" className="w-full space-y-3">
                    {simulationsByCategory.map(sim => {
                            const items = simulationItems.filter(item => item.simulationId === sim.id);
                            const category = sim.categoryId ? categoryMap.get(sim.categoryId) : null;
                            const borderColor = category?.color || 'hsl(var(--border))';
                            
                            return (
                                <AccordionItem value={sim.id} key={sim.id} className="border-none rounded-lg" style={{ border: `2px solid ${borderColor}`, transition: 'border-color 0.3s' }}>
                                    <div className="flex items-center p-4">
                                        <AccordionTrigger className="p-0 flex-1 hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none">
                                            <div className="grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-4 text-sm w-full">
                                                <div className="font-semibold text-left">{sim.name}</div>
                                                <div className="text-right">{formatCurrency(sim.salePrice)}</div>
                                                <div className="text-right">{formatCurrency(sim.totalCmv)}</div>
                                                <div className={cn("text-right font-bold", sim.profitValue >= 0 ? 'text-green-600' : 'text-destructive')}>{formatCurrency(sim.profitValue)}</div>
                                                <div className={cn("text-right font-bold", sim.profitPercentage >= 0 ? 'text-primary' : 'text-destructive')}>{sim.profitPercentage.toFixed(2)}%</div>
                                            </div>
                                        </AccordionTrigger>
                                        <div className="flex items-center gap-1 shrink-0 justify-center pl-2">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(sim)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setSimulationToDelete(sim)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <AccordionContent className="px-4 pb-4 bg-muted/50">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Insumo Base</TableHead>
                                                    <TableHead className="text-right">Quantidade</TableHead>
                                                    <TableHead className="text-right">Custo / Unidade</TableHead>
                                                    <TableHead className="text-right">Custo do Item</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {items.map(item => {
                                                    const baseProductInfo = baseProductMap.get(item.baseProductId);
                                                    const cost = (item.overrideCostPerUnit || 0) * item.quantity;
                                                    return (
                                                        <TableRow key={item.id}>
                                                            <TableCell>{baseProductInfo?.name || 'Insumo não encontrado'}</TableCell>
                                                            <TableCell className="text-right">{item.quantity} {item.overrideUnit || baseProductInfo?.unit}</TableCell>
                                                            <TableCell className="text-right">{formatCurrency(item.overrideCostPerUnit || 0)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-primary">{formatCurrency(cost)}</TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
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
        <>
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                Análise de custo de mercadorias
                            </CardTitle>
                            <CardDescription>
                                Crie composições de produtos, analise o CMV e simule preços de venda para entender a lucratividade.
                            </CardDescription>
                        </div>
                        <Button onClick={handleAddNew}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Nova Análise
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row gap-2 p-3 border rounded-lg bg-muted/50 mb-4">
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
                            <SelectTrigger className="w-full sm:w-[250px]">
                                <SelectValue placeholder="Filtrar por categoria" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Categorias</SelectItem>
                                {mainCategories.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                         <Select value={lineFilter} onValueChange={setLineFilter}>
                            <SelectTrigger className="w-full sm:w-[250px]">
                                <SelectValue placeholder="Filtrar por linha" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Linhas</SelectItem>
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
                   {renderContent()}
                </CardContent>
            </Card>

            <AddEditSimulationModal 
                open={isAddEditModalOpen}
                onOpenChange={setIsAddEditModalOpen}
                simulationToEdit={simulationToEdit}
            />
            
            <CategoryManagementModal
                open={isCategoryModalOpen}
                onOpenChange={setIsCategoryModalOpen}
            />

            {simulationToDelete && (
                 <DeleteConfirmationDialog
                    open={!!simulationToDelete}
                    onOpenChange={() => setSimulationToDelete(null)}
                    onConfirm={handleDelete}
                    itemName={`a simulação "${simulationToDelete.name}"`}
                />
            )}
        </>
    );
}
