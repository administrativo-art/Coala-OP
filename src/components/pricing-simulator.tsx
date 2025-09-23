

"use client";

import { useState, useMemo } from "react";
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
    Trash2
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Badge } from "./ui/badge";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { PpoModal } from "./ppo-modal";
import { BatchEditSimulationModal } from "./batch-edit-simulation-modal";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { TechnicalSheetViewerModal } from "./technical-sheet-viewer-modal";


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name' | 'sku';
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
    const [isViewerModalOpen, setIsViewerModalOpen] = useState(false);
    const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);
    const [simulationToEdit, setSimulationToEdit] = useState<ProductSimulation | null>(null);
    const [simulationToView, setSimulationToView] = useState<ProductSimulation | null>(null);
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
        const filtered = simulations.filter(sim => {
            const searchMatch = searchTerm ? (sim.name.toLowerCase().includes(searchTerm.toLowerCase()) || (sim.ppo?.sku || '').toLowerCase().includes(searchTerm.toLowerCase())) : true;
            const categoryMatch = categoryFilters.size === 0 || (sim.categoryIds || []).some(catId => categoryFilters.has(catId));
            const lineMatch = lineFilters.size === 0 || (sim.lineId && lineFilters.has(sim.lineId));
            
            return searchMatch && categoryMatch && lineMatch;
        });
        
        return filtered.sort((a, b) => {
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

    const handleExportGerencialPdf = () => {
        const doc = new jsPDF('landscape');
        let yPos = 15;
    
        const addTitle = (title: string) => {
            if (yPos > 180) { doc.addPage(); yPos = 15; }
            doc.setFontSize(18);
            doc.text(title, 14, yPos);
            yPos += 8;
        };
    
        addTitle("Relatório Gerencial de Mercadorias");
        doc.setFontSize(9);
        doc.setTextColor(100);
        const filterText = `Filtros: ${searchTerm || 'nenhum'} | Categorias: ${categoryFilters.size > 0 ? Array.from(categoryFilters).map(id => categoryMap.get(id)?.name).join(', ') : 'todas'} | Linhas: ${lineFilters.size > 0 ? Array.from(lineFilters).map(id => categoryMap.get(id)?.name).join(', ') : 'todas'}`;
        doc.text(filterText, 14, yPos);
        yPos += 10;
    
        const tableHead = [['Mercadoria', 'SKU', 'Preço Venda', 'Custo Bruto', 'Lucro %', 'Markup', 'Meta', 'NCM', 'CEST', 'CFOP']];
        const tableBody = filteredSimulations.map(sim => [
            sim.name,
            sim.ppo?.sku || 'N/A',
            formatCurrency(sim.salePrice),
            formatCurrency(sim.grossCost),
            `${sim.profitPercentage.toFixed(2)}%`,
            `${sim.markup.toFixed(2)}x`,
            sim.profitGoal ? `${sim.profitGoal}%` : 'N/A',
            sim.ppo?.ncm || 'N/A',
            sim.ppo?.cest || 'N/A',
            sim.ppo?.cfop || 'N/A',
        ]);
    
        autoTable(doc, {
            startY: yPos,
            head: tableHead,
            body: tableBody,
            theme: 'grid',
            styles: { fontSize: 8 },
            headStyles: { fillColor: '#273344' },
        });
    
        doc.save(`relatorio_gerencial_mercadorias_${new Date().toISOString().slice(0,10)}.pdf`);
    };

    const handleExportGerencialCsv = () => {
        const dataForCsv = filteredSimulations.map(sim => ({
            'Mercadoria': sim.name,
            'SKU': sim.ppo?.sku || '',
            'Preço Venda': sim.salePrice,
            'Custo Bruto': sim.grossCost,
            'Lucro %': sim.profitPercentage,
            'Markup': sim.markup,
            'Meta Lucro %': sim.profitGoal || '',
            'NCM': sim.ppo?.ncm || '',
            'CEST': sim.ppo?.cest || '',
            'CFOP': sim.ppo?.cfop || '',
        }));

        const csv = Papa.unparse(dataForCsv, {
            quotes: true,
            delimiter: ",",
            header: true,
            decimalSeparator: '.'
        });

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
            'Custo Bruto': sim.grossCost,
            'Lucro %': sim.profitPercentage,
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

    const handleExportFichaTecnicaCompletaPdf = async () => {
        const doc = new jsPDF();
        let isFirstPage = true;
    
        const addSection = (title: string, yPos: number, isSub: boolean = false) => {
            doc.setFontSize(isSub ? 10 : 12);
            doc.setFont(undefined, 'bold');
            doc.text(title, 14, yPos);
            doc.setFont(undefined, 'normal');
            return yPos + (isSub ? 5 : 6);
        };

        for (const sim of filteredSimulations) {
            if (!isFirstPage) {
                doc.addPage();
            }
            isFirstPage = false;
            let yPos = 15;
            const pageHeight = doc.internal.pageSize.height;
            const pageWidth = doc.internal.pageSize.width;
    
            const hasImage = sim.ppo?.referenceImageUrl;
    
            if (hasImage) {
                try {
                    const img = new Image();
                    img.src = sim.ppo!.referenceImageUrl!;
                    await new Promise<void>(resolve => {
                        img.onload = () => resolve();
                        img.onerror = () => { console.error("Image failed to load"); resolve(); };
                    });
                    
                    const maxWidth = 50; 
                    let imgWidth = img.width;
                    let imgHeight = img.height;
    
                    if (imgWidth > maxWidth) {
                        imgHeight = (maxWidth / imgWidth) * imgHeight;
                        imgWidth = maxWidth;
                    }
                    
                    if (yPos + imgHeight > pageHeight - 20) { doc.addPage(); yPos = 15; }
    
                    const imageX = 14;
                    doc.addImage(sim.ppo!.referenceImageUrl!, 'JPEG', imageX, yPos, imgWidth, imgHeight);
                    
                    const textX = imageX + imgWidth + 5;
                    const textBlockWidth = pageWidth - textX - 14;
                    const textY = yPos + (imgHeight / 2);

                    doc.setFontSize(18);
                    doc.text(sim.name, textX, textY, { align: 'left', maxWidth: textBlockWidth, baseline: 'middle' });
                    
                    doc.setFontSize(9);
                    doc.setTextColor(100);
                    doc.text(`SKU: ${sim.ppo?.sku || 'N/A'}`, textX, textY + 6, { align: 'left', maxWidth: textBlockWidth });

                    yPos += imgHeight + 10;
    
                } catch (e) {
                    console.error("Failed to add image to PDF", e);
                }
            } else {
                doc.setFontSize(18);
                doc.text(sim.name, 14, yPos);
                yPos += 6;
                doc.setFontSize(9);
                doc.setTextColor(100);
                doc.text(`SKU: ${sim.ppo?.sku || 'N/A'}`, 14, yPos);
                yPos += 10;
            }
            
            const financialAndFiscalData = [
                ['Preço Venda', formatCurrency(sim.salePrice)],
                ['Custo Bruto', formatCurrency(sim.grossCost)],
                ['Lucro %', `${sim.profitPercentage.toFixed(2)}%`],
                ['Markup', `${sim.markup.toFixed(2)}x`],
                ['Meta', sim.profitGoal ? `${sim.profitGoal}%` : 'N/A'],
                ['NCM', sim.ppo?.ncm || 'N/A'],
                ['CEST', sim.ppo?.cest || 'N/A'],
                ['CFOP', sim.ppo?.cfop || 'N/A'],
            ];

            autoTable(doc, {
                startY: yPos,
                head: [['Informações de valor e fiscais', '']],
                body: financialAndFiscalData,
                theme: 'striped',
                headStyles: { fillColor: '#273344', fontStyle: 'bold' },
                columnStyles: { 0: { fontStyle: 'bold' } },
            });
            yPos = (doc as any).lastAutoTable.finalY + 10;
            
             const ingredients = simulationItems
                .filter(item => item.simulationId === sim.id)
                .map(item => {
                    const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                    return {
                        name: baseProduct?.name || 'Insumo não encontrado',
                        quantity: item.quantity,
                        unit: item.overrideUnit || baseProduct?.unit || 'un'
                    };
                });
            
            if (ingredients.length > 0) {
                if (yPos > 250) { doc.addPage(); yPos = 15; }
                yPos = addSection('Composição (Ingredientes)', yPos);
                autoTable(doc, {
                    startY: yPos,
                    head: [['Ingrediente', 'Quantidade']],
                    body: ingredients.map(i => [i.name, `${i.quantity} ${i.unit}`]),
                    theme: 'striped',
                });
                yPos = (doc as any).lastAutoTable.finalY + 10;
            }

            if (sim.ppo?.assemblyInstructions && sim.ppo.assemblyInstructions.length > 0) {
                 if (yPos > 250) { doc.addPage(); yPos = 15; }
                 yPos = addSection('Modo de Montagem', yPos);

                for (const phase of sim.ppo.assemblyInstructions) {
                    if (yPos > 260) { doc.addPage(); yPos = 15; }
                    yPos = addSection(phase.name, yPos, true);

                    for (const [index, etapa] of phase.etapas.entries()) {
                        if (yPos > 270) { doc.addPage(); yPos = 15; }
                        const qtyText = (etapa.quantity && etapa.unit) ? `(${etapa.quantity} ${etapa.unit})` : '';
                        const stepText = `${index + 1}. ${etapa.text} ${qtyText}`;
                        const textDimensions = doc.getTextDimensions(stepText, { maxWidth: 180 });
                        if (yPos + textDimensions.h > pageHeight - 20) { doc.addPage(); yPos = 15; }
                        doc.text(stepText, 16, yPos, { maxWidth: 180 });
                        yPos += textDimensions.h + 2;
                    }
                }
                 yPos += 5;
            }

            if (sim.ppo?.assemblyVideoUrl) {
                if (yPos > 270) { doc.addPage(); yPos = 15; }
                doc.setFontSize(10);
                doc.textWithLink('Link para o vídeo de montagem', 14, yPos, { url: sim.ppo.assemblyVideoUrl });
                yPos += 10;
            }

             const details = [
                 ...(sim.ppo?.preparationTime ? [['Tempo de Preparo', `${sim.ppo.preparationTime} seg`]] : []),
                 ...(sim.ppo?.portionWeight ? [['Peso da Porção', `${sim.ppo.portionWeight}g (Tolerância: ±${sim.ppo.portionTolerance || 0}g)`]] : []),
                 ...(sim.ppo?.qualityStandard?.length ? [['Padrão de Qualidade', sim.ppo.qualityStandard.map(q => q.text).join('; ')]] : []),
                 ...(sim.ppo?.allergens?.length ? [['Alergênicos', sim.ppo.allergens.map(a => a.text).join(', ')]] : []),
            ].filter(d => d[1]);

             if (details.length > 0) {
                if (yPos > 240) { doc.addPage(); yPos = 15; }
                yPos = addSection('Detalhes Adicionais', yPos);
                autoTable(doc, {
                    startY: yPos,
                    body: details,
                    theme: 'plain',
                    styles: { cellPadding: 2, fontSize: 9 },
                    columnStyles: { 0: { fontStyle: 'bold' } },
                });
            }
        }
    
        doc.save(`fichas_tecnicas_completas_${new Date().toISOString().slice(0,10)}.pdf`);
    };

    const handleExportFichaTecnicaSimplificadaPdf = () => {
        const doc = new jsPDF();
        let yPos = 15;

        filteredSimulations.forEach((sim, index) => {
            if (index > 0) {
                doc.addPage();
                yPos = 15;
            }
            
            doc.setFontSize(16);
            doc.text('Ficha técnica simplificada', 14, yPos);
            yPos += 10;

            const hasImage = sim.ppo?.referenceImageUrl;
            if (hasImage) {
                try {
                    const img = new Image();
                    img.src = sim.ppo!.referenceImageUrl!;
                    const imgWidth = 30;
                    const imgHeight = (img.height * imgWidth) / img.width;
                    doc.addImage(sim.ppo!.referenceImageUrl!, 'JPEG', 14, yPos, imgWidth, imgHeight);
                    yPos += imgHeight + 5;
                } catch (e) {
                    console.error("Failed to add image to PDF", e);
                }
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text(sim.name, 14, yPos);
            yPos += 8;


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
        filteredSimulations.forEach((sim, simIndex) => {
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

            if (simIndex < filteredSimulations.length - 1) {
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
        setSelectedSimulations(isSelected ? new Set(filteredSimulations.map(p => p.id)) : new Set());
    };
    
    const allFilteredSelected = filteredSimulations.length > 0 && selectedSimulations.size === filteredSimulations.length;

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
                                        {simCategories.map(cat => (
                                            <Badge key={cat.id} variant="secondary" style={{ backgroundColor: cat.color, color: 'white' }}>{cat.name}</Badge>
                                        ))}
                                        {line && <Badge variant="outline">{line.name}</Badge>}
                                        {simGroups.map(group => (
                                            <Badge key={group.id} variant="outline" style={{ borderColor: group.color, color: group.color }}>{group.name}</Badge>
                                        ))}
                                    </div>
                                    <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2" />
                                </div>
                                <div className="grid grid-cols-6 items-center px-4 py-3">
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Preço</p>
                                        <p className="font-bold">{formatCurrency(sim.salePrice)}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Custo</p>
                                        <p>{formatCurrency(sim.grossCost)}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Markup</p>
                                        <p>{sim.markup.toFixed(1)}x</p>
                                    </div>
                                     <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Meta</p>
                                        <p className="font-medium text-muted-foreground">{sim.profitGoal ? `${sim.profitGoal}%` : '-'}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-muted-foreground">Lucro</p>
                                        <p className={cn("font-bold text-lg", profitColorClass)}>{sim.profitPercentage.toFixed(2)}%</p>
                                    </div>
                                    <div className="flex justify-center items-center gap-2">
                                        {sim.profitGoal !== undefined && sim.profitGoal !== null ? (
                                            meetsGoal ? <CheckCircle2 className="h-5 w-5 text-green-500"/> : <AlertTriangle className="h-5 w-5 text-orange-500"/>
                                        ) : <div className="h-5 w-5"/>}
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menu</span><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleEdit(sim)}><Edit className="mr-2 h-4 w-4" /> Editar Análise</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleViewTechnicalSheet(sim)}><Eye className="mr-2 h-4 w-4" /> Ver Ficha Técnica</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handlePpoClick(sim)}><FileText className="mr-2 h-4 w-4" /> Editar ficha</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(sim.id)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
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
                                                    const baseProductInfo = baseProductMap.get(item.baseProductId);
                                                    const cost = (item.overrideCostPerUnit || 0) * item.quantity;
                                                    const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
                                                    return (
                                                        <TableRow key={item.id}>
                                                            <TableCell>{baseProductInfo?.name || 'Insumo não encontrado'}</TableCell>
                                                            <TableCell>{item.quantity} {item.overrideUnit || baseProductInfo?.unit}</TableCell>
                                                            <TableCell className="text-right">{formatCurrency(item.overrideCostPerUnit || 0)}</TableCell>
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
                                    <DropdownMenuItem onSelect={handleExportFichaTecnicaCompletaPdf}>Ficha técnica completa (PDF)</DropdownMenuItem>
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
                                    </ScrollArea>
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
                onOpenChange={setIsViewerModalOpen}
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
