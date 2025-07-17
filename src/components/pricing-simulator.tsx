
"use client";

import { useState, useMemo } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useBaseProducts } from "@/hooks/use-base-products";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, PlusCircle, Inbox, Trash2, Edit } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ProductSimulation } from "@/types";
import { Skeleton } from "./ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

const formatCurrency = (value: number) => {
    if (value === undefined || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};


export function PricingSimulator() {
    const { simulations, simulationItems, loading, deleteSimulation } = useProductSimulation();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToDelete, setSimulationToDelete] = useState<ProductSimulation | null>(null);

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

    const renderContent = () => {
        if (loading || baseProductsLoading) {
            return (
                <div className="space-y-4">
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-28 w-full" />
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
        
        return (
            <Accordion type="multiple" className="w-full space-y-3">
                {simulations.map(sim => {
                    const items = simulationItems.filter(item => item.simulationId === sim.id);
                    return (
                        <AccordionItem value={sim.id} key={sim.id} className="border rounded-lg overflow-hidden">
                            <Card className="border-none shadow-none rounded-none">
                                <div className="flex items-center pr-4">
                                <AccordionTrigger className="p-4 flex-1 hover:no-underline">
                                    <div className="w-full">
                                        <CardTitle className="text-lg">{sim.name}</CardTitle>
                                        <CardDescription>
                                            Criada em {format(new Date(sim.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                                        </CardDescription>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4 text-left">
                                            <div>
                                                <p className="text-muted-foreground">Preço de Venda</p>
                                                <p className="font-semibold">{formatCurrency(sim.salePrice)}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground">CMV</p>
                                                <p className="font-semibold">{formatCurrency(sim.totalCmv)}</p>
                                            </div>
                                             <div>
                                                <p className="text-muted-foreground">Lucro (R$)</p>
                                                <p className="font-semibold text-green-600">{formatCurrency(sim.profitValue)}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground">Lucro (%)</p>
                                                <p className="font-semibold text-primary">{sim.profitPercentage.toFixed(2)}%</p>
                                            </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                 <div className="flex items-center gap-1 shrink-0">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(sim)}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setSimulationToDelete(sim)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                 </div>
                                </div>
                            </Card>
                            <AccordionContent className="px-4 pb-4">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Insumo Base</TableHead>
                                            <TableHead className="text-right">Quantidade</TableHead>
                                            <TableHead className="text-right">Custo do Item</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.map(item => (
                                            <TableRow key={item.id}>
                                                <TableCell>{baseProductMap.get(item.baseProductId)?.name || 'Insumo não encontrado'}</TableCell>
                                                <TableCell className="text-right">{item.quantity} {baseProductMap.get(item.baseProductId)?.unit}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.partialCost)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>
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
                        <Button onClick={handleAddNew}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Nova Análise
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                   {renderContent()}
                </CardContent>
            </Card>

            <AddEditSimulationModal 
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                simulationToEdit={simulationToEdit}
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
