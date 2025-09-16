
"use client";

import { useState, useMemo } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { type ProductSimulation, type PricingParameters, type SimulationCategory } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import { PlusCircle, Inbox, Search, Eraser, Settings, Layers, Edit, BarChart3, Table as TableIcon, CheckCircle2, AlertTriangle, History, ArrowUpDown, ChevronsUpDown, Check, Filter, Download, FileText } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type ProductSimulationItem } from '@/types';
import { Skeleton } from "./ui/skeleton";
import { AddEditSimulationModal } from "./add-edit-simulation-modal";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { useBaseProducts } from "@/hooks/use-base-products";
import { PricingParametersModal } from "./pricing-parameters-modal";
import { useAuth } from "@/hooks/use-auth";
import { PriceHistoryModal } from "./price-history-modal";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Badge } from "./ui/badge";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import { PpoModal } from "./ppo-modal";
import { BatchEditSimulationModal } from "./batch-edit-simulation-modal";
import { Checkbox } from "./ui/checkbox";


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name';
type SortDirection = 'asc' | 'desc';

export function PricingSimulator() {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation, bulkUpdateSimulations, priceHistory } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();
    const { pricingParameters, loading: loadingParams } = useCompanySettings();
    const { permissions } = useAuth();
    
    const [selectedSimulations, setSelectedSimulations] = useState<Set<string>>(new Set());
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isPpoModalOpen, setIsPpoModalOpen] = useState(false);
    const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'name', direction: 'asc' });
    const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
    const [lineFilters, setLineFilters] = useState<Set<string>>(new Set());


    const handleAddNew = () => {
        setSimulationToEdit(null);
        setIsAddEditModalOpen(true);
    };

    const handleEdit = (simulation: ProductSimulation) => {
        setSimulationToEdit(simulation);
        setIsAddEditModalOpen(true);
    };

    const handlePpoClick = (simulation: ProductSimulation) => {
        setSimulationToEdit(simulation);
        setIsPpoModalOpen(true);
    };

    const handleDelete = async (simulationId: string) => {
        await deleteSimulation(simulationId);
        setIsAddEditModalOpen(false); 
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
    
    const simulationsByCategory = useMemo(() => {
        const filtered = simulations.filter(sim => {
            const searchMatch = searchTerm ? sim.name.toLowerCase().includes(searchTerm.toLowerCase()) : true;
            const categoryMatch = categoryFilters.size === 0 || sim.categoryIds.some(catId => categoryFilters.has(catId));
            const lineMatch = lineFilters.size === 0 || (sim.lineId && lineFilters.has(sim.lineId));
            
            return searchMatch && categoryMatch && lineMatch;
        });
        
        return filtered.sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];

            if (aValue === undefined || aValue === null) return 1;
            if (bValue === undefined || bValue === null) return -1;

            let comparison = 0;
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                comparison = aValue.localeCompare(bValue);
            } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                comparison = aValue - bValue;
            }

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });

    }, [simulations, searchTerm, categoryFilters, lineFilters, sortConfig]);

    const handleSort = (key: SortKey) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

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

    const handleExportFichaTecnicaCompletaPdf = () => {
        const doc = new jsPDF();
        let yPos = 15;
    
        const addTitle = (title: string) => {
            if (yPos > 260) { doc.addPage(); yPos = 15; }
            doc.setFontSize(18);
            doc.text(title, 14, yPos);
            yPos += 8;
        };
    
        addTitle("Ficha técnica completa");
        doc.setFontSize(9);
        doc.setTextColor(100);
        const filterText = `Filtros: ${searchTerm || 'nenhum'} | Categorias: ${categoryFilters.size > 0 ? Array.from(categoryFilters).map(id => categoryMap.get(id)?.name).join(', ') : 'todas'} | Linhas: ${lineFilters.size > 0 ? Array.from(lineFilters).map(id => categoryMap.get(id)?.name).join(', ') : 'todas'}`;
        doc.text(filterText, 14, yPos);
        yPos += 10;
    
        simulationsByCategory.forEach(sim => {
            if (yPos > 220) { doc.addPage(); yPos = 15; }
    
            const imageSize = 30;
            const hasImage = sim.ppo?.referenceImageUrl;
            let textX = 14;
            
            if (hasImage) {
                try {
                    doc.addImage(sim.ppo!.referenceImageUrl!, 'JPEG', 14, yPos, imageSize, imageSize);
                    textX = 14 + imageSize + 5;
                } catch (e) {
                    console.error("Failed to add image to PDF", e);
                }
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text(sim.name, textX, yPos + (hasImage ? imageSize / 2 - 5 : 0));
            yPos += (hasImage ? imageSize : 0) + 10;

            autoTable(doc, {
                startY: yPos,
                body: [[
                  { content: `SKU\n${sim.ppo?.sku || 'N/A'}` },
                  { content: `Preço Venda\n${formatCurrency(sim.salePrice)}` },
                  { content: `Custo Bruto\n${formatCurrency(sim.grossCost)}` },
                  { content: `Lucro\n${sim.profitPercentage.toFixed(2)}%` },
                  { content: `Markup\n${sim.markup.toFixed(2)}x` },
                  { content: `Meta\n${sim.profitGoal ? `${sim.profitGoal}%` : 'N/A'}` },
                ]],
                theme: 'plain',
                styles: { halign: 'center', cellPadding: 2, fontSize: 8 },
            });
            yPos = (doc as any).lastAutoTable.finalY + 5;


            const items = simulationItems.filter(item => item.simulationId === sim.id);
            const bodyData = items.map(item => {
                const baseProductInfo = baseProductMap.get(item.baseProductId);
                const cost = (item.overrideCostPerUnit || 0) * item.quantity;
                const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
                return [
                    baseProductInfo?.name || 'N/A',
                    `${item.quantity} ${item.overrideUnit || baseProductInfo?.unit}`,
                    formatCurrency(item.overrideCostPerUnit || 0),
                    `${impact.toFixed(1)}%`,
                    formatCurrency(cost)
                ];
            });
    
            autoTable(doc, {
                startY: yPos,
                head: [['Insumo Base', 'Quantidade', 'Custo/unid.', 'Impacto', 'Total']],
                body: bodyData,
                theme: 'striped',
                headStyles: { fillColor: '#273344' },
                footStyles: { fillColor: '#F3F4F6', textColor: '#000000', fontStyle: 'bold' },
                foot: [['Total CMV', '', '', '', formatCurrency(sim.totalCmv)]]
            });
    
            yPos = (doc as any).lastAutoTable.finalY + 10;
    
            if (sim.ppo) {
                if (yPos > 240) { doc.addPage(); yPos = 15; }
                
                const ppoTableBody: any[][] = [];
                 if(sim.ppo.ncm) ppoTableBody.push(['NCM', sim.ppo.ncm]);
                 if(sim.ppo.cest) ppoTableBody.push(['CEST', sim.ppo.cest]);
                 if(sim.ppo.cfop) ppoTableBody.push(['CFOP', sim.ppo.cfop]);
                 if(sim.ppo.preparationTime) ppoTableBody.push(['Tempo de Preparo', `${sim.ppo.preparationTime} seg`]);
                 if(sim.ppo.portionWeight) ppoTableBody.push(['Peso da Porção', `${sim.ppo.portionWeight}g (Tolerância: ±${sim.ppo.portionTolerance || 0}g)`]);
                 if(sim.ppo.qualityStandard) ppoTableBody.push(['Padrão de Qualidade', sim.ppo.qualityStandard]);
                 if(sim.ppo.assemblyInstructions && sim.ppo.assemblyInstructions.length > 0) {
                     ppoTableBody.push(['Modo de Montagem', sim.ppo.assemblyInstructions.map((instr, i) => `${i + 1}. ${instr.text}`).join('\n')]);
                 }
                 if(sim.ppo.assemblyVideoUrl) ppoTableBody.push(['Link do Vídeo', sim.ppo.assemblyVideoUrl]);
                 if(sim.ppo.allergens && sim.ppo.allergens.length > 0) {
                    ppoTableBody.push(['Alergênicos', sim.ppo.allergens.map(a => a.text).join(', ')]);
                 }
                
                if (ppoTableBody.length > 0) {
                     autoTable(doc, {
                        startY: yPos,
                        body: ppoTableBody,
                        theme: 'striped',
                        headStyles: { fillColor: '#6B7280' },
                        styles: { cellPadding: 2 },
                        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 }, 1: {cellWidth: 'auto'} },
                    });
                     yPos = (doc as any).lastAutoTable.finalY + 10;
                }
            }
        });
    
        doc.save(`fichas_tecnicas_completas_${new Date().toISOString().slice(0,10)}.pdf`);
    };

    const handleExportFichaTecnicaSimplificadaPdf = () => {
        const doc = new jsPDF();
        let yPos = 15;

        simulationsByCategory.forEach((sim, index) => {
            if (index > 0) {
                doc.addPage();
                yPos = 15;
            }
            
            doc.setFontSize(16);
            doc.text('Ficha técnica simplificada', 14, yPos);
            yPos += 10;

            const imageSize = 30;
            const hasImage = sim.ppo?.referenceImageUrl;
            let textX = 14;

            if (hasImage) {
                try {
                    doc.addImage(sim.ppo!.referenceImageUrl!, 'JPEG', 14, yPos, imageSize, imageSize);
                    textX = 14 + imageSize + 5;
                } catch (e) {
                    console.error("Failed to add image to PDF", e);
                }
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text(sim.name, textX, yPos + (hasImage ? imageSize / 2 - 5 : 0));
            yPos += (hasImage ? imageSize : 0) + 10;

            const items = simulationItems.filter(item => item.simulationId === sim.id);
            const bodyData = items.map(item => {
                const baseProductInfo = baseProductMap.get(item.baseProductId);
                return [
                    baseProductInfo?.name || 'Insumo não encontrado',
                    `${item.quantity} ${item.overrideUnit || baseProductInfo?.unit}`
                ];
            });

            autoTable(doc, {
                startY: yPos,
                head: [['Insumo Base', 'Quantidade']],
                body: bodyData,
                theme: 'striped',
                headStyles: { fillColor: '#273344' }
            });
            yPos = (doc as any).lastAutoTable.finalY + 10;
        });

        doc.save(`fichas_tecnicas_simplificadas_${new Date().toISOString().slice(0,10)}.pdf`);
    };

    const handleExportFichaTecnicaSimplificadaCsv = () => {
        const dataForCsv: any[] = [];
        simulationsByCategory.forEach((sim, simIndex) => {
            const simItems = simulationItems.filter(item => item.simulationId === sim.id);
            simItems.forEach(item => {
                const baseProductInfo = baseProductMap.get(item.baseProductId);
                dataForCsv.push({
                    "Mercadoria": sim.name,
                    "Insumo": baseProductInfo?.name || 'N/A',
                    "Quantidade": item.quantity,
                    "Unidade": item.overrideUnit || baseProductInfo?.unit,
                });
            });

            // Add 4 blank lines after each simulation group, except for the last one
            if (simIndex < simulationsByCategory.length - 1) {
                for (let i = 0; i < 4; i++) {
                    dataForCsv.push({ "Mercadoria": '', "Insumo": '', "Quantidade": '', "Unidade": '' });
                }
            }
        });

        const csv = Papa.unparse(dataForCsv, {
            quotes: true,
            delimiter: ",",
            header: true
        });

        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `fichas_tecnicas_simplificadas_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const isLoading = loadingSimulations || loadingBaseProducts || loadingCategories || loadingParams;
    
    const activeFilters = useMemo(() => {
      return {
          categoryName: null,
          lineName: null,
          profitGoalFilter: 'all',
          statusFilter: 'all'
      };
    }, []);

    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const totalActiveFilters = categoryFilters.size + lineFilters.size;
    
    const handleFilterChange = (id: string, type: 'category' | 'line') => {
        const setter = type === 'category' ? setCategoryFilters : setLineFilters;
        setter(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const clearFilters = () => {
        setCategoryFilters(new Set());
        setLineFilters(new Set());
        setSearchTerm('');
    };
    
    const handleSelectionChange = (id: string, isSelected: boolean) => {
        setSelectedSimulations(prev => {
            const newSet = new Set(prev);
            if (isSelected) newSet.add(id);
            else newSet.delete(id);
            return newSet;
        });
    };

    const handleSelectAllChange = (isSelected: boolean) => {
        setSelectedSimulations(isSelected ? new Set(simulationsByCategory.map(p => p.id)) : new Set());
    };
    
    const allFilteredSelected = simulationsByCategory.length > 0 && selectedSimulations.size === simulationsByCategory.length;

    const renderSortableHeader = (label: string, key: SortKey) => (
        <Button variant="ghost" onClick={() => handleSort(key)} className="justify-end w-full p-0 h-auto hover:bg-transparent text-muted-foreground font-semibold hover:text-foreground">
            {label}
            {sortConfig.key === key && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
    );

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
                    <p className="mt-1 text-sm">Clique no botão "Nova mercadoria" para começar.</p>
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
                 <div className="grid grid-cols-[auto_minmax(0,2.5fr)_auto_repeat(6,minmax(0,1fr))_auto] items-center gap-4 text-sm px-4 py-2 font-semibold text-muted-foreground">
                    <Checkbox checked={allFilteredSelected} onCheckedChange={handleSelectAllChange} />
                    <Button variant="ghost" onClick={() => handleSort('name')} className="justify-start w-full p-0 h-auto hover:bg-transparent text-muted-foreground font-semibold hover:text-foreground">
                        Mercadoria
                        {sortConfig.key === 'name' && <ArrowUpDown className="ml-2 h-4 w-4" />}
                    </Button>
                    <div className="w-6"></div> {/* Spacer for trigger */}
                    {renderSortableHeader("Preço atual", "salePrice")}
                    {renderSortableHeader("Custo total", "grossCost")}
                    {renderSortableHeader("Markup", "markup")}
                    {renderSortableHeader("Meta lucro", "profitGoal")}
                    {renderSortableHeader("Lucro %", "profitPercentage")}
                    <div className="text-center">Status</div>
                    <div className="text-right">Ações</div>
                </div>
                <Accordion type="multiple" className="w-full space-y-3">
                {simulationsByCategory.map(sim => {
                        const simCategories = sim.categoryIds.map(id => categoryMap.get(id)).filter((c): c is SimulationCategory => !!c);
                        const line = sim.lineId ? categoryMap.get(sim.lineId) : null;
                        const group = sim.groupId ? categoryMap.get(sim.groupId) : null;
                        const meetsGoal = sim.profitGoal !== undefined && sim.profitGoal !== null && sim.profitPercentage >= sim.profitGoal;
                        const profitColorClass = getProfitColorClass(sim.profitPercentage);

                        return (
                             <AccordionItem value={sim.id} key={sim.id} className="border-l-0 rounded-lg overflow-hidden bg-muted/40 relative">
                                <div className="absolute left-0 top-0 bottom-0 w-1.5 flex flex-col">
                                    {simCategories.length > 0 ? (
                                        simCategories.map(cat => (
                                            <div key={cat.id} className="flex-1" style={{ backgroundColor: cat.color || 'hsl(var(--border))' }}></div>
                                        ))
                                    ) : (
                                        <div className="flex-1 bg-border"></div>
                                    )}
                                </div>
                                <div className="grid grid-cols-[auto_minmax(0,2.5fr)_auto_repeat(6,minmax(0,1fr))_auto] items-center gap-4 pl-4 pr-4 py-2 group">
                                     <Checkbox checked={selectedSimulations.has(sim.id)} onCheckedChange={(checked) => handleSelectionChange(sim.id, !!checked)} />
                                     <div className="font-semibold text-left">
                                        <p>{sim.name}</p>
                                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                                            {line && <Badge variant="secondary">{line.name}</Badge>}
                                            {group && <Badge variant="outline">{group.name}</Badge>}
                                        </div>
                                    </div>
                                    <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2 [&>svg]:mr-2 group flex items-center gap-3 px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-9 relative data-[state=open]:bg-secondary/50">
                                        <div className="flex items-center gap-3 flex-grow">
                                            
                                        </div>
                                    </AccordionTrigger>
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
                                    <div className="flex flex-col gap-0.5 pl-2 border-l h-full justify-around">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(sim)}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                         <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePpoClick(sim)}>
                                            <FileText className="h-4 w-4"/>
                                        </Button>
                                    </div>
                                </div>
                                <AccordionContent className="pl-8 pr-4 pb-4 bg-background">
                                    <div className="overflow-x-auto pt-2">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b">
                                                    <th className="p-2 text-left text-sm font-medium text-muted-foreground">Insumo base</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Quantidade</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Custo / unidade</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Impacto</th>
                                                    <th className="p-2 text-right text-sm font-medium text-muted-foreground">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {simulationItems.filter(item => item.simulationId === sim.id).map(item => {
                                                    const baseProductInfo = baseProductMap.get(item.baseProductId);
                                                    const cost = (item.overrideCostPerUnit || 0) * item.quantity;
                                                    const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
                                                    return (
                                                        <tr key={item.id} className="border-b">
                                                            <td className="p-2">{baseProductInfo?.name || 'Insumo não encontrado'}</td>
                                                            <td className="p-2 text-right">{item.quantity} {item.overrideUnit || baseProductInfo?.unit}</td>
                                                            <td className="p-2 text-right">{formatCurrency(item.overrideCostPerUnit || 0)}</td>
                                                            <td className="p-2 text-right">{impact.toFixed(1)}%</td>
                                                            <td className="p-2 text-right font-semibold text-primary">{formatCurrency(cost)}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr className="border-t font-bold">
                                                    <td colSpan={4} className="p-2 text-right">Total</td>
                                                    <td className="p-2 text-right text-primary">{formatCurrency(sim.totalCmv)}</td>
                                                </tr>
                                            </tfoot>
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
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={handleAddNew}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Mercadoria
                            </Button>
                            <Button variant="outline" onClick={() => setIsBatchEditModalOpen(true)}>
                                Alterar em lote
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
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" disabled={simulationsByCategory.length === 0}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Exportar
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onSelect={handleExportFichaTecnicaCompletaPdf}>Ficha técnica completa (PDF)</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={handleExportFichaTecnicaSimplificadaPdf}>Ficha técnica simplificada (PDF)</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={handleExportFichaTecnicaSimplificadaCsv}>Ficha técnica simplificada (CSV)</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row items-center justify-between gap-2">
                         <div className="relative flex-grow w-full md:w-auto">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por mercadoria..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 w-full"
                            />
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                           <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between">
                                        <Filter className="mr-2 h-4 w-4" />
                                        Filtros
                                        {totalActiveFilters > 0 && <Badge variant="secondary" className="ml-2 rounded-full px-1.5">{totalActiveFilters}</Badge>}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-56">
                                    <DropdownMenuLabel>Categorias</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {mainCategories.map(cat => (
                                        <DropdownMenuCheckboxItem
                                            key={cat.id}
                                            checked={categoryFilters.has(cat.id)}
                                            onCheckedChange={() => handleFilterChange(cat.id, 'category')}
                                            onSelect={(e) => e.preventDefault()}
                                        >
                                            {cat.name}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                    <DropdownMenuSeparator />
                                     <DropdownMenuLabel>Linhas</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                     {lines.map(line => (
                                        <DropdownMenuCheckboxItem
                                            key={line.id}
                                            checked={lineFilters.has(line.id)}
                                            onCheckedChange={() => handleFilterChange(line.id, 'line')}
                                            onSelect={(e) => e.preventDefault()}
                                        >
                                            {line.name}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            {totalActiveFilters > 0 && (
                                <Button variant="ghost" size="sm" onClick={clearFilters}>
                                    <Eraser className="mr-2 h-4 w-4" />
                                    Limpar
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
                <div className="mt-4">
                    {renderTable()}
                </div>
            </div>

            <AddEditSimulationModal 
                open={isAddEditModalOpen}
                onOpenChange={setIsAddEditModalOpen}
                simulationToEdit={simulationToEdit}
                onDelete={handleDelete}
            />
            
             <PpoModal
                open={isPpoModalOpen}
                onOpenChange={setIsPpoModalOpen}
                simulation={simulationToEdit}
            />
            
            <PricingParametersModal
                open={isParamsModalOpen}
                onOpenChange={setIsParamsModalOpen}
            />
            
            <PriceHistoryModal
                open={isHistoryModalOpen}
                onOpenChange={setIsHistoryModalOpen}
                history={priceHistory}
                simulations={simulations}
            />
            
            <BatchEditSimulationModal
                open={isBatchEditModalOpen}
                onOpenChange={setIsBatchEditModalOpen}
                simulations={simulations}
                filteredSimulations={simulationsByCategory}
                selectedSimulationIds={selectedSimulations}
            />
        </div>
    );
}
