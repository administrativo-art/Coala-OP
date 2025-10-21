
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';


const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

type SortKey = keyof ProductSimulation | 'name' | 'sku' | 'salePrice' | 'grossCost' | 'profitGoal' | 'profitPercentage';
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
    const [isArchivedModalOpen, setIsArchivedModalOpen] = useState(false);
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
    
    const handleReactivate = async (simulation: ProductSimulation) => {
        await bulkUpdateSimulations([simulation], {
            line: { action: 'keep' },
            category: { action: 'keep' },
            group: { action: 'keep' },
            price: { action: 'keep', type: 'fixed', value: 0 },
            ncm: { action: 'keep' },
            cest: { action: 'keep' },
            cfop: { action: 'keep' },
        });
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

    const { activeSimulations, inactiveSimulations } = useMemo(() => {
        const active: ProductSimulation[] = [];
        const inactive: ProductSimulation[] = [];
        simulations.forEach(sim => {
            if (sim.status === 'active' || !sim.status) { // CORRECTED LOGIC
                active.push(sim);
            } else {
                inactive.push(sim);
            }
        });
        return { activeSimulations: active, inactiveSimulations: inactive };
    }, [simulations]);

    const filteredSimulations = useMemo(() => {
        const filtered = activeSimulations.filter(sim => {
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

    }, [activeSimulations, searchTerm, categoryFilters, lineFilters, sortConfig]);

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
        doc.setFontSize(18);
        doc.text(`Relatório Gerencial de Mercadorias`, 14, 22);
    
        const head = [['Mercadoria', 'SKU', 'Preço Venda', 'Custo Bruto', 'Lucro %', 'Markup', 'Meta Lucro %', 'NCM', 'CEST', 'CFOP']];
        const body = filteredSimulations.map(sim => [
            sim.name,
            sim.ppo?.sku || '',
            formatCurrency(sim.salePrice),
            formatCurrency(sim.grossCost),
            `${sim.profitPercentage.toFixed(2)}%`,
            `${sim.markup.toFixed(1)}x`,
            sim.profitGoal ? `${sim.profitGoal}%` : '-',
            sim.ppo?.ncm || '',
            sim.ppo?.cest || '',
            sim.ppo?.cfop || '',
        ]);
    
        autoTable(doc, {
            startY: 30,
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [39, 51, 68] },
            styles: { fontSize: 8 },
        });
    
        doc.save(`relatorio_gerencial_${new Date().toISOString().slice(0, 10)}.pdf`);
    };

    const handleExportFichaTecnicaCompletaPdf = async (sim: ProductSimulation) => {
        const doc = new jsPDF();
        const pageMargin = 14;
        const pageContentWidth = doc.internal.pageSize.getWidth() - 2 * pageMargin;
        let yPos = 15;
    
        const snap = (n: number) => Math.round(n * 100) / 100;
    
        // ---------- HELPERS (topo da função) ----------
        const addSectionTitle = (title: string, currentY: number) => {
            if (currentY > 260) { doc.addPage(); currentY = 15; }
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0);
            doc.text(title, pageMargin, currentY);
            doc.setFont(undefined, 'normal');
            return currentY + 8;
        };
    
        const roundedRect = (x: number, y: number, w: number, h: number, r = 3, style: 'S'|'F'|'DF' = 'S') => {
            (doc as any).roundedRect(x, y, w, h, r, r, style);
        };
    
        const ensureSpace = (needed: number) => {
            if (yPos + needed > 275) { doc.addPage(); yPos = 15; }
        };
    
        const measureCardH = (value: string, w: number) => {
          doc.setFontSize(12); doc.setFont(undefined, 'bold');
          const lines = doc.splitTextToSize(value || '—', w - 10);
          const h = (doc.getTextDimensions(lines as any).h || 0);
          return Math.max(18, 12 + h);
        };
        
        const drawInfoCard = (x: number, y: number, w: number, h: number, label: string, value: string, opts?: { highlight?: boolean }) => {
          doc.setDrawColor(226);
          if (opts?.highlight) doc.setFillColor(254, 249, 195);
          else doc.setFillColor(255, 255, 255);
          roundedRect(x, y, w, h, 1.8, 'DF');
          doc.setFontSize(10);
          doc.setTextColor(100);
          doc.setFont(undefined, 'normal');
          doc.text(label, x + 5, y + 7);
          doc.setFontSize(12);
          doc.setTextColor(17, 24, 39);
          doc.setFont(undefined, 'bold');
          const maxTextWidth = w - 10;
          const lines = doc.splitTextToSize(value || '—', maxTextWidth);
          doc.text(lines as any, x + 5, y + 14);
        };

        const measureStepTextH = (txt: string, maxW: number) => {
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            const lines = doc.splitTextToSize(txt, maxW);
            return { lines, h: doc.getTextDimensions(lines as any).h || 4 };
        };
        
        // ---------- CABEÇALHO ----------
        const hasImage = sim.ppo?.referenceImageUrl;
        let textX = pageMargin;
        let headerStartY = yPos;
        
        if (hasImage) {
            try {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = sim.ppo!.referenceImageUrl!;
                await new Promise(resolve => { img.onload = resolve; img.onerror = () => resolve(null); });
    
                if (img.width > 0) {
                    const box = 40;
                    const aspect = img.width / img.height;
                    let imgW = box;
                    let imgH = box / aspect;
                    if (imgH > box) { imgH = box; imgW = box * aspect; }
                    
                    yPos = headerStartY + imgH + 10;
    
                    doc.addImage(img, 'JPEG', pageMargin, headerStartY, imgW, imgH);
                    textX = pageMargin + imgW + 10;
    
                    const titleY = headerStartY + (imgH / 2) - 3;
                    doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.setTextColor(0);
                    doc.text(sim.name, textX, titleY);
                    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(100);
                    doc.text(`SKU: ${sim.ppo?.sku || 'N/A'}`, textX, titleY + 6);
                }
            } catch { yPos += 25; }
        } else {
            doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.setTextColor(0);
            doc.text(sim.name, textX, yPos + 7);
            doc.setFontSize(9); doc.setTextColor(100); doc.setFont(undefined, 'normal');
            doc.text(`SKU: ${sim.ppo?.sku || 'N/A'}`, textX, yPos + 13);
            yPos += 25;
        }
    
        // ---------- INFORMAÇÕES DE VENDA E FISCAIS ----------
        const infoItems: Array<{label: string; value: string}> = [
            { label: 'Preço de Venda', value: formatCurrency(sim.salePrice) },
            { label: 'Markup', value: `${sim.markup.toFixed(2)}x` },
            { label: 'Custo Bruto', value: formatCurrency(sim.grossCost) },
            { label: 'NCM', value: sim.ppo?.ncm || '—' },
            { label: 'Lucro Bruto', value: `${formatCurrency(sim.profitValue)} (${sim.profitPercentage.toFixed(2)}%)` },
            { label: 'CEST', value: sim.ppo?.cest || '—' },
            { label: 'CFOP', value: sim.ppo?.cfop || '—' },
        ];
        
        const padX_info = 8;
        const padTop_info = 10;
        const titleH_info = 10;
        const titleGap_info = 4;
        const rowGap_info = 6;
        
        const gridTopY_info = yPos + padTop_info + titleH_info + titleGap_info;
        const twoCols = (padX: number, gap: number) => {
            const SAFE = 0.6;
            const innerLeft  = pageMargin + padX + SAFE;
            const innerRight = pageMargin + pageContentWidth - padX - SAFE;
            let colW = (innerRight - innerLeft - gap) / 2;
            colW = Math.floor(colW * 100) / 100;
            const xLeft  = Math.floor(innerLeft * 100) / 100;
            const xRight = Math.floor((innerRight - colW) * 100) / 100;
            return { colW, xLeft, xRight };
        };
        const g_info = twoCols(padX_info, 8);
        
        const rowHeights_info = [];
        for (let i = 0; i < infoItems.length; i += 2) {
            const hL = measureCardH(infoItems[i]?.value || '', g_info.colW);
            const hR = infoItems[i + 1] ? measureCardH(infoItems[i + 1]?.value || '', g_info.colW) : 0;
            rowHeights_info.push(Math.max(hL, hR));
        }
        
        const totalGridHeight_info = rowHeights_info.reduce((sum, h) => sum + h, 0) + Math.max(0, rowHeights_info.length - 1) * rowGap_info;
        const boxH_info = padTop_info + titleH_info + titleGap_info + totalGridHeight_info + 10;
    
        ensureSpace(boxH_info + 8);
        doc.setFillColor(248, 250, 252); doc.setDrawColor(226);
        roundedRect(pageMargin, yPos, pageContentWidth, boxH_info, 4, 'DF');
        doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(39, 51, 68);
        doc.text('Informações de Venda e Fiscais', pageMargin + padX_info, yPos + padTop_info + 3);
    
        let gridY_info = gridTopY_info;
        let idx_info = 0;
        for (const hRow of rowHeights_info) {
            const xLeft = snap(g_info.xLeft);
            const xRight = snap(g_info.xRight);
            if (idx_info < infoItems.length) drawInfoCard(xLeft, gridY_info, g_info.colW, hRow, infoItems[idx_info].label, infoItems[idx_info++].value);
            if (idx_info < infoItems.length) drawInfoCard(xRight, gridY_info, g_info.colW, hRow, infoItems[idx_info++].label, infoItems[idx_info++].value);
            gridY_info += hRow + rowGap_info;
        }
        yPos += boxH_info + 8;
    
        // ---------- COMPOSIÇÃO (CMV) ----------
        const ingredients = simulationItems
            .filter(item => item.simulationId === sim.id)
            .map(item => {
                const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                const costPerUnit = item.overrideCostPerUnit ?? 0;
                const qty = item.quantity;
                const cost = costPerUnit * qty;
                const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
                return { name: baseProduct?.name || 'Insumo não encontrado', qtyStr: `${qty} ${item.overrideUnit || baseProduct?.unit || 'un'}`, cpuStr: formatCurrency(costPerUnit), impact, cost };
            })
            .sort((a, b) => b.cost - a.cost)
            .map(row => [row.name, row.qtyStr, row.cpuStr, `${row.impact.toFixed(1)}%`, formatCurrency(row.cost)]);
    
        if (ingredients.length > 0) {
            yPos = addSectionTitle('Composição (CMV)', yPos);
            autoTable(doc, { startY: yPos, head: [['Insumo', 'Quantidade', 'Custo/unid.', 'Impacto', 'Custo Total']], body: ingredients, theme: 'striped', headStyles: { fillColor: [39, 51, 68], textColor: 255 }, styles: { fontSize: 10, fillColor: [255,255,255] }, alternateRowStyles: { fillColor: [246,248,250] } });
            yPos = (doc as any).lastAutoTable.finalY + 10;
        }
    
        // ---------- MODO DE MONTAGEM (sem círculos, sem imagens, com medidas) ----------
        if (sim.ppo?.assemblyInstructions && sim.ppo.assemblyInstructions.length > 0) {
            yPos = addSectionTitle('Modo de Montagem', yPos);
            let blockY = yPos;
        
            const phaseTitleH = 12;
            const gapBetweenSteps = 6;
            const lineColor = 226;
        
            for (const fase of sim.ppo.assemblyInstructions) {
                // Título da fase (caixa suave)
                ensureSpace(phaseTitleH + 6);
                doc.setFillColor(248, 250, 252);
                doc.setDrawColor(226);
                (doc as any).roundedRect(pageMargin, blockY, pageContentWidth, phaseTitleH, 3, 3, 'DF');
        
                // Título centralizado VERTICALMENTE e justificado
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(39, 51, 68);
                const _baseline = doc.getFontSize() * 0.32;
                const titleY = blockY + phaseTitleH / 2 + _baseline;
                doc.text(fase.name || 'Fase', pageMargin + 6, titleY, {
                    align: 'justify',
                    maxWidth: pageContentWidth - 12
                });
        
                blockY += phaseTitleH + 4; // respiro abaixo do título
        
                // Etapas (somente texto, sem imagens nem badges)
                doc.setFont(undefined, 'normal');
                doc.setTextColor(0);

                const SEP_INSET_L = pageMargin + 5;
                const SEP_INSET_R = doc.internal.pageSize.getWidth() - pageMargin - 5;
                const PAD_TOP = 6;
                const PAD_BOTTOM = 6;
                const textStartX = pageMargin + 6;
                const maxTextW = pageContentWidth - 12;

                for (let i = 0; i < fase.etapas.length; i++) {
                    const etapa = fase.etapas[i];

                    if (i > 0) {
                        doc.setDrawColor(226);
                        doc.setLineDash([1], 0);
                        doc.line(SEP_INSET_L, blockY, SEP_INSET_R, blockY);
                        doc.setLineDash();
                    }

                    const qty = (etapa.quantity ?? (etapa as any).qty ?? (etapa as any).quantidade ?? (etapa as any).amount ?? (etapa as any).medida ?? (etapa as any).qtd) as number | string | undefined;
                    const unit = (etapa.unit ?? (etapa as any).unidade ?? (etapa as any).units ?? (etapa as any).sigla) as string | undefined;
                    const extraSize = (etapa.size ?? (etapa as any).tamanho) as string | undefined;
              
                    let measureStr = '';
                    if (qty !== undefined && qty !== null && `${qty}`.trim() !== '') {
                      measureStr = `${qty}${unit ? ` ${unit}` : ''}`;
                    } else if (extraSize) {
                      measureStr = extraSize;
                    }
              
                    const coreText = (etapa.text || '').trim();
                    const stepLabel = measureStr ? `${i + 1}. ${coreText} (${measureStr})` : `${i + 1}. ${coreText}`;
                    
                    doc.setFontSize(10);
                    const lines = doc.splitTextToSize(stepLabel, maxTextW);
                    const textH = doc.getTextDimensions(lines as any).h || 4;

                    const rowH = PAD_TOP + textH + PAD_BOTTOM;
                    ensureSpace(rowH + 1);

                    const textY = blockY + PAD_TOP + (rowH - PAD_TOP - PAD_BOTTOM - textH) / 2 + textH * 0.32;

                    doc.text(lines as any, textStartX, textY, {
                        align: 'justify',
                        maxWidth: maxTextW
                    });

                    blockY += rowH;
                    doc.setDrawColor(226);
                    doc.setLineDash([1], 0);
                    doc.line(SEP_INSET_L, blockY, SEP_INSET_R, blockY);
                    doc.setLineDash();

                    const note = ((etapa as any).note || (etapa as any).obs || (etapa as any).observacao || '').trim();
                    if (note) {
                        const nLines = doc.splitTextToSize(note, pageContentWidth - 10);
                        const nH = doc.getTextDimensions(nLines as any).h || 4;
                        ensureSpace(nH + 3);
                        doc.setFontSize(9);
                        doc.setFont(undefined, 'italic');
                        doc.setTextColor(100);
                        doc.text(nLines as any, pageMargin + 6, blockY + 3);
                        blockY += nH + 3;
                        doc.setFont(undefined, 'normal');
                        doc.setTextColor(0);
                    }
                }
                blockY += 2;
            }
            yPos = blockY;
        }

        // ---------- VÍDEO ----------
        if (sim.ppo?.assemblyVideoUrl) {
            const boxH = 24;
            ensureSpace(boxH + 4);
            doc.setFillColor(230, 240, 250); doc.setDrawColor(200);
            roundedRect(pageMargin, yPos, pageContentWidth, boxH, 3, 'DF');
            doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(39, 51, 68);
            doc.text('Vídeo de montagem', pageMargin + 6, yPos + 9);
            const linkLabel = 'Abrir vídeo';
            const linkY = yPos + 16;
            doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(0, 0, 238);
            doc.text(linkLabel, pageMargin + 6, linkY);
            const labelW = doc.getTextWidth(linkLabel);
            doc.link(pageMargin + 6, linkY - 4, labelW, 6, { url: sim.ppo.assemblyVideoUrl });
            doc.setTextColor(0);
            yPos += boxH + 6;
        }
    
        // ---------- DETALHES ADICIONAIS ----------
        const detalhesBrutos = [
            sim.ppo?.preparationTime ? { label: 'Tempo de Preparo', value: `${sim.ppo.preparationTime} seg` } : null,
            sim.ppo?.portionWeight ? { label: 'Peso da Porção', value: `${sim.ppo.portionWeight}g (±${sim.ppo.portionTolerance || 0}g)` } : null,
            (sim.ppo?.qualityStandard?.length ?? 0 > 0) ? { label: 'Padrões de Qualidade', value: sim.ppo!.qualityStandard!.map(q => q.text).join('\\n') } : null,
            sim.ppo?.allergens?.length ? { label: 'Alergênicos', value: sim.ppo.allergens.map(a => a.text).join(', '), highlight: true } : null,
        ];
        const detalhes = detalhesBrutos.filter(Boolean).filter(d => d && typeof d.value === 'string' && !/^https?:\/\//i.test(d.value)) as Array<{label: string; value: string; highlight?: boolean}>;
    
        if (detalhes.length > 0) {
            const padX2 = 8;
            const padTop2 = 10;
            const titleH2 = 10;
            const titleGap2 = 4;
            const rowGap2 = 6;
            const gridTopY2 = yPos + padTop2 + titleH2 + titleGap2;

            const g2 = twoCols(padX2, 8);
            
            const rowHeights2: number[] = [];
            for (let i = 0; i < detalhes.length; i += 2) {
                const hL = measureCardH(detalhes[i]?.value || '', g2.colW);
                const hR = detalhes[i + 1] ? measureCardH(detalhes[i + 1]?.value || '', g2.colW) : 0;
                rowHeights2.push(Math.max(hL, hR));
            }
            
            const totalGridHeight2 = rowHeights2.reduce((sum, h) => sum + h, 0) + Math.max(0, rowHeights2.length - 1) * rowGap2;
            const innerH2 = padTop2 + titleH2 + titleGap2 + totalGridHeight2 + 10;
    
            ensureSpace(innerH2 + 4);
            doc.setFillColor(248, 250, 252); doc.setDrawColor(226);
            roundedRect(pageMargin, yPos, pageContentWidth, innerH2, 4, 'DF');
            doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(39, 51, 68);
            doc.text('Detalhes Adicionais', pageMargin + padX2, yPos + padTop2);
    
            let gy = gridTopY2;
            let di = 0;
            for (const hRow of rowHeights2) {
                const xL = snap(g2.xLeft);
                const xR = snap(g2.xRight);
                if (di < detalhes.length) { const it = detalhes[di++]; drawInfoCard(xL, gy, g2.colW, hRow, it.label, it.value, { highlight: it.highlight }); }
                if (di < detalhes.length) { const it = detalhes[di++]; drawInfoCard(xR, gy, g2.colW, hRow, it.label, it.value, { highlight: it.highlight }); }
                gy += hRow + rowGap2;
            }
            yPos += innerH2 + 6;
        }
    
        // ---------- FOOTER ----------
        const pages = (doc as any).getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
            doc.setPage(p);
            doc.setFontSize(8); doc.setTextColor(100);
            const footer = `${sim.name} · pág. ${p}/${pages} · ${new Date().toLocaleDateString('pt-BR')}`;
            doc.text(footer, pageMargin, doc.internal.pageSize.getHeight() - 6);
        }
    
        doc.save(`ficha_tecnica_${sim.name.replace(/ /g, '_')}.pdf`);
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
                                                <DropdownMenuItem onClick={() => handleViewTechnicalSheet(sim)}><Eye className="mr-2 h-4 w-4" />Ver Ficha Técnica</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleEdit(sim)}><Edit className="mr-2 h-4 w-4" /> Editar Análise</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handlePpoClick(sim)}><FileText className="mr-2 h-4 w-4" /> Editar ficha</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleExportFichaTecnicaCompletaPdf(sim)}><Download className="mr-2 h-4 w-4" />Baixar Ficha Completa</DropdownMenuItem>
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
                                    <DropdownMenuItem onSelect={() => handleExportFichaTecnicaCompletaPdf(filteredSimulations[0])} disabled={filteredSimulations.length !== 1}>
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
                                        <DropdownMenuRadioItem value="grossCost-desc">Custo (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="grossCost-asc">Custo (Menor-Maior)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitGoal-desc">Meta (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitGoal-asc">Meta (Menor-Maior)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitPercentage-desc">Lucro (Maior-Menor)</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="profitPercentage-asc">Lucro (Menor-Maior)</DropdownMenuRadioItem>
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
                 <ArchivedSimulationsModal 
                    open={isArchivedModalOpen} 
                    onOpenChange={setIsArchivedModalOpen} 
                    simulations={inactiveSimulations}
                    onReactivate={handleReactivate}
                />
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

function ArchivedSimulationsModal({ open, onOpenChange, simulations, onReactivate }: { open: boolean, onOpenChange: (open: boolean) => void, simulations: ProductSimulation[], onReactivate: (sim: ProductSimulation) => void }) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mercadorias Inativas</DialogTitle>
            <DialogDescription>
              Visualize ou reative mercadorias que foram marcadas como inativas.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96">
            <div className="space-y-2 p-1">
              {simulations.length > 0 ? (
                simulations.map(sim => (
                  <div key={sim.id} className="flex items-center justify-between p-2 border rounded-md">
                    <span className="font-medium">{sim.name}</span>
                    <Button size="sm" variant="outline" onClick={() => onReactivate(sim)}>
                      Reativar
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-10">
                  Nenhuma mercadoria inativa.
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
}
    

      

    

    
