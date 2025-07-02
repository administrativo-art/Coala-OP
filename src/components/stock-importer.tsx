
"use client"

import React, { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useStockAnalysis } from '@/hooks/use-stock-analysis';
import { useConsumptionAnalysis } from '@/hooks/use-consumption-analysis';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadCloud, AlertCircle, FileClock, Trash2, Loader2, Send, Settings, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { type StockAnalysisReport, type ConsumptionReport, type StockAnalysisResultItem, type DistributionItem, type Product } from '@/types';
import { type MoveLotParams } from './expiry-products-provider';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ItemManagement } from './item-management';

const importSchema = z.object({
  kioskId: z.string().min(1, { message: "Por favor, selecione um quiosque." }),
});

type ImportFormValues = z.infer<typeof importSchema>;

export function StockAnalyzer() {
    const { user, permissions } = useAuth();
    const { kiosks } = useKiosks();
    const { history: stockHistory, loading: stockHistoryLoading, addReport: addStockReport, deleteReport: deleteStockReport, updateReport: updateStockReport } = useStockAnalysis();
    const { history: consumptionHistory, loading: consumptionHistoryLoading, addReport: addConsumptionReport, deleteReport: deleteConsumptionReport } = useConsumptionAnalysis();
    const { products, getProductFullName, loading: productsLoading } = useProducts();
    const { lots: allLots, loading: lotsLoading, moveMultipleLots } = useExpiryProducts();
    const { toast } = useToast();

    const [stockReportToDelete, setStockReportToDelete] = useState<StockAnalysisReport | null>(null);
    const [consumptionReportToDelete, setConsumptionReportToDelete] = useState<ConsumptionReport | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isItemManagementOpen, setIsItemManagementOpen] = useState(false);

    const form = useForm<ImportFormValues>({
        resolver: zodResolver(importSchema),
        defaultValues: { kioskId: '' }
    });
    
    const findProductByName = (baseName: string): Product | undefined => {
        return products.find(p => p.baseName.toLowerCase() === baseName.toLowerCase());
    }

    const generateDistributionSuggestion = (
        neededInBaseUnit: number,
        productBaseName: string,
        destinationKioskId: string
    ): Omit<StockAnalysisResultItem, keyof Omit<StockAnalysisResultItem, 'statusMessage' | 'isActionable' | 'distributionSuggestion'>> => {
        const sourceKioskId = 'matriz';

        const productVariations = products.filter(p => p.baseName === productBaseName);
        if (productVariations.length === 0) {
             return { statusMessage: `Nenhuma variação de produto físico encontrada para "${productBaseName}".`, isActionable: false, distributionSuggestion: [] };
        }
        const productVariationIds = productVariations.map(p => p.id);

        const availableLots = allLots.filter(lot => 
            lot.kioskId === sourceKioskId && productVariationIds.includes(lot.productId)
        ).sort((a,b) => parseISO(a.expiryDate).getTime() - parseISO(b.expiryDate).getTime());

        if (availableLots.length === 0) {
            return { statusMessage: `Sem estoque de ${productBaseName} no Centro de Distribuição.`, isActionable: false, distributionSuggestion: [] };
        }

        let remainingNeeded = neededInBaseUnit;
        const suggestion: DistributionItem[] = [];

        for (const lot of availableLots) {
            if (remainingNeeded <= 0) break;

            const productDetails = products.find(p => p.id === lot.productId);
            if (!productDetails) continue;

            const packageValueInBaseUnit = productDetails.packageSize;
            const availablePackages = lot.quantity;
            
            const neededPackages = Math.ceil(remainingNeeded / packageValueInBaseUnit);
            const packagesToTake = Math.min(availablePackages, neededPackages);
            
            if (packagesToTake > 0) {
                suggestion.push({
                    lotId: lot.id,
                    productId: productDetails.id,
                    productName: getProductFullName(productDetails),
                    fromKioskId: sourceKioskId,
                    quantityToMove: packagesToTake,
                    baseUnitValue: packageValueInBaseUnit * packagesToTake,
                    baseUnit: productDetails.unit,
                    lotNumber: lot.lotNumber,
                    expiryDate: lot.expiryDate,
                });
                remainingNeeded -= (packagesToTake * packageValueInBaseUnit);
            }
        }
        
        if (remainingNeeded > 0) {
             const productUnit = productVariations[0]?.unit || '';
            return { statusMessage: `Estoque insuficiente no CD. Faltam ${remainingNeeded.toLocaleString()}${productUnit} de ${productBaseName}.`, isActionable: suggestion.length > 0, distributionSuggestion: suggestion };
        }

        return { statusMessage: 'Sugestão de distribuição gerada com sucesso.', isActionable: true, distributionSuggestion: suggestion };
    };

    const parseQuantity = (qtyString: string | number) => {
        if (typeof qtyString === 'number') return qtyString;
        if (typeof qtyString !== 'string') return 0;
        return parseFloat(qtyString.replace(/\./g, '').replace(',', '.')) || 0;
    };


    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        const kioskId = form.getValues('kioskId');

        if (!file || !kioskId) {
            toast({ variant: "destructive", title: "Erro", description: "Selecione um quiosque e um arquivo." });
            return;
        }

        setIsAnalyzing(true);
        const { id: toastId } = toast({
            title: "Processando planilha...",
            description: "Aguarde enquanto analisamos seu relatório de estoque.",
        });

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const rows = results.data as any[];
                    if (rows.length === 0) throw new Error("A planilha está vazia ou em formato inválido.");
                    
                    const kiosk = kiosks.find(k => k.id === kioskId);
                    if (!kiosk) throw new Error("Quiosque selecionado não foi encontrado.");

                    const analysisResults: StockAnalysisResultItem[] = [];
                    const unmatchedItems: string[] = [];

                    for (const row of rows) {
                        const itemName = row['Item']?.trim();
                        if (!itemName) continue;

                        const product = findProductByName(itemName);
                        if (!product) {
                            unmatchedItems.push(itemName);
                            continue;
                        }

                        const currentStockInBaseUnit = parseQuantity(row['Qtde.']);
                        const stockLevels = product.stockLevels?.[kiosk.id];
                        const minStock = stockLevels?.min ?? 0;
                        const maxStock = stockLevels?.max ?? 0;

                        const neededInBaseUnit = currentStockInBaseUnit < minStock ? maxStock - currentStockInBaseUnit : 0;
                        
                        const suggestionDetails = neededInBaseUnit > 0 
                            ? generateDistributionSuggestion(neededInBaseUnit, product.baseName, kiosk.id)
                            : { statusMessage: 'Estoque OK.', isActionable: false, distributionSuggestion: [] };
                        
                        analysisResults.push({
                            productId: product.id,
                            productName: product.baseName,
                            kioskId: kiosk.id,
                            kioskName: kiosk.name,
                            currentStockInBaseUnit,
                            maxStockInBaseUnit: maxStock,
                            neededInBaseUnit,
                            ...suggestionDetails,
                        });
                    }

                    if (unmatchedItems.length > 0) {
                        toast({
                            variant: "destructive",
                            title: "Itens não encontrados",
                            description: `Os seguintes itens da planilha não foram encontrados no sistema e foram ignorados: ${unmatchedItems.join(', ')}`,
                            duration: 8000
                        });
                    }

                    const itemsWithNeed = analysisResults.filter(r => r.neededInBaseUnit > 0).length;
                    const summary = `Analisados ${analysisResults.length} itens do relatório, dos quais ${itemsWithNeed} precisam de reposição.`;
                    
                    const analysisDate = format(new Date(), "dd/MM/yyyy", { locale: ptBR });
                    const displayName = `${kiosk.name} - ${analysisDate}`;

                    await addStockReport({
                        reportName: file.name,
                        displayName,
                        createdAt: new Date().toISOString(),
                        status: 'completed',
                        summary,
                        results: analysisResults,
                    });

                    toast({ id: toastId, title: "Análise concluída!", description: summary });

                } catch (error: any) {
                    console.error("Stock analysis failed:", error);
                    toast({ id: toastId, variant: "destructive", title: "Falha na análise", description: error.message || "Não foi possível processar o relatório de estoque." });
                } finally {
                    setIsAnalyzing(false);
                    if(fileInputRef.current) fileInputRef.current.value = "";
                }
            }
        });
    };

    const handleImportClick = () => {
        form.trigger('kioskId').then(isValid => {
            if (isValid) {
                fileInputRef.current?.click();
            }
        });
    };

    const executeDistribution = async (reportId: string, resultItem: StockAnalysisResultItem) => {
        if (!user || !resultItem.isActionable || !resultItem.distributionSuggestion) return;
        
        const params: MoveLotParams[] = resultItem.distributionSuggestion.map(item => ({
            lotId: item.lotId,
            toKioskId: resultItem.kioskId,
            quantityToMove: item.quantityToMove,
            fromKioskId: item.fromKioskId,
            fromKioskName: kiosks.find(k => k.id === item.fromKioskId)?.name || 'CD',
            toKioskName: resultItem.kioskName,
            movedByUserId: user.id,
            movedByUsername: user.username,
            productName: item.productName,
            lotNumber: item.lotNumber,
        }));
        
        try {
            await moveMultipleLots(params);

            const reportToUpdate = stockHistory.find(r => r.id === reportId);
            if (reportToUpdate) {
                const updatedResults = reportToUpdate.results.map(r => {
                    if (r.kioskId === resultItem.kioskId && r.productName === resultItem.productName) {
                        return { ...r, isActionable: false, statusMessage: 'Movimentação executada com sucesso.' };
                    }
                    return r;
                });
                await updateStockReport({ ...reportToUpdate, results: updatedResults });
            }

            toast({ title: "Sucesso!", description: `Movimentação de ${resultItem.productName} para ${resultItem.kioskName} executada.` });
        } catch (error) {
            console.error("Failed to execute distribution:", error);
            toast({ variant: "destructive", title: "Erro na Movimentação", description: "Não foi possível executar a transferência de estoque." });
        }
    };
    
    const handleDeleteStockReportClick = (report: StockAnalysisReport) => setStockReportToDelete(report);
    const handleDeleteConsumptionReportClick = (report: ConsumptionReport) => setConsumptionReportToDelete(report);
    const handleDeleteStockReportConfirm = async () => { if (stockReportToDelete) { await deleteStockReport(stockReportToDelete.id); setStockReportToDelete(null); } };
    const handleDeleteConsumptionReportConfirm = async () => { if (consumptionReportToDelete) { await deleteConsumptionReport(consumptionReportToDelete.id); setConsumptionReportToDelete(null); } };

    const handleExportReportPdf = (report: StockAnalysisReport) => {
        const doc = new jsPDF();
        const reportTitle = report.displayName || report.reportName;
        const filename = `${reportTitle.replace(/\//g, '-').replace(/\s/g, '_')}.pdf`;

        doc.setFontSize(18);
        doc.text(reportTitle, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Analisado em: ${format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, 14, 29);
        doc.text(`Resumo: ${report.summary}`, 14, 35);
        
        let yPos = 45;

        const addPageIfNeeded = () => {
            if (yPos > 260) {
                doc.addPage();
                yPos = 20;
            }
        }

        report.results.forEach(item => {
            addPageIfNeeded();

            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(`${item.productName} para ${item.kioskName}`, 14, yPos);
            yPos += 7;
            addPageIfNeeded();

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            const productUnit = findProductByName(item.productName)?.unit || '';
            doc.text(`Estoque Apurado: ${(item.currentStockInBaseUnit || 0).toLocaleString()} ${productUnit}`, 14, yPos);
            yPos += 5;
            addPageIfNeeded();
            doc.text(`Estoque Máximo Configurado: ${(item.maxStockInBaseUnit || 0).toLocaleString()} ${productUnit}`, 14, yPos);
            yPos += 5;
            addPageIfNeeded();
            doc.text(`Necessidade: ${(item.neededInBaseUnit || 0).toLocaleString()} ${productUnit}`, 14, yPos);
            yPos += 5;
            addPageIfNeeded();
            doc.text(`Status: ${item.statusMessage}`, 14, yPos);
            yPos += 8;
            addPageIfNeeded();

            if (item.distributionSuggestion && item.distributionSuggestion.length > 0) {
                autoTable(doc, {
                    startY: yPos,
                    head: [['Produto/Embalagem', 'Lote', 'Validade', 'Qtd. a Mover']],
                    body: item.distributionSuggestion.map(dist => [
                        dist.productName,
                        dist.lotNumber,
                        format(parseISO(dist.expiryDate), "dd/MM/yy"),
                        dist.quantityToMove.toString()
                    ]),
                    theme: 'grid',
                    headStyles: { fillColor: '#3F51B5' },
                    didDrawPage: (data) => {
                        yPos = (data.table.finalY ?? yPos) + 10;
                    }
                });
                yPos = (doc as any).lastAutoTable.finalY + 10;
            } else {
                 yPos += 5;
            }
        });

        doc.save(filename);
    };

    const canManageProducts = permissions.products.add || permissions.products.edit || permissions.products.delete;
    const canUploadStock = permissions.stockAnalysis?.upload;
    const canViewStockHistory = permissions.stockAnalysis?.viewHistory;
    const canDeleteStockHistory = permissions.stockAnalysis?.deleteHistory;

    const renderStockHistory = () => {
        if (stockHistoryLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        if (stockHistory.length === 0) return (
            <div className="text-center py-8 text-muted-foreground">
                <FileClock className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise no histórico</h3>
                <p className="mt-1 text-sm">Faça o upload de um relatório para começar.</p>
            </div>
        )
        return (
            <Accordion type="multiple" className="w-full space-y-3">
                {stockHistory.map(report => (
                    <AccordionItem value={report.id} key={report.id} className="border-none">
                        <Card>
                            <AccordionTrigger className="p-4 hover:no-underline rounded-lg w-full">
                                <div className="flex items-center justify-between gap-4 w-full">
                                    <div className="grid gap-1 flex-grow text-left">
                                        <p className="font-semibold">{report.displayName || report.reportName}</p>
                                        <p className="text-sm text-muted-foreground">{format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                                        <p className="text-sm">{report.summary}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button asChild variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleExportReportPdf(report); }}>
                                            <span><Download className="h-4 w-4" /></span>
                                        </Button>
                                        {canDeleteStockHistory && <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteStockReportClick(report); }}><span><Trash2 className="h-4 w-4" /></span></Button>}
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                {report.results?.length > 0 ? (
                                <div className="space-y-4">
                                {report.results.map((item, index) => (
                                    <div key={index} className="border rounded-lg p-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-semibold">{item.productName} para {item.kioskName}</h4>
                                                <div className="text-sm text-muted-foreground space-y-1 mt-1">
                                                    <p>Estoque Apurado: <span className="font-semibold text-foreground">{(item.currentStockInBaseUnit || 0).toLocaleString()} {findProductByName(item.productName)?.unit}</span></p>
                                                    <p>Estoque Máximo: <span className="font-semibold text-foreground">{(item.maxStockInBaseUnit || 0).toLocaleString()} {findProductByName(item.productName)?.unit}</span></p>
                                                    <p>Necessidade: <span className="font-bold text-destructive">{(item.neededInBaseUnit || 0).toLocaleString()} {findProductByName(item.productName)?.unit}</span></p>
                                                </div>
                                            </div>
                                            <Button size="sm" disabled={!item.isActionable || isAnalyzing} onClick={() => executeDistribution(report.id, item)}>
                                                <Send className="mr-2 h-4 w-4" /> Efetivar Movimentação
                                            </Button>
                                        </div>
                                        <p className={`text-sm mt-2 ${item.isActionable ? 'text-primary' : 'text-amber-600'}`}>{item.statusMessage || ''}</p>
                                        
                                        {item.distributionSuggestion && item.distributionSuggestion.length > 0 && (
                                            <div className="rounded-md border mt-2">
                                                <Table>
                                                    <TableHeader><TableRow><TableHead>Produto/Embalagem</TableHead><TableHead>Lote</TableHead><TableHead>Validade</TableHead><TableHead className="text-right">Qtd. a Mover</TableHead></TableRow></TableHeader>
                                                    <TableBody>
                                                        {item.distributionSuggestion.map((dist, distIndex) => (
                                                            <TableRow key={distIndex}>
                                                                <TableCell>{dist.productName}</TableCell>
                                                                <TableCell>{dist.lotNumber}</TableCell>
                                                                <TableCell>{format(parseISO(dist.expiryDate), "dd/MM/yy")}</TableCell>
                                                                <TableCell className="text-right font-semibold">{dist.quantityToMove}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                </div>
                                ) : (<p className="text-center text-muted-foreground text-sm pt-4">Nenhum item precisou de reposição nesta análise.</p>)}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        )
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start gap-4">
                        <div>
                            <CardTitle>Análise de Reposição por Planilha</CardTitle>
                            <CardDescription>Importe sua planilha de estoque para calcular as necessidades e gerar sugestões de distribuição.</CardDescription>
                        </div>
                         {canManageProducts && (
                            <Button variant="outline" className="shrink-0" onClick={() => setIsItemManagementOpen(true)}>
                                <Settings className="mr-2 h-4 w-4" />
                                Gerenciar itens
                            </Button>
                        )}
                    </div>
                </CardHeader>
                {canUploadStock ? (
                    <CardContent className="space-y-4 text-center p-6">
                         <Form {...form}>
                            <form className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end text-left">
                                <FormField
                                    control={form.control}
                                    name="kioskId"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>1. Selecione o quiosque do relatório</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value} disabled={kiosks.length === 0}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione..." />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                                        </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <div>
                                    <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                                    <Button size="lg" onClick={handleImportClick} type="button" className="w-full" disabled={isAnalyzing}>
                                        {isAnalyzing ? <Loader2 className="mr-2 animate-spin" /> : <UploadCloud className="mr-2" />} 
                                        {isAnalyzing ? 'Analisando...' : '2. Importar Planilha de Estoque'}
                                    </Button>
                                </div>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                ) : (
                    <CardContent>
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Permissão Necessária</AlertTitle>
                            <AlertDescription>Você não tem permissão para importar relatórios de estoque.</AlertDescription>
                        </Alert>
                    </CardContent>
                )}
            </Card>
            
            {canViewStockHistory && (
                <div className="mt-6">
                    <Separator className="mb-4" />
                    <h3 className="text-lg font-semibold mb-4">Histórico de Análises</h3>
                    {renderStockHistory()}
                </div>
            )}
            
            <ItemManagement open={isItemManagementOpen} onOpenChange={setIsItemManagementOpen} />
            
            {stockReportToDelete && canDeleteStockHistory && <DeleteConfirmationDialog open={!!stockReportToDelete} onOpenChange={() => setStockReportToDelete(null)} onConfirm={handleDeleteStockReportConfirm} itemName={`a análise "${stockReportToDelete.reportName}"`} />}
            {consumptionReportToDelete && <DeleteConfirmationDialog open={!!consumptionReportToDelete} onOpenChange={() => setConsumptionReportToDelete(null)} onConfirm={handleDeleteConsumptionReportConfirm} itemName={`a análise de consumo "${consumptionReportToDelete.reportName}"`} />}
        </>
    );
}
