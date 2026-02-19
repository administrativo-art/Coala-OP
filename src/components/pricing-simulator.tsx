
"use client";

import { useState, useMemo, useEffect } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { type ProductSimulation, type PricingParameters, type SimulationCategory } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import {
    PlusCircle,
    Inbox,
    Search,
    Eraser,
    Settings,
    Layers,
    Edit,
    Table as TableIcon,
    CheckCircle2,
    AlertTriangle,
    History,
    ArrowUpDown,
    ChevronsUpDown,
    Check,
    Filter,
    Download,
    FileText,
    Eye,
    MoreHorizontal,
    Trash2,
    Warehouse
} from 'lucide-react';
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
import { useCompanySettings } from "@/hooks/use-company-settings";
import { PriceHistoryModal } from "./price-history-modal";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Badge } from "./ui/badge";

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { PpoModal } from "./ppo-modal";
import { BatchEditSimulationModal } from "./batch-edit-simulation-modal";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { TechnicalSheetViewerModal } from "./technical-sheet-viewer-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { useKiosks } from "@/hooks/use-kiosks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { convertValue } from "@/lib/conversion";
import { generateFichaTecnicaCompletaPdf } from '@/lib/pdf-generator';


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name' | 'sku' | 'salePrice' | 'totalCmv' | 'profitGoal' | 'profitPercentage';
type SortDirection = 'asc' | 'desc';


