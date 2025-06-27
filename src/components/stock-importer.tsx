
"use client"

import React, { useState, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useStockAnalysis } from '@/hooks/use-stock-analysis';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { analyzeStock } from '@/ai/flows/analyze-stock-flow';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart3, UploadCloud, Settings, AlertCircle, FileClock, Trash2, PackagePlus, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { StockAnalysisConfigurator } from './stock-analysis-configurator';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ProductManagementModal } from './product-management-modal';
import { type StockAnalysisReport } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function StockAnalyzer() {
    const { permissions } = useAuth();
    const { kiosks } = useKiosks();
    const { history, loading: historyLoading, addReport, deleteReport } = useStockAnalysis();
    const stockAnalysisProducts = useStockAnalysisProducts();
    const { toast } = useToast();

    const [reportToDelete, setReportToDelete] = useState<StockAnalysisReport | null>(null);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUploadClick = () => {
        if (isAnalyzing) return;
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsAnalyzing(true);
        const { dismiss } = toast({
            title: "Analisando relatório...",
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
                
                await addReport({
                    ...result,
                    createdAt: new Date().toISOString(),
                    status: 'completed',
                });

                toast({
                    title: "Análise concluída!",
                    description: result.summary,
                });
            };
            reader.onerror = (error) => {
                throw new Error("Falha ao ler o arquivo.");
            }
        } catch (error) {
            console.error("Analysis failed:", error);
            toast({
                variant: "destructive",
                title: "Falha na análise",
                description: "Não foi possível analisar o relatório. Verifique o arquivo e tente novamente.",
            });
        } finally {
            setIsAnalyzing(false);
            dismiss();
            // Reset file input
            if(fileInputRef.current) fileInputRef.current.value = "";
        }
    };


    const handleDeleteClick = (report: StockAnalysisReport) => {
        setReportToDelete(report);
    };

    const handleDeleteConfirm = () => {
        if (reportToDelete) {
            deleteReport(reportToDelete.id);
            setReportToDelete(null);
        }
    };
    
    const canUpload = permissions.stockAnalysis?.upload;
    const canConfigure = permissions.stockAnalysis?.configure;
    const canViewHistory = permissions.stockAnalysis?.viewHistory;
    const canDeleteHistory = permissions.stockAnalysis?.deleteHistory;


    if (!canUpload && !canConfigure && !canViewHistory) {
      return (
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2"><BarChart3 /> Análise de Estoque</CardTitle>
              <CardDescription>Faça upload de relatórios para analisar o estoque atual, identificar faltas e otimizar as compras.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" className="mt-8 text-left">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Acesso Negado</AlertTitle>
                <AlertDescription>
                    Você não tem permissão para utilizar este módulo. Entre em contato com um administrador.
                </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      );
    }

    const defaultTab = canUpload ? "analysis" : "parameters";

    const renderHistory = () => {
        if (historyLoading) {
            return (
                <div className="space-y-3">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                </div>
            )
        }

        if (history.length === 0) {
            return (
                <div className="text-center py-8 text-muted-foreground">
                    <FileClock className="mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise no histórico</h3>
                    <p className="mt-1 text-sm">
                        Faça o upload de um relatório para começar.
                    </p>
                </div>
            )
        }

        return (
            <Accordion type="single" collapsible className="w-full space-y-3">
                {history.map(report => (
                    <AccordionItem value={report.id} key={report.id} className="border-none">
                        <Card>
                            <AccordionTrigger className="p-4 hover:no-underline rounded-lg w-full">
                                <div className="flex items-center justify-between gap-4 w-full">
                                    <div className="grid gap-1 flex-grow text-left">
                                        <p className="font-semibold">{report.reportName}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                        </p>
                                        <p className="text-sm">{report.summary}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {canDeleteHistory && (
                                            <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteClick(report); }}>
                                                <span>
                                                    <Trash2 className="h-4 w-4" />
                                                </span>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                {report.results.length > 0 ? (
                                <div className="rounded-md border mt-2">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Produto</TableHead>
                                                <TableHead>Quiosque</TableHead>
                                                <TableHead className="text-right">Estoque Atual</TableHead>
                                                <TableHead className="text-right">Reposição Necessária</TableHead>
                                                <TableHead>Sugestão de Compra</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {report.results.map((item, index) => {
                                                const product = stockAnalysisProducts.products.find(p => p.id === item.productId);
                                                const unit = product ? product.unit : '';
                                                return (
                                                    <TableRow key={`${item.productId}-${item.kioskId}-${index}`}>
                                                        <TableCell>{item.productName}</TableCell>
                                                        <TableCell>{item.kioskName}</TableCell>
                                                        <TableCell className="text-right">{item.currentStock} {unit}</TableCell>
                                                        <TableCell className="text-right font-bold text-destructive">{item.needed} {unit}</TableCell>
                                                        <TableCell className="font-semibold text-primary">{item.purchaseSuggestion}</TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                                ) : (
                                     <p className="text-center text-muted-foreground text-sm pt-4">Nenhum item precisou de reposição nesta análise.</p>
                                )}
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                ))}
            </Accordion>
        )
    }

    return (
        <>
            <Tabs defaultValue={defaultTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    {canUpload && <TabsTrigger value="analysis"><UploadCloud className="mr-2" /> Analisar Relatório</TabsTrigger>}
                    {canConfigure && <TabsTrigger value="parameters"><Settings className="mr-2" /> Configurar Parâmetros</TabsTrigger>}
                </TabsList>
                {canUpload && (
                <TabsContent value="analysis" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Analisar Relatório de Estoque</CardTitle>
                            <CardDescription>Faça upload de um arquivo PDF para que a nossa IA identifique os itens, compare com o estoque ideal e sugira as compras.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 text-center p-6">
                             <input type="file" accept=".pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                            <Button size="lg" onClick={handleUploadClick} className="mt-4" disabled={isAnalyzing}>
                                {isAnalyzing ? <Loader2 className="mr-2 animate-spin" /> : <UploadCloud className="mr-2" />} 
                                {isAnalyzing ? 'Analisando...' : 'Fazer Upload de Relatório'}
                            </Button>
                        </CardContent>
                    </Card>

                    {canViewHistory && (
                        <div className="mt-6">
                            <Separator className="mb-4" />
                            <h3 className="text-lg font-semibold mb-4">Histórico de Análises</h3>
                            {renderHistory()}
                        </div>
                    )}
                </TabsContent>
                )}
                {canConfigure && (
                <TabsContent value="parameters" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Configurar Parâmetros de Análise</CardTitle>
                            <CardDescription>Defina o estoque ideal, unidades de compra e gerencie os produtos que serão considerados na análise de estoque.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="mb-6">
                                <Button variant="outline" onClick={() => setIsProductModalOpen(true)}>
                                    <PackagePlus className="mr-2" /> Gerenciar Produtos para Análise
                                </Button>
                            </div>
                            <StockAnalysisConfigurator />
                        </CardContent>
                    </Card>
                </TabsContent>
                )}
            </Tabs>
            
            <ProductManagementModal
                open={isProductModalOpen}
                onOpenChange={setIsProductModalOpen}
                products={stockAnalysisProducts.products}
                addProduct={stockAnalysisProducts.addProduct}
                updateProduct={stockAnalysisProducts.updateProduct}
                deleteProduct={stockAnalysisProducts.deleteProduct}
                getProductFullName={stockAnalysisProducts.getProductFullName}
                permissions={{ add: !!canConfigure, edit: !!canConfigure, delete: !!canConfigure }}
            />
            
            {reportToDelete && canDeleteHistory && (
                <DeleteConfirmationDialog
                    open={!!reportToDelete}
                    onOpenChange={() => setReportToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`a análise "${reportToDelete.reportName}"`}
                />
            )}
        </>
    );
}
