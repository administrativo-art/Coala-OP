
"use client";

import { useMemo } from 'react';
import Image from 'next/image';
import { type ProductSimulation, type SimulationCategory } from '@/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Eye, Settings } from 'lucide-react';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Separator } from './ui/separator';

interface TechnicalSheetCardProps {
    simulation: ProductSimulation;
    onViewSheet: () => void;
    onViewAssembly: () => void; // Placeholder for future action
}

export function TechnicalSheetCard({ simulation, onViewSheet, onViewAssembly }: TechnicalSheetCardProps) {
    const { categories } = useProductSimulationCategories();

    const simCategory = useMemo(() => {
        const firstCatId = simulation.categoryIds?.[0];
        return firstCatId ? categories.find(c => c.id === firstCatId && c.type === 'category') : null;
    }, [simulation.categoryIds, categories]);

    const simLine = useMemo(() => {
        return simulation.lineId ? categories.find(c => c.id === simulation.lineId && c.type === 'line') : null;
    }, [simulation.lineId, categories]);

    const simGroups = useMemo(() => {
        return (simulation.groupIds || []).map(id => categories.find(c => c.id === id && c.type === 'group')).filter(Boolean) as SimulationCategory[];
    }, [simulation.groupIds, categories]);


    return (
        <Card className="flex flex-col h-full transition-all duration-300 hover:shadow-xl overflow-hidden">
            <CardContent className="p-4 flex-grow flex items-start gap-4">
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
                
                <div className="space-y-2 flex-grow">
                    <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{simulation.name}</CardTitle>
                    <CardDescription className="text-xs font-mono">SKU: {simulation.ppo?.sku || 'N/A'}</CardDescription>
                    <div className="flex flex-wrap gap-1">
                        {simLine && (
                            <Badge variant="outline" style={{ borderColor: simLine.color, color: simLine.color }}>
                                {simLine.name}
                            </Badge>
                        )}
                        {simCategory && (
                            <Badge variant="secondary" style={{ backgroundColor: simCategory.color, color: 'white' }}>
                                {simCategory.name}
                            </Badge>
                        )}
                        {simGroups.map(group => (
                            <Badge key={group.id} variant="outline" style={{ borderColor: group.color, color: group.color }}>
                                {group.name}
                            </Badge>
                        ))}
                    </div>
                </div>
            </CardContent>

            <CardFooter className="p-2 pt-0 mt-auto grid grid-cols-2 gap-2">
                <Button className="w-full" size="sm" onClick={onViewSheet}>
                    <Eye className="mr-2 h-4 w-4" />
                    Ficha Completa
                </Button>
                <Button className="w-full" size="sm" variant="secondary" onClick={onViewAssembly}>
                    <Settings className="mr-2 h-4 w-4" />
                    Montagem
                </Button>
            </CardFooter>
        </Card>
    );
}
