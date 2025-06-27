
"use client"

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useStockAnalysis } from '@/hooks/use-stock-analysis';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, UploadCloud, Settings, AlertCircle, FileClock, Trash2, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { StockAnalysisConfigurator } from './stock-analysis-configurator';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { type StockAnalysisReport } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function StockAnalyzer() {
    const { permissions } = useAuth();
    const { history, loading: historyLoading, deleteReport } = useStockAnalysis();
    const { toast } = useToast();
    const [reportToDelete, setReportToDelete] = useState<StockAnalysisReport | null>(null);

    const handleUploadClick = () => {
        toast({
            title: "Funcionalidade em desenvolvimento",
            description: "A IA para ler PDFs ainda está sendo treinada pelo nosso coala chefe!",
        });
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


    if (!canUpload && !canConfigure) {
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
            <div className="space-y-3">
                {history.map(report => (
                    <Card key={report.id}>
                        <CardContent className="p-4 flex items-center justify-between gap-4">
                           <div className="grid gap-1 flex-grow">
                                <p className="font-semibold">{report.fileName}</p>
                                <p className="text-sm text-muted-foreground">
                                    {format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                </p>
                                <p className="text-sm">{report.summary}</p>
                           </div>
                           <div className="flex items-center gap-1 shrink-0">
                               <Button variant="outline" size="sm" disabled>Ver detalhes <ChevronRight className="ml-2 h-4 w-4" /></Button>
                               {canDeleteHistory && (
                                   <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(report)}>
                                       <Trash2 className="h-4 w-4" />
                                   </Button>
                               )}
                           </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
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
                            <p className="text-muted-foreground text-sm max-w-md mx-auto">Esta funcionalidade está em desenvolvimento. Em breve você poderá automatizar sua análise de estoque com um simples upload.</p>
                            <Button size="lg" onClick={handleUploadClick} className="mt-4">
                                <UploadCloud className="mr-2" /> Fazer Upload de Relatório
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
                            <CardDescription>Defina o estoque ideal por quiosque e as unidades de compra para cada produto. Essas informações são essenciais para a análise automática.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <StockAnalysisConfigurator />
                        </CardContent>
                    </Card>
                </TabsContent>
                )}
            </Tabs>
            {reportToDelete && canDeleteHistory && (
                <DeleteConfirmationDialog
                    open={!!reportToDelete}
                    onOpenChange={() => setReportToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`a análise do arquivo "${reportToDelete.fileName}"`}
                />
            )}
        </>
    );
}
