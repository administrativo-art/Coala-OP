"use client";

import { useMemo } from 'react';
import Image from 'next/image';
import { type ProductSimulation, type SimulationCategory } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Eye } from 'lucide-react';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Separator } from './ui/separator';

interface TechnicalSheetCardProps {
    simulation: ProductSimulation;
    onOpenModal: () => void;
}

export function TechnicalSheetCard({ simulation, onOpenModal }: TechnicalSheetCardProps) {
    const { categories } = useProductSimulationCategories();

    const simCategory = useMemo(() => {
        const firstCatId = simulation.categoryIds?.[0];
        return firstCatId ? categories.find(c => c.id === firstCatId && c.type === 'category') : null;
    }, [simulation.categoryIds, categories]);

    const firstPhaseSteps = useMemo(() => {
        return simulation.ppo?.assemblyInstructions?.[0]?.etapas.slice(0, 3) || [];
    }, [simulation.ppo]);

    return (
        <Card className="flex flex-col h-full transition-all duration-300 hover:shadow-xl">
            <CardHeader className="p-3">
                <div className="flex justify-between items-start gap-2">
                    <div>
                        <CardTitle className="text-base font-semibold leading-tight line-clamp-1">{simulation.name}</CardTitle>
                        <CardDescription className="text-xs">SKU: {simulation.ppo?.sku || 'N/A'}</CardDescription>
                    </div>
                    {simCategory && (
                        <Badge variant="secondary" className="shrink-0" style={{ backgroundColor: simCategory.color, color: 'white' }}>
                            {simCategory.name}
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent className="p-3 pt-0 flex-grow flex items-start gap-3">
                {simulation.ppo?.referenceImageUrl ? (
                    <Image
                        src={simulation.ppo.referenceImageUrl}
                        alt={simulation.name}
                        width={96}
                        height={96}
                        className="rounded-lg object-cover aspect-square shrink-0"
                    />
                ) : (
                    <div className="h-24 w-24 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                    </div>
                )}
                
                <div className="space-y-1.5 flex-grow">
                    <h4 className="text-sm font-semibold">Modo de Montagem</h4>
                    {firstPhaseSteps.length > 0 ? (
                        <ol className="space-y-1 text-xs text-muted-foreground">
                            {firstPhaseSteps.map(step => (
                                <li key={step.id} className="line-clamp-1">
                                    <span className="font-medium">{step.text}</span>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="text-xs text-muted-foreground italic">Sem etapas cadastradas.</p>
                    )}
                </div>
            </CardContent>

            <CardFooter className="p-3 pt-0 mt-auto">
                <Button className="w-full" size="sm" onClick={onOpenModal}>
                    <Eye className="mr-2 h-4 w-4" />
                    Ver Ficha Técnica Completa
                </Button>
            </CardFooter>
        </Card>
    );
}
