
"use client";

import { useState, useMemo } from 'react';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Search, Inbox, Filter } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { TechnicalSheetCard } from './technical-sheet-card';
import { Skeleton } from './ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { TechnicalSheetViewerModal } from './technical-sheet-viewer-modal';
import { type ProductSimulation } from '@/types';
import { AssemblyInstructionsModal } from './assembly-instructions-modal';

export function TechnicalSheetDashboard() {
    const { simulations, loading: loadingSims } = useProductSimulation();
    const { categories, loading: loadingCats } = useProductSimulationCategories();
    
    const [activeLine, setActiveLine] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
    const [simulationToView, setSimulationToView] = useState<ProductSimulation | null>(null);
    const [simulationForAssembly, setSimulationForAssembly] = useState<ProductSimulation | null>(null);

    const loading = loadingSims || loadingCats;

    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);

    const filteredSimulations = useMemo(() => {
        return simulations.filter(sim => {
            const lineMatch = activeLine === 'all' || sim.lineId === activeLine;
            const searchMatch = searchTerm === '' || 
                                sim.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                (sim.ppo?.sku || '').toLowerCase().includes(searchTerm.toLowerCase());
            const categoryMatch = selectedCategories.size === 0 || (sim.categoryIds || []).some(catId => selectedCategories.has(catId));

            return lineMatch && searchMatch && categoryMatch;
        });
    }, [simulations, activeLine, searchTerm, selectedCategories]);
    
    const handleCategoryFilterChange = (categoryId: string, checked: boolean) => {
        setSelectedCategories(prev => {
            const newSet = new Set(prev);
            if (checked) {
                newSet.add(categoryId);
            } else {
                newSet.delete(categoryId);
            }
            return newSet;
        });
    };

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <Skeleton className="h-52 w-full" />
                <Skeleton className="h-52 w-full" />
                <Skeleton className="h-52 w-full" />
                <Skeleton className="h-52 w-full" />
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4 no-print">
                <div className="space-y-3 p-4 border rounded-lg bg-card">
                    <div className="flex gap-2 items-center">
                        <Button 
                            variant={activeLine === 'all' ? 'default' : 'outline'}
                            onClick={() => setActiveLine('all')}
                            size="sm"
                        >
                            Todas
                        </Button>
                        <ScrollArea className="w-full whitespace-nowrap no-scrollbar">
                            <div className="flex gap-2 pb-2">
                            {lines.map(line => (
                                <Button 
                                    key={line.id}
                                    variant={activeLine === line.id ? 'default' : 'outline'}
                                    onClick={() => setActiveLine(line.id)}
                                    size="sm"
                                    style={{ backgroundColor: activeLine === line.id ? line.color : undefined, borderColor: line.color }}
                                    className={activeLine === line.id ? 'text-white' : ''}
                                >
                                    {line.name}
                                </Button>
                            ))}
                            </div>
                        </ScrollArea>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-grow">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por nome ou SKU..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 w-full"
                            />
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full sm:w-auto">
                                    <Filter className="mr-2 h-4 w-4" />
                                    Categorias ({selectedCategories.size})
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuLabel>Filtrar por Categoria</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <ScrollArea className="h-48">
                                {mainCategories.map(cat => (
                                    <DropdownMenuCheckboxItem
                                        key={cat.id}
                                        checked={selectedCategories.has(cat.id)}
                                        onCheckedChange={(checked) => handleCategoryFilterChange(cat.id, !!checked)}
                                    >
                                        {cat.name}
                                    </DropdownMenuCheckboxItem>
                                ))}
                                </ScrollArea>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    {(activeLine !== 'all' || searchTerm || selectedCategories.size > 0) && (
                        <div className="text-xs text-muted-foreground">
                            Filtrando por:
                            {activeLine !== 'all' && ` Linha: ${lines.find(l => l.id === activeLine)?.name}`}
                            {searchTerm && `, Busca: "${searchTerm}"`}
                            {selectedCategories.size > 0 && `, Categorias: ${Array.from(selectedCategories).map(id => mainCategories.find(c => c.id === id)?.name).join(', ')}`}
                        </div>
                    )}
                </div>

                {filteredSimulations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredSimulations.map(sim => (
                            <TechnicalSheetCard 
                                key={sim.id} 
                                simulation={sim} 
                                onViewSheet={() => setSimulationToView(sim)}
                                onViewAssembly={() => setSimulationForAssembly(sim)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="h-12 w-12 mx-auto mb-4" />
                        <p className="font-semibold">Nenhuma ficha técnica encontrada</p>
                        <p className="text-sm">Tente ajustar os filtros ou o termo de busca.</p>
                    </div>
                )}
            </div>

            <TechnicalSheetViewerModal
                open={!!simulationToView}
                onOpenChange={() => setSimulationToView(null)}
                simulation={simulationToView}
            />

            <AssemblyInstructionsModal
                open={!!simulationForAssembly}
                onOpenChange={() => setSimulationForAssembly(null)}
                simulation={simulationForAssembly}
            />
        </>
    );
}
