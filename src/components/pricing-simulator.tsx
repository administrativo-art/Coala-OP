
"use client";

import { useState, useMemo } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProductSimulationCategory } from "@/hooks/use-product-simulation-category";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, PlusCircle, Inbox, Trash2, Edit, Search, Eraser, Package, Folder } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ProductSimulation } from "@/types";
import { Skeleton } from "./ui/skeleton";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SimulationCategoryManagementModal } from "./simulation-category-management-modal";

const formatCurrency = (value: number) => {
    if (value === undefined || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};


export function PricingSimulator() {
    const { simulations, simulationItems, loading, deleteSimulation } = useProductSimulation();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { categories, loading: categoriesLoading } = useProductSimulationCategory();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToDelete, setSimulationToDelete] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [insumoFilter, setInsumoFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');


    const handleAddNew = () => {
        setSimulationToEdit(null);
        setIsModalOpen(true);
    };

    const handleEdit = (simulation: ProductSimulation) => {
        setSimulationToEdit(simulation);
        setIsModalOpen(true);
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
    
    const simulationsByCategory = useMemo(() => {
        const filtered = simulations.filter(sim => {
            const searchMatch = sim.name.toLowerCase().includes(searchTerm.toLowerCase());
            const insumoMatch = insumoFilter === 'all' || simulationItems.some(item => item.simulationId === sim.id && item.baseProductId === insumoFilter);
            const categoryMatch = categoryFilter === 'all' || sim.categoryId === categoryFilter;
            return searchMatch && insumoMatch && categoryMatch;
        });

        const grouped: Record<string, ProductSimulation[]> = {};
        filtered.forEach(sim => {
            const categoryId = sim.categoryId || 'sem_categoria';
            if (!grouped[categoryId]) {
                grouped[categoryId] = [];
            }
            grouped[categoryId].push(sim);
        });
        return Object.entries(grouped).sort(([catIdA], [catIdB]) => {
            if (catIdA === 'sem_categoria') return 1;
            if (catIdB === 'sem_categoria') return -1;
            const catA = categories.find(c => c.id === catIdA);
            const catB = categories.find(c => c.id === catIdB);
            return (catA?.name || '').localeCompare(catB?.name || '');
        });

    }, [simulations, searchTerm, insumoFilter, categoryFilter, simulationItems, categories]);

    const isLoading = loading || baseProductsLoading || categoriesLoading;

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
                <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2 text-sm font-semibold text-muted-foreground border-b">
                    <div>Mercadoria</div>
                    <div className="text-right">Venda</div>
                    <div className="text-right">CMV</div>
                    <div className="text-right">Lucro</div>
                    <div className="text-right">Lucro</div>
                    <div className="w-20"></div>
                </div>
                {simulationsByCategory.map(([categoryId, sims]) => {
                    const category = categories.find(c => c.id === categoryId);
                    return (
                    <div key={categoryId}>
                        <h3 className="font-semibold text-lg flex items-center gap-2 text-primary my-3">
                            <Folder className="h-5 w-5" />
                            {category?.name || 'Sem Categoria'}
                        </h3>
                        <Accordion type="multiple" className="w-full space-y-3">
                            {sims.map(sim => {
                                const items = simulationItems.filter(item => item.simulationId === sim.id);
                                return (
                                    <AccordionItem value={sim.id} key={sim.id} className="border rounded-lg overflow-hidden bg-card hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center">
                                        <AccordionTrigger className="p-4 flex-1 hover:no-underline">
                                            <div className="grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-4 text-sm w-full">
                                                <div className="font-semibold text-left">{sim.name}</div>
                                                <div className="text-right">{formatCurrency(sim.salePrice)}</div>
                                                <div className="text-right">{formatCurrency(sim.totalCmv)}</div>
                                                <div className="text-right font-bold text-green-600">{formatCurrency(sim.profitValue)}</div>
                                                <div className="text-right font-bold text-primary">{sim.profitPercentage.toFixed(2)}%</div>
                                            </div>
                                        </AccordionTrigger>
                                        <div className="flex items-center gap-1 shrink-0 px-4">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => {e.stopPropagation(); handleEdit(sim);}}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => {e.stopPropagation(); setSimulationToDelete(sim);}}>
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
                                                        const cost = item.costPerUnit * item.quantity;
                                                        return (
                                                            <TableRow key={item.id}>
                                                                <TableCell>{baseProductInfo?.name || 'Insumo não encontrado'}</TableCell>
                                                                <TableCell className="text-right">{item.quantity} {baseProductInfo?.unit}</TableCell>
                                                                <TableCell className="text-right">{formatCurrency(item.costPerUnit)}</TableCell>
                                                                <TableCell className="text-right font-semibold text-primary">{formatCurrency(cost)}</TableCell>
                                                            </TableRow>
                                                        )
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </AccordionContent>
                                    </AccordionItem>
                                );
                            })}
                        </Accordion>
                    </div>
                )})}
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
                                <DollarSign />
                                Análise de custo de mercadorias
                            </CardTitle>
                            <CardDescription>
                                Crie composições de produtos, analise o CMV e simule preços de venda para entender a lucratividade.
                            </CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsCategoryModalOpen(true)}>
                                <Folder className="mr-2 h-4 w-4" />
                                Gerenciar Categorias
                            </Button>
                            <Button onClick={handleAddNew}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Nova Análise
                            </Button>
                        </div>
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
                                {categories.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                                <SelectItem value="sem_categoria">Sem Categoria</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={insumoFilter} onValueChange={setInsumoFilter}>
                            <SelectTrigger className="w-full sm:w-[250px]">
                                <SelectValue placeholder="Filtrar por insumo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os insumos</SelectItem>
                                {baseProducts.map(bp => (
                                    <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button variant="ghost" onClick={() => { setSearchTerm(""); setInsumoFilter("all"); setCategoryFilter("all"); }}>
                            <Eraser className="mr-2 h-4 w-4" />
                            Limpar
                        </Button>
                    </div>
                   {renderContent()}
                </CardContent>
            </Card>

            <AddEditSimulationModal 
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                simulationToEdit={simulationToEdit}
            />

            <SimulationCategoryManagementModal
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
