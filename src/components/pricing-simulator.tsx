
"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, PlusCircle, Inbox, Trash2 } from "lucide-react";
import { type ProductSimulation } from "@/types";
import { Skeleton } from "./ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

export function PricingSimulator() {
    const { simulations, loading, deleteSimulation } = useProductSimulation();
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

    const renderContent = () => {
        if (loading) {
            return (
                <div className="space-y-4">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                </div>
            );
        }

        if (simulations.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma simulação criada</h3>
                    <p className="mt-1 text-sm">Clique no botão abaixo para criar sua primeira análise de custo.</p>
                </div>
            );
        }
        
        return (
            <div className="space-y-3">
                {simulations.map(sim => (
                    <Card key={sim.id} className="hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => handleEdit(sim)}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                             <div>
                                <CardTitle className="text-lg">{sim.name}</CardTitle>
                                <CardDescription>
                                    Criada em {format(new Date(sim.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                                </CardDescription>
                             </div>
                             <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => {e.stopPropagation(); setSimulationToDelete(sim);}}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                             </div>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                                <p className="text-muted-foreground">Preço de Venda</p>
                                <p className="font-semibold">{sim.salePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">CMV</p>
                                <p className="font-semibold">{sim.totalCmv.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                            </div>
                             <div>
                                <p className="text-muted-foreground">Lucro (R$)</p>
                                <p className="font-semibold">{sim.profitValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Lucro (%)</p>
                                <p className="font-semibold text-primary">{sim.profitPercentage.toFixed(2)}%</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
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
                        <Button onClick={handleAddNew}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Nova análise
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
