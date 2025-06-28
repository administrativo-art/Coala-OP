
"use client"

import React, { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useStockAnalysis } from '@/hooks/use-stock-analysis';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useConsumptionAnalysis } from '@/hooks/use-consumption-analysis';
import { analyzeStock } from '@/ai/flows/analyze-stock-flow';
import { analyzeConsumption } from '@/ai/flows/analyze-consumption-flow';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart3, UploadCloud, Settings, AlertCircle, FileClock, Trash2, PackagePlus, Loader2, Download, TrendingUp } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from '@/hooks/use-toast';
import { StockAnalysisConfigurator } from './stock-analysis-configurator';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ProductManagementModal } from './product-management-modal';
import { type StockAnalysisReport, type ConsumptionReport } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const months = [
  { value: 1, label: 'Janeiro' }, { value: 2, label: 'Fevereiro' }, { value: 3, label: 'Março' },
  { value: 4, label: 'Abril' }, { value: 5, label: 'Maio' }, { value: 6, label: 'Junho' },
  { value: 7, label: 'Julho' }, { value: 8, label: 'Agosto' }, { value: 9, label: 'Setembro' },
  { value: 10, label: 'Outubro' }, { value: 11, label: 'Novembro' }, { value: 12, label: 'Dezembro' },
];

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

const consumptionFormSchema = z.object({
    month: z.string().min(1, "O mês é obrigatório."),
    year: z.string().min(1, "O ano é obrigatório."),
});
type ConsumptionFormValues = z.infer<typeof consumptionFormSchema>;