export function PricingSimulator() {
    const { simulations, simulationItems, loading: loadingSimulations, deleteSimulation, bulkUpdateSimulations, priceHistory, updateSimulation } = useProductSimulation();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
    const { categories, loading: loadingCategories } = useProductSimulationCategories();
    const { pricingParameters, loading: loadingParams } = useCompanySettings();
    const { permissions } = useAuth();
    const { kiosks, loading: kiosksLoading } = useKiosks();
    
    const [selectedSimulations, setSelectedSimulations] = useState<Set<string>>(new Set());
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isPpoModalOpen, setIsPpoModalOpen] = useState(false);
    const [isViewerModalOpen, setIsViewerModalOpen] = useState(false);
    const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);
    const [isArchivedModalOpen, setIsArchivedModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToView, setSimulationToView] = useState<ProductSimulation | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'name', direction: 'asc' });
    const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
    const [lineFilters, setLineFilters] = useState<Set<string>>(new Set());
    const [groupFilters, setGroupFilters] = useState<Set<string>>(new Set());
    const [kioskFilter, setKioskFilter] = useState<string>("all");


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
    
    const handleViewTechnicalSheet = (simulation: ProductSimulation) => {
        setSimulationToView(simulation);
        setIsViewerModalOpen(true);
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

    const filteredSimulations = useMemo(() => {
        return simulations.filter(sim => {
            const searchMatch = searchTerm ? (sim.name.toLowerCase().includes(searchTerm.toLowerCase()) || (sim.ppo?.sku || '').toLowerCase().includes(searchTerm.toLowerCase())) : true;
            const categoryMatch = categoryFilters.size === 0 || (sim.categoryIds || []).some(catId => categoryFilters.has(catId));
            const lineMatch = lineFilters.size === 0 || (sim.lineId && lineFilters.has(sim.lineId));
            const groupMatch = groupFilters.size === 0 || (sim.groupIds || []).some(groupId => groupFilters.has(groupId));
            const kioskMatch = kioskFilter === 'all' || (sim.kioskIds || []).includes(kioskFilter);
            
            return searchMatch && categoryMatch && lineMatch && groupMatch && kioskMatch;
        }).sort((a, b) => {
            let aValue: any;
            let bValue: any;

            if (sortConfig.key === 'sku') {
                aValue = a.ppo?.sku || '';
                bValue = b.ppo?.sku || '';
            } else {
                aValue = a[sortConfig.key as keyof ProductSimulation];
                bValue = b[sortConfig.key as keyof ProductSimulation];
            }

            if (aValue === undefined || aValue === null) return 1;
            if (bValue === undefined || bValue === null) return -1;

            let comparison = 0;
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                comparison = aValue.localeCompare(bValue, undefined, { numeric: true });
            } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                comparison = aValue - bValue;
            }

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });

    }, [simulations, searchTerm, categoryFilters, lineFilters, groupFilters, sortConfig, kioskFilter]);

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

    const handleExportGerencialPdf = () => {
        alert("Exportação de PDF em atualização.");
    };

    const handleExportFichaTecnicaSimplificadaPdf = () => {
        alert("Exportação de PDF em atualização.");
    };

    const handleExportFichaTecnicaSimplificadaCsv = () => {
        const dataForCsv = filteredSimulations.flatMap(sim => {
            const ingredients = simulationItems
                .filter(item => item.simulationId === sim.id)
                .map(item => {
                    const bp = baseProductMap.get(item.baseProductId);
                    return `${bp ? bp.name : 'N/A'}: ${item.quantity} ${item.overrideUnit || bp?.unit || ''}`;
                }).join(' | ');
            return {
                'Mercadoria': sim.name,
                'Ingredientes': ingredients,
            };
        });

        const csv = Papa.unparse(dataForCsv);
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", 'fichas_tecnicas_simplificadas.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleExportGerencialCsv = () => {
        const dataForCsv = filteredSimulations.map(sim => ({
            'Mercadoria': sim.name,
            'SKU': sim.ppo?.sku || '',
            'Preço Venda': sim.salePrice,
            'CMV': sim.totalCmv,
            'Margem Contrib. %': sim.profitPercentage,
            'Markup': sim.markup,
            'Meta Lucro %': sim.profitGoal || '',
            'NCM': sim.ppo?.ncm || '',
            'CEST': sim.ppo?.cest || '',
            'CFOP': sim.ppo?.cfop || '',
        }));

        const csv = Papa.unparse(dataForCsv);
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `relatorio_gerencial_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const handleExportXlsx = () => {
        const dataForSheet = filteredSimulations.map(sim => ({
            'Mercadoria': sim.name,
            'SKU': sim.ppo?.sku || '',
            'Preço Venda': sim.salePrice,
            'CMV': sim.totalCmv,
            'Margem Contrib. %': sim.profitPercentage,
            'Markup': sim.markup,
            'Meta Lucro %': sim.profitGoal || '',
            'NCM': sim.ppo?.ncm || '',
            'CEST': sim.ppo?.cest || '',
            'CFOP': sim.ppo?.cfop || '',
        }));

        const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Relatório Gerencial");

        for (const cellAddress in worksheet) {
            if (cellAddress[0] === '!') continue;
            const col = cellAddress.replace(/[0-9]/g, '');
            const row = parseInt(cellAddress.replace(/[A-Z]/g, ''));
            if (row > 1) { 
                if (['C', 'D'].includes(col)) {
                    worksheet[cellAddress].z = 'R$ #,##0.00';
                }
                if (['E', 'G'].includes(col)) { 
                     worksheet[cellAddress].t = 'n';
                     worksheet[cellAddress].v = worksheet[cellAddress].v / 100;
                     worksheet[cellAddress].z = '0.00%';
                }
                 if (['F'].includes(col)) {
                    worksheet[cellAddress].z = '0.00"x"';
                }
            }
        }


        XLSX.writeFile(workbook, `relatorio_gerencial_${new Date().toISOString().slice(0,10)}.xlsx`);
    };

    const handleExportPriceListPdf = () => {
        alert("Exportação de PDF em atualização.");
    };

    const handleExportPriceListCsv = () => {
        const dataForCsv = filteredSimulations.map(sim => ({
            'Mercadoria': sim.name,
            'Preço de Venda': sim.salePrice,
            'Margem Contrib. %': sim.profitPercentage.toFixed(2) + '%'
        }));

        const csv = Papa.unparse(dataForCsv, {
            quotes: true,
            delimiter: ';',
            header: true,
            newline: '\r\n'
        });
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `lista_de_precos_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const isLoading = loadingSimulations || loadingBaseProducts || loadingCategories || loadingParams || kiosksLoading;
    
    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const groups = useMemo(() => categories.filter(c => c.type === 'group'), [categories]);
    const totalActiveFilters = categoryFilters.size + lineFilters.size + groupFilters.size;
    
    const handleFilterChange = (id: string, type: 'category' | 'line' | 'group') => {
        const setter = type === 'category' ? setCategoryFilters : type === 'line' ? setLineFilters : setGroupFilters;
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
        setGroupFilters(new Set());
        setSearchTerm('');
        setKioskFilter('all');
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
        setSelectedSimulations(isSelected ? new Set(filteredSimulations.map(p => p.id)) : new Set());
    };
    
    const allFilteredSelected = filteredSimulations.length > 0 && selectedSimulations.size === filteredSimulations.length;

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
        
        if (filteredSimulations.length === 0) {
            return (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhum resultado encontrado</h3>
                    <p className="mt-1 text-sm">Tente ajustar os filtros de busca.</p>
                </div>
            );
        }
        
        return (
            <div className="space-y-2">
                 <div className="flex items-center gap-4 px-2 py-2 border-y">
                    <Checkbox id="select-all" checked={allFilteredSelected} onCheckedChange={handleSelectAllChange} />
                    <Label htmlFor="select-all" className="text-sm font-medium">Selecionar todos ({filteredSimulations.length})</Label>
                </div>
                
                <Accordion type="multiple" className="space-y-2">
                    {filteredSimulations.map(sim => {
                        const simCategories = (sim.categoryIds || []).map(id => categoryMap.get(id)).filter((c): c is SimulationCategory => !!c);
                        const line = sim.lineId ? categoryMap.get(sim.lineId) : null;
                        const simGroups = (sim.groupIds || []).map(id => categoryMap.get(id)).filter((c): c is SimulationCategory => !!c);
                        const meetsGoal = sim.profitGoal !== undefined && sim.profitGoal !== null && sim.profitPercentage >= sim.profitGoal;
                        const profitColorClass = getProfitColorClass(sim.profitPercentage);

                        return (
                             <AccordionItem value={sim.id} key={sim.id} className="border-b-0">
                                <Card className="overflow-hidden">
                                <div className="flex items-center p-2 pr-4 bg-muted/30">
                                    <Checkbox className="mx-2" checked={selectedSimulations.has(sim.id)} onCheckedChange={(checked) => handleSelectionChange(sim.id, !!checked)} />
                                    <div className="flex-grow">
                                        <p className="font-semibold">{sim.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">SKU: {sim.ppo?.sku || 'N/A'}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {line && (
                                            <Badge variant="outline" style={{ borderColor: line.color, color: line.color }}>
                                                {line.name}
                                            </Badge>
                                        )}
                                        {simCategories.map(cat => (
                                            <Badge key={cat.id} variant="secondary" style={{ backgroundColor: cat.color, color: 'white' }}>{cat.name}</Badge>
                                        ))}
                                        {simGroups.map(group => (
                                            <Badge key={group.id} variant="outline">{group.name}</Badge>
                                        ))}
                                    </div>
                                    <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2" />
                                </div>
                                <div className="grid grid-cols-7 items-center px-4 py-3">
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Preço</p>
                                        <p className="font-bold">{formatCurrency(sim.salePrice)}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">CMV</p>
                                        <p>{formatCurrency(sim.totalCmv)}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Margem (R$)</p>
                                        <p className={cn("font-bold text-lg", profitColorClass)}>{formatCurrency(sim.profitValue)}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Margem (%)</p>
                                        <p className={cn("font-bold text-lg", profitColorClass)}>{sim.profitPercentage.toFixed(2)}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Markup</p>
                                        <p>{sim.markup.toFixed(1)}x</p>
                                    </div>
                                     <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Meta</p>
                                        <p className="font-medium text-muted-foreground">{sim.profitGoal ? `${sim.profitGoal}%` : '-'}</p>
                                    </div>
                                    <div className="flex justify-center items-center gap-2">
                                        {sim.profitGoal !== undefined && sim.profitGoal !== null ? (
                                            meetsGoal ? <CheckCircle2 className="h-5 w-5 text-green-500"/> : <AlertTriangle className="h-5 w-5 text-orange-500"/>
                                        ) : <div className="h-5 w-5"/>}
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menu</span><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleViewTechnicalSheet(sim)}><Eye className="mr-2 h-4 w-4" />Ver Ficha Técnica</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleEdit(sim)}><Edit className="mr-2 h-4 w-4" /> Editar Análise</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handlePpoClick(sim)}><FileText className="mr-2 h-4 w-4" /> Editar ficha</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => alert("Exportação de PDF em atualização.")}><Download className="mr-2 h-4 w-4" />Baixar Ficha Completa</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(sim.id)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                <AccordionContent>
                                    <div className="px-4 pb-4 bg-background border-t">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Insumo base</TableHead>
                                                    <TableHead>Quantidade</TableHead>
                                                    <TableHead className="text-right">Custo / unidade</TableHead>
                                                    <TableHead className="text-right">Impacto</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {simulationItems.filter(item => item.simulationId === sim.id).map(item => {
                                                    const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                                                    if (!baseProduct) return null;
                                                    
                                                    const costPerUnit = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
                                                    
                                                    let cost = 0;
                                                    try {
                                                        const valueInBase = item.useDefault 
                                                            ? 1
                                                            : convertValue(1, item.overrideUnit || baseProduct.unit, baseProduct.unit, baseProduct.category);
                                                        
                                                        const effectiveCostPerUnit = item.useDefault ? costPerUnit : (item.overrideCostPerUnit || 0) / valueInBase;
                                                        cost = item.quantity * effectiveCostPerUnit;

                                                    } catch (e) { console.error(e) }
                                                    
                                                    const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
                                                    
                                                    return (
                                                        <TableRow key={item.id}>
                                                            <TableCell>{baseProduct?.name || 'Insumo não encontrado'}</TableCell>
                                                            <TableCell>{item.quantity} {item.overrideUnit || baseProduct?.unit}</TableCell>
                                                            <TableCell className="text-right">{formatCurrency(costPerUnit)}</TableCell>
                                                            <TableCell className="text-right">{impact.toFixed(1)}%</TableCell>
                                                            <TableCell className="text-right font-semibold text-primary">{formatCurrency(cost)}</TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </AccordionContent>
                                </Card>
                            </AccordionItem>
                        );
                    })
                }
            </Accordion>
        </div>
        );
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
                                    <Button variant="outline" disabled={filteredSimulations.length === 0}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Exportar
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onSelect={handleExportGerencialPdf}>Relatório Gerencial (PDF)</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={handleExportGerencialCsv}>Relatório Gerencial (CSV)</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={handleExportXlsx}>Relatório Gerencial (XLSX)</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={handleExportPriceListPdf}>Lista de Preços (PDF)</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={handleExportPriceListCsv}>Lista de Preços (CSV)</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => alert("Exportação de PDF em atualização.")} disabled={filteredSimulations.length !== 1}>
                                      Ficha Completa (PDF)
                                      {filteredSimulations.length !== 1 && <span className="text-xs text-muted-foreground ml-2">(Selecione 1)</span>}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={handleExportFichaTecnicaSimplificadaPdf}>Ficha técnica simplificada (PDF)</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={handleExportFichaTecnicaSimplificadaCsv}>Ficha técnica simplificada (CSV)</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row items-center justify-between gap-2">
                         <div className="relative flex-grow w-full md:w-auto">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por mercadoria ou SKU..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 w-full"
                            />
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                            <Select value={kioskFilter} onValueChange={setKioskFilter}>
                                <SelectTrigger className="w-full">
                                <Warehouse className="mr-2 h-4 w-4 text-muted-foreground" />
                                <SelectValue placeholder="Filtrar por quiosque" />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="all">Todos os quiosques</SelectItem>
                                {kiosks.map(k => (
                                    <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                                ))}
                                </SelectContent>
                            </Select>

                           <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between">
                                        <Filter className="mr-2 h-4 w-4" />
                                        Filtros
                                        {totalActiveFilters > 0 && <Badge variant="secondary" className="ml-2 rounded-full px-1.5">{totalActiveFilters}</Badge>}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-56">
                                    <ScrollArea className="h-64">
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
                                         <DropdownMenuSeparator />
                                        <DropdownMenuLabel>Grupos</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {groups.map(group => (
                                            <DropdownMenuCheckboxItem
                                                key={group.id}
                                                checked={groupFilters.has(group.id)}
                                                onCheckedChange={() => handleFilterChange(group.id, 'group')}
                                                onSelect={(e) => e.preventDefault()}
                                            >
                                                {group.name}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </ScrollArea>
                                </DropdownMenuContent>
                            </DropdownMenu>
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between">
                                        <ArrowUpDown className="mr-2 h-4 w-4" />
                                        Ordenar por
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-56">
                                    <DropdownMenuRadioGroup value={`${sortConfig.key}-${sortConfig.direction}`} onValueChange={(v) => handleSort(v.split('-')[0] as SortKey)}>
                                        <DropdownMenuRadioItem value="name-asc">Nome (A-Z)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="name-desc">Nome (Z-A)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="sku-asc">SKU (Crescente)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="sku-desc">SKU (Decrescente)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="salePrice-desc">Preço (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="salePrice-asc">Preço (Menor-Maior)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="totalCmv-desc">Custo (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="totalCmv-asc">Custo (Menor-Maior)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitGoal-desc">Meta (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitGoal-asc">Meta (Menor-Maior)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitPercentage-desc">Margem (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitPercentage-asc">Margem (Menor-Maior)</DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
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

            <TechnicalSheetViewerModal
                open={isViewerModalOpen}
                onOpenChange={() => setSimulationToView(null)}
                simulation={simulationToView}
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
                filteredSimulations={filteredSimulations}
                selectedSimulationIds={selectedSimulations}
            />
        </div>
    );
}
