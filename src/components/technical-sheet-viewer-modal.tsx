"use client";

import React, { useMemo } from 'react';
import { type ProductSimulation, type SimulationCategory, type ProductSimulationItem } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { Video, Info, Utensils, Award, Clock } from 'lucide-react';

interface TechnicalSheetViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function TechnicalSheetViewerModal({ open, onOpenChange, simulation }: TechnicalSheetViewerModalProps) {
    const { simulationItems } = useProductSimulation();
    const { baseProducts } = useBaseProducts();

    const ingredients = useMemo(() => {
        if (!simulation) return [];
        return simulationItems
            .filter(item => item.simulationId === simulation.id)
            .map(item => {
                const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                return {
                    name: baseProduct?.name || 'Insumo não encontrado',
                    quantity: item.quantity,
                    unit: item.overrideUnit || baseProduct?.unit || 'un'
                };
            });
    }, [simulation, simulationItems, baseProducts]);

    if (!simulation) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{simulation.name}</DialogTitle>
                    <DialogDescription>Ficha Técnica de Produção</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 pr-6 -mr-6">
                    <div className="space-y-6 py-4">
                        {simulation.ppo?.referenceImageUrl && (
                            <div className="flex justify-center">
                                <Image src={simulation.ppo.referenceImageUrl} alt={simulation.name} width={250} height={250} className="rounded-lg object-cover shadow-lg" />
                            </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Preço Venda</p>
                                <p className="text-lg font-bold">{formatCurrency(simulation.salePrice)}</p>
                            </div>
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Custo Bruto</p>
                                <p className="text-lg font-bold">{formatCurrency(simulation.grossCost)}</p>
                            </div>
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Lucro %</p>
                                <p className="text-lg font-bold">{simulation.profitPercentage.toFixed(2)}%</p>
                            </div>
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Markup</p>
                                <p className="text-lg font-bold">{simulation.markup.toFixed(1)}x</p>
                            </div>
                        </div>
                        
                        <div>
                            <h3 className="font-semibold text-lg mb-2">Composição</h3>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Ingrediente</TableHead>
                                        <TableHead className="text-right">Quantidade</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ingredients.map(ing => (
                                        <TableRow key={ing.name}>
                                            <TableCell>{ing.name}</TableCell>
                                            <TableCell className="text-right">{ing.quantity} {ing.unit}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        
                        {simulation.ppo?.assemblyInstructions && simulation.ppo.assemblyInstructions.length > 0 && (
                            <div className="p-4 border rounded-lg bg-muted/30">
                                <h3 className="font-semibold text-lg mb-2">Modo de Montagem</h3>
                                <div className="space-y-4">
                                {simulation.ppo.assemblyInstructions.map(phase => (
                                    <div key={phase.id}>
                                        <h4 className="font-semibold text-md mb-3">{phase.name}</h4>
                                        <ol className="space-y-3">
                                            {phase.etapas.map((etapa, index) => (
                                                <React.Fragment key={etapa.id}>
                                                    <li className="grid grid-cols-[auto_1fr_auto] gap-4 items-start">
                                                        <span className="font-bold text-primary pt-1">{index + 1}.</span>
                                                        <div>
                                                            <span className="font-medium">{etapa.text}</span>
                                                            {etapa.quantity && etapa.unit && <span className="text-muted-foreground text-sm"> ({etapa.quantity} {etapa.unit})</span>}
                                                        </div>
                                                        {etapa.imageUrl && <Image src={etapa.imageUrl} alt={`Etapa: ${etapa.text}`} width={64} height={64} className="rounded-md object-cover" />}
                                                    </li>
                                                </React.Fragment>
                                            ))}
                                        </ol>
                                    </div>
                                ))}
                                </div>
                            </div>
                        )}
                        
                         {simulation.ppo?.assemblyVideoUrl && (
                            <div className="p-4 border rounded-lg bg-muted/30">
                                <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Video /> Vídeo de Montagem</h4>
                                <a href={simulation.ppo.assemblyVideoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-2">
                                     Assistir vídeo de montagem
                                </a>
                            </div>
                        )}

                        {(simulation.ppo?.preparationTime || simulation.ppo?.portionWeight) && (
                            <div className="p-4 border rounded-lg bg-muted/30 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {simulation.ppo.preparationTime && (
                                    <div className="flex items-center gap-3">
                                        <Clock className="h-6 w-6 text-primary" />
                                        <div>
                                            <p className="font-semibold">Tempo de Preparo</p>
                                            <p className="text-sm text-muted-foreground">{simulation.ppo.preparationTime} segundos</p>
                                        </div>
                                    </div>
                                )}
                                {simulation.ppo.portionWeight && (
                                    <div className="flex items-center gap-3">
                                        <Utensils className="h-6 w-6 text-primary" />
                                        <div>
                                            <p className="font-semibold">Peso da Porção</p>
                                            <p className="text-sm text-muted-foreground">{simulation.ppo.portionWeight}g (±{simulation.ppo.portionTolerance || 0}g)</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {(simulation.ppo?.qualityStandard?.length || (simulation.ppo?.allergens && simulation.ppo?.allergens.length > 0)) && (
                            <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
                                {simulation.ppo.qualityStandard && simulation.ppo.qualityStandard.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold flex items-center gap-2 mb-1"><Award className="h-4 w-4 text-primary" />Padrão de Qualidade</h4>
                                        <ul className="list-disc list-inside text-sm text-muted-foreground pl-4">
                                            {simulation.ppo.qualityStandard.map(item => <li key={item.id}>{item.text}</li>)}
                                        </ul>
                                    </div>
                                )}
                                 {simulation.ppo.allergens && simulation.ppo.allergens.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold flex items-center gap-2 mb-1"><Info className="h-4 w-4 text-primary" /> Alergênicos</h4>
                                        <p className="text-sm text-muted-foreground">{simulation.ppo.allergens.map(a => a.text).join(', ')}</p>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