export function StockAnalyzer() {
    const { permissions } = useAuth();
    const { kiosks } = useKiosks();
    const { history: stockHistory, loading: stockHistoryLoading, addReport: addStockReport, deleteReport: deleteStockReport } = useStockAnalysis();
    const { history: consumptionHistory, loading: consumptionHistoryLoading, addReport: addConsumptionReport, deleteReport: deleteConsumptionReport } = useConsumptionAnalysis();
    const stockAnalysisProducts = useStockAnalysisProducts();
    const { toast } = useToast();

    const [stockReportToDelete, setStockReportToDelete] = useState<StockAnalysisReport | null>(null);
    const [consumptionReportToDelete, setConsumptionReportToDelete] = useState<ConsumptionReport | null>(null);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const stockFileInputRef = useRef<HTMLInputElement>(null);
    const consumptionFileInputRef = useRef<HTMLInputElement>(null);

    const consumptionForm = useForm<ConsumptionFormValues>({
        resolver: zodResolver(consumptionFormSchema),
        defaultValues: {
            month: String(new Date().getMonth()),
            year: String(currentYear),
        }
    });

    const handleStockUploadClick = () => {
        if (isAnalyzing) return;
        stockFileInputRef.current?.click();
    };

    const handleConsumptionUploadClick = () => {
         if (isAnalyzing) return;
        consumptionFileInputRef.current?.click();
    };

    const handleStockFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsAnalyzing(true);
        const { dismiss } = toast({
            title: "Analisando relatório de estoque...",
            description: "A nossa IA está lendo o PDF. Isso pode levar um momento.",
            duration: Infinity,
        });

        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const pdfDataUri = reader.result as string;

                const result = await analyzeStock({
                    reportName: file.name,
                    pdfDataUri,
                    products: stockAnalysisProducts.products,
                    kiosks: kiosks,
                });
                
                await addStockReport({
                    ...result,
                    createdAt: new Date().toISOString(),
                    status: 'completed',
                });

                toast({
                    title: "Análise de estoque concluída!",
                    description: result.summary,
                });
            };
            reader.onerror = () => { throw new Error("Falha ao ler o arquivo."); }
        } catch (error) {
            console.error("Stock analysis failed:", error);
            toast({ variant: "destructive", title: "Falha na análise", description: "Não foi possível analisar o relatório de estoque. Verifique o arquivo e tente novamente." });
        } finally {
            setIsAnalyzing(false);
            dismiss();
            if(stockFileInputRef.current) stockFileInputRef.current.value = "";
        }
    };
    
    const handleConsumptionFileChange = async (event: React.ChangeEvent<HTMLInputElement>, values: ConsumptionFormValues) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsAnalyzing(true);
        const { dismiss } = toast({
            title: "Analisando relatório de consumo...",
            description: "A IA está processando os dados de consumo. Aguarde um instante.",
            duration: Infinity,
        });

        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const pdfDataUri = reader.result as string;
                const result = await analyzeConsumption({
                    reportName: file.name,
                    pdfDataUri,
                    month: parseInt(values.month, 10),
                    year: parseInt(values.year, 10),
                    products: stockAnalysisProducts.products,
                });

                await addConsumptionReport({
                    ...result,
                    createdAt: new Date().toISOString(),
                    status: 'completed',
                });

                toast({
                    title: "Análise de consumo concluída!",
                    description: `Relatório de consumo para ${file.name} foi processado.`,
                });
            };
            reader.onerror = () => { throw new Error("Falha ao ler o arquivo."); };
        } catch (error) {
            console.error("Consumption analysis failed:", error);
            toast({ variant: "destructive", title: "Falha na análise", description: "Não foi possível analisar o relatório de consumo. Verifique o arquivo e tente novamente." });
        } finally {
            setIsAnalyzing(false);
            dismiss();
            if(consumptionFileInputRef.current) consumptionFileInputRef.current.value = "";
        }
    }

    const onConsumptionFormSubmit = (values: ConsumptionFormValues) => {
        consumptionFileInputRef.current?.addEventListener('change', (event) => {
            handleConsumptionFileChange(event as any, values)
        }, { once: true });
        consumptionFileInputRef.current?.click();
    };

    const handleDeleteStockReportClick = (report: StockAnalysisReport) => setStockReportToDelete(report);
    const handleDeleteConsumptionReportClick = (report: ConsumptionReport) => setConsumptionReportToDelete(report);
    
    const handleDeleteStockReportConfirm = () => {
        if (stockReportToDelete) {
            deleteStockReport(stockReportToDelete.id);
            setStockReportToDelete(null);
        }
    };
     const handleDeleteConsumptionReportConfirm = () => {
        if (consumptionReportToDelete) {
            deleteConsumptionReport(consumptionReportToDelete.id);
            setConsumptionReportToDelete(null);
        }
    };

    const handleDownloadPDF = (report: StockAnalysisReport) => { toast({ title: "Em desenvolvimento", description: "A funcionalidade de download em PDF será implementada em breve." }); };
    const handleExportToSheets = (report: StockAnalysisReport) => { toast({ title: "Em desenvolvimento", description: "A funcionalidade de exportação para Google Sheets será implementada em breve." }); };

    const canUploadStock = permissions.stockAnalysis?.upload;
    const canConfigureStock = permissions.stockAnalysis?.configure;
    const canViewStockHistory = permissions.stockAnalysis?.viewHistory;
    const canDeleteStockHistory = permissions.stockAnalysis?.deleteHistory;
    const canUploadConsumption = permissions.consumptionAnalysis?.upload;
    const canViewConsumptionHistory = permissions.consumptionAnalysis?.viewHistory;
    const canDeleteConsumptionHistory = permissions.consumptionAnalysis?.deleteHistory;


    if (!canUploadStock && !canConfigureStock && !canUploadConsumption) {
      return (
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2"><BarChart3 /> Análise de Estoque</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" className="mt-8 text-left">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Acesso Negado</AlertTitle>
                <AlertDescription>Você não tem permissão para utilizar este módulo. Entre em contato com um administrador.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      );
    }

    const defaultTab = canUploadStock ? "replenishment" : (canUploadConsumption ? "consumption" : "parameters");

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
            <Accordion type="single" collapsible className="w-full space-y-3">
                {stockHistory.map(report => (
                    <AccordionItem value={report.id} key={report.id} className="border-none">
                        <Card>
                            <AccordionTrigger className="p-4 hover:no-underline rounded-lg w-full">
                                <div className="flex items-center justify-between gap-4 w-full">
                                    <div className="grid gap-1 flex-grow text-left">
                                        <p className="font-semibold">{report.reportName}</p>
                                        <p className="text-sm text-muted-foreground">{format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                                        <p className="text-sm">{report.summary}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><Download className="h-4 w-4" /><span className="sr-only">Baixar relatório</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDownloadPDF(report); }}>Baixar PDF</DropdownMenuItem><DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportToSheets(report); }}>Exportar para Google Sheets</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                                        {canDeleteStockHistory && <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteStockReportClick(report); }}><span><Trash2 className="h-4 w-4" /></span></Button>}
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                {report.results.length > 0 ? (
                                <div className="rounded-md border mt-2"><Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Quiosque</TableHead><TableHead className="text-right">Estoque Atual</TableHead><TableHead className="text-right">Reposição Necessária</TableHead><TableHead>Sugestão de Compra</TableHead></TableRow></TableHeader><TableBody>
                                    {report.results.map((item, index) => <TableRow key={`${item.productId}-${item.kioskId}-${index}`}><TableCell>{item.productName}</TableCell><TableCell>{item.kioskName}</TableCell><TableCell className="text-right">{item.currentStock}</TableCell><TableCell className="text-right font-bold text-destructive">{item.needed}</TableCell><TableCell className="font-semibold text-primary">{item.purchaseSuggestion}</TableCell></TableRow>)}
                                </TableBody></Table></div>) : (<p className="text-center text-muted-foreground text-sm pt-4">Nenhum item precisou de reposição nesta análise.</p>)}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        )
    }

    const renderConsumptionHistory = () => {
        if (consumptionHistoryLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
        if (consumptionHistory.length === 0) return (
            <div className="text-center py-8 text-muted-foreground">
                <FileClock className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise de consumo</h3>
                <p className="mt-1 text-sm">Faça o upload de um relatório de vendas para começar.</p>
            </div>
        )
        return (
            <Accordion type="single" collapsible className="w-full space-y-3">
                {consumptionHistory.map(report => (
                    <AccordionItem value={report.id} key={report.id} className="border-none">
                        <Card>
                            <AccordionTrigger className="p-4 hover:no-underline rounded-lg w-full">
                                <div className="flex items-center justify-between gap-4 w-full">
                                    <div className="grid gap-1 flex-grow text-left">
                                        <p className="font-semibold">{report.reportName}</p>
                                        <p className="text-sm text-muted-foreground">{months.find(m => m.value === report.month)?.label} de {report.year}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {canDeleteConsumptionHistory && <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteConsumptionReportClick(report); }}><span><Trash2 className="h-4 w-4" /></span></Button>}
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                {report.results.length > 0 ? (
                                <div className="rounded-md border mt-2"><Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd. Consumida</TableHead><TableHead className="text-right">Embalagens Consumidas</TableHead></TableRow></TableHeader><TableBody>
                                    {report.results.map((item, index) => {
                                        const product = stockAnalysisProducts.products.find(p => p.id === item.productId);
                                        return <TableRow key={`${item.productId}-${index}`}><TableCell>{item.productName}</TableCell><TableCell className="text-right">{item.consumedQuantity.toLocaleString()} {product?.unit}</TableCell><TableCell className="text-right font-semibold">{item.consumedPackages.toLocaleString()} un</TableCell></TableRow>
                                    })}
                                </TableBody></Table></div>) : (<p className="text-center text-muted-foreground text-sm pt-4">Nenhum produto encontrado nesta análise.</p>)}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        );
    }


    return (
        <>
            <Tabs defaultValue={defaultTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    {canUploadStock && <TabsTrigger value="replenishment"><UploadCloud className="mr-2" /> Análise de Reposição</TabsTrigger>}
                    {canUploadConsumption && <TabsTrigger value="consumption"><TrendingUp className="mr-2" /> Análise de Consumo</TabsTrigger>}
                    {canConfigureStock && <TabsTrigger value="parameters"><Settings className="mr-2" /> Configurar Parâmetros</TabsTrigger>}
                </TabsList>
                
                {canUploadStock && <TabsContent value="replenishment" className="mt-4">
                    <Card><CardHeader><CardTitle>Análise para Reposição</CardTitle><CardDescription>Faça upload de um arquivo PDF para que a nossa IA identifique os itens, compare com o estoque ideal e sugira as compras.</CardDescription></CardHeader><CardContent className="space-y-4 text-center p-6">
                        <input type="file" accept=".pdf" ref={stockFileInputRef} onChange={handleStockFileChange} className="hidden" />
                        <Button size="lg" onClick={handleStockUploadClick} className="mt-4" disabled={isAnalyzing}>{isAnalyzing ? <Loader2 className="mr-2 animate-spin" /> : <UploadCloud className="mr-2" />} {isAnalyzing ? 'Analisando...' : 'Fazer Upload de Relatório'}</Button>
                    </CardContent></Card>
                    {canViewStockHistory && <div className="mt-6"><Separator className="mb-4" /><h3 className="text-lg font-semibold mb-4">Histórico de Análise de Reposição</h3>{renderStockHistory()}</div>}
                </TabsContent>}
                
                {canUploadConsumption && <TabsContent value="consumption" className="mt-4">
                    <Card><CardHeader><CardTitle>Analisar Consumo Mensal</CardTitle><CardDescription>Faça o upload do relatório de vendas do mês para registrar o consumo médio dos produtos.</CardDescription></CardHeader><CardContent className="space-y-4 p-6">
                        <Form {...consumptionForm}>
                            <form onSubmit={consumptionForm.handleSubmit(onConsumptionFormSubmit)} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                                <FormField control={consumptionForm.control} name="month" render={({ field }) => <FormItem><FormLabel>Mês</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger></FormControl><SelectContent>{months.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
                                <FormField control={consumptionForm.control} name="year" render={({ field }) => <FormItem><FormLabel>Ano</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger></FormControl><SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
                                <div className="pt-6"><Button type="submit" disabled={isAnalyzing}>{isAnalyzing ? <Loader2 className="mr-2 animate-spin" /> : <UploadCloud className="mr-2" />} {isAnalyzing ? 'Analisando...' : 'Upload do Relatório'}</Button></div>
                                <input type="file" accept=".pdf" ref={consumptionFileInputRef} className="hidden" />
                            </form>
                        </Form>
                    </CardContent></Card>
                     {canViewConsumptionHistory && <div className="mt-6"><Separator className="mb-4" /><h3 className="text-lg font-semibold mb-4">Histórico de Análise de Consumo</h3>{renderConsumptionHistory()}</div>}
                </TabsContent>}

                {canConfigureStock && <TabsContent value="parameters" className="mt-4">
                    <Card><CardHeader><CardTitle>Configurar Parâmetros de Análise</CardTitle><CardDescription>Defina o estoque ideal, unidades de compra e gerencie os produtos que serão considerados na análise de estoque.</CardDescription></CardHeader><CardContent className="p-6">
                        <div className="mb-6"><Button variant="outline" onClick={() => setIsProductModalOpen(true)}><PackagePlus className="mr-2" /> Gerenciar Produtos para Análise</Button></div>
                        <StockAnalysisConfigurator />
                    </CardContent></Card>
                </TabsContent>}
            </Tabs>
            
            <ProductManagementModal
                open={isProductModalOpen}
                onOpenChange={setIsProductModalOpen}
                products={stockAnalysisProducts.products}
                addProduct={stockAnalysisProducts.addProduct}
                updateProduct={stockAnalysisProducts.updateProduct}
                deleteProduct={stockAnalysisProducts.deleteProduct}
                getProductFullName={stockAnalysisProducts.getProductFullName}
                permissions={{ add: !!canConfigureStock, edit: !!canConfigureStock, delete: !!canConfigureStock }}
            />
            
            {stockReportToDelete && canDeleteStockHistory && <DeleteConfirmationDialog open={!!stockReportToDelete} onOpenChange={() => setStockReportToDelete(null)} onConfirm={handleDeleteStockReportConfirm} itemName={`a análise "${stockReportToDelete.reportName}"`} />}
            {consumptionReportToDelete && canDeleteConsumptionHistory && <DeleteConfirmationDialog open={!!consumptionReportToDelete} onOpenChange={() => setConsumptionReportToDelete(null)} onConfirm={handleDeleteConsumptionReportConfirm} itemName={`a análise de consumo "${consumptionReportToDelete.reportName}"`} />}
        </>
    );
}
