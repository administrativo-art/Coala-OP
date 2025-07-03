"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from "@/hooks/use-auth"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useToast } from "@/hooks/use-toast"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, ListFilter, UploadCloud, Loader2, FileClock, Trash2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "./ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

import { analyzeConsumption } from "@/ai/flows/analyze-consumption-flow";
import { type ConsumptionReport } from "@/types";
import { format, parseISO } from "date-fns";
import { ptBR } from 'date-fns/locale';

const consumptionUploadSchema = z.object({
  kioskId: z.string().min(1, "Selecione um quiosque."),
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(new Date().getFullYear() - 5).max(new Date().getFullYear() + 5),
  file: z.any().refine((files) => files?.length > 0, "Selecione um arquivo."),
});

type ConsumptionUploadFormValues = z.infer<typeof consumptionUploadSchema>;

export function ConsumptionAnalysisDashboard() {
  const { user } = useAuth()
  const { products, loading: productsLoading } = useStockAnalysisProducts()
  const { history: consumptionHistory, loading: consumptionLoading, addReport, deleteReport } = useConsumptionAnalysis()
  const { kiosks, loading: kiosksLoading } = useKiosks();

  const [selectedKiosk, setSelectedKiosk] = useState<string>('matriz');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [initialSelectionMade, setInitialSelectionMade] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<ConsumptionReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);

  const uploadForm = useForm<ConsumptionUploadFormValues>({
    resolver: zodResolver(consumptionUploadSchema),
    defaultValues: {
      kioskId: '',
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      file: undefined,
    }
  });

  const onUploadSubmit = async (values: ConsumptionUploadFormValues) => {
    const file = values.file[0];
    if (!file || !user || productsLoading) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Dados incompletos para iniciar a análise.' });
      return;
    }

    setIsAnalyzing(true);
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const pdfDataUri = reader.result as string;
        const selectedKiosk = kiosks.find(k => k.id === values.kioskId);

        if (!selectedKiosk) throw new Error("Quiosque não encontrado.");

        const analysisResult = await analyzeConsumption({
            reportName: file.name,
            pdfDataUri,
            month: values.month,
            year: values.year,
            kioskId: values.kioskId,
            kioskName: selectedKiosk.name,
            products: activeProducts,
        });

        if (analysisResult) {
            await addReport({
                ...analysisResult,
                createdAt: new Date().toISOString(),
                status: 'completed',
            });
            toast({ title: 'Sucesso', description: `Relatório "${file.name}" analisado e salvo.` });
        } else {
             throw new Error('A análise de IA não retornou resultados.');
        }
      };

      reader.onerror = () => {
        throw new Error('Falha ao ler o arquivo.');
      };

    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro na Análise', description: error.message || 'Não foi possível analisar o relatório.' });
    } finally {
        setIsAnalyzing(false);
        uploadForm.reset({
            ...uploadForm.getValues(),
            file: undefined,
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };


  useEffect(() => {
    if (!initialSelectionMade && activeProducts.length > 0) {
      setSelectedProducts(activeProducts.map(p => p.id));
      setInitialSelectionMade(true);
    }
  }, [activeProducts, initialSelectionMade]);

  const chartData = useMemo(() => {
    const loading = consumptionLoading || productsLoading || kiosksLoading;
    if (loading || !user || consumptionHistory.length === 0 || products.length === 0) return [];

    const kioskConsumption: { [kioskId: string]: { [productId: string]: { total: number; count: number } } } = {};

    consumptionHistory.forEach(report => {
      if (!kioskConsumption[report.kioskId]) {
        kioskConsumption[report.kioskId] = {};
      }
      report.results.forEach(item => {
        if (!kioskConsumption[report.kioskId][item.productId]) {
          kioskConsumption[report.kioskId][item.productId] = { total: 0, count: 0 };
        }
        kioskConsumption[report.kioskId][item.productId].total += item.consumedPackages;
        kioskConsumption[report.kioskId][item.productId].count += 1;
      });
    });

    const kioskIdForChart = user.username === 'master' ? selectedKiosk : user.kioskId;
    let relevantConsumptionData: { [productId: string]: number } = {};

    if (kioskIdForChart === 'matriz' && user.username === 'master') {
        const masterAverages: { [productId: string]: { totalAvg: number } } = {};
        Object.entries(kioskConsumption).forEach(([kioskId, productMap]) => {
            if (kioskId === 'matriz') return;
            Object.entries(productMap).forEach(([productId, data]) => {
                const avgForKiosk = data.count > 0 ? data.total / data.count : 0;
                if (!masterAverages[productId]) masterAverages[productId] = { totalAvg: 0 };
                masterAverages[productId].totalAvg += avgForKiosk;
            });
        });
        Object.entries(masterAverages).forEach(([productId, data]) => {
            relevantConsumptionData[productId] = data.totalAvg;
        });
    } else {
        const singleKioskData = kioskConsumption[kioskIdForChart];
        if (singleKioskData) {
            Object.entries(singleKioskData).forEach(([productId, data]) => {
                relevantConsumptionData[productId] = data.count > 0 ? data.total / data.count : 0;
            });
        }
    }

    const dataForChart = activeProducts
      .filter(p => selectedProducts.includes(p.id))
      .map(product => {
        const avgPackages = relevantConsumptionData[product.id] || 0;
        let consumption = Math.ceil(avgPackages);
        let unitLabel = 'Pacotes';
        if (product.hasPurchaseUnit && product.itemsPerPurchaseUnit && product.itemsPerPurchaseUnit > 0) {
            consumption = Math.ceil(avgPackages / product.itemsPerPurchaseUnit);
            unitLabel = product.purchaseUnitName || 'Un. Compra';
        }
        return {
          productId: product.id,
          name: `${product.baseName} (${unitLabel})`,
          "Consumo": consumption,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return dataForChart;

  }, [user, consumptionHistory, products, consumptionLoading, productsLoading, kiosks, kiosksLoading, selectedKiosk, selectedProducts, activeProducts]);

  const handleProductSelection = (productId: string, checked: boolean) => {
    setSelectedProducts(current => checked ? [...current, productId] : current.filter(id => id !== productId));
  };

  const sortedKiosks = kiosks.sort((a,b) => {
    if (a.id === 'matriz') return -1;
    if (b.id === 'matriz') return 1;
    return a.name.localeCompare(b.name);
  });
  
  const loadingData = consumptionLoading || productsLoading || kiosksLoading;

  const handleDeleteReportClick = (report: ConsumptionReport) => setReportToDelete(report);
  const handleDeleteReportConfirm = async () => {
    if (reportToDelete) {
        await deleteReport(reportToDelete.id);
        setReportToDelete(null);
    }
  };

  const renderHistory = () => {
    if (consumptionLoading) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
    if (consumptionHistory.length === 0) return (
        <div className="text-center py-8 text-muted-foreground">
            <FileClock className="mx-auto h-12 w-12" />
            <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise no histórico</h3>
            <p className="mt-1 text-sm">Faça o upload de um relatório para começar.</p>
        </div>
    )
    return (
        <Accordion type="multiple" className="w-full space-y-3">
            {consumptionHistory.map(report => (
                <AccordionItem value={report.id} key={report.id} className="border-none">
                    <Card>
                        <AccordionTrigger className="p-4 hover:no-underline rounded-lg w-full">
                            <div className="flex items-center justify-between gap-4 w-full">
                                <div className="grid gap-1 flex-grow text-left">
                                    <p className="font-semibold">{report.kioskName} - {report.month}/{report.year}</p>
                                    <p className="text-sm text-muted-foreground">Analisado em: {format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                                    <p className="text-sm">Relatório: {report.reportName}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteReportClick(report); }}><span><Trash2 className="h-4 w-4" /></span></Button>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            {report.results && report.results.length > 0 ? (
                               <div className="rounded-md border">
                                    <Table>
                                        <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd. Pacotes</TableHead><TableHead className="text-right">Qtd. Total (Unidade Base)</TableHead></TableRow></TableHeader>
                                        <TableBody>
                                            {report.results.map((item, index) => {
                                                const productConfig = activeProducts.find(p => p.id === item.productId);
                                                return (
                                                    <TableRow key={index}>
                                                        <TableCell>{item.productName}</TableCell>
                                                        <TableCell className="text-right font-semibold">{item.consumedPackages}</TableCell>
                                                        <TableCell className="text-right">{item.consumedQuantity.toLocaleString()} {productConfig?.unit || ''}</TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : (<p className="text-center text-muted-foreground text-sm pt-4">Nenhum resultado para este relatório.</p>)}
                        </AccordionContent>
                    </Card>
                </AccordionItem>
            ))}
        </Accordion>
    )
  }

  return (
    <div className="space-y-6">
        <Card>
            <CardHeader>
            <CardTitle>Importar Relatório de Consumo</CardTitle>
            <CardDescription>Faça o upload de um relatório de vendas/consumo em PDF para que a IA analise.</CardDescription>
            </CardHeader>
            <CardContent>
            <Form {...uploadForm}>
                <form onSubmit={uploadForm.handleSubmit(onUploadSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <FormField control={uploadForm.control} name="kioskId" render={({ field }) => (
                        <FormItem className="col-span-2"><FormLabel>Quiosque</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>{kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                        </Select><FormMessage />
                        </FormItem>
                    )}/>
                    <FormField control={uploadForm.control} name="month" render={({ field }) => (
                        <FormItem><FormLabel>Mês</FormLabel><FormControl><Input type="number" min="1" max="12" {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                    <FormField control={uploadForm.control} name="year" render={({ field }) => (
                        <FormItem><FormLabel>Ano</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                </div>
                <FormField
                    control={uploadForm.control}
                    name="file"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Arquivo (PDF)</FormLabel>
                        <FormControl>
                        <Input
                            type="file"
                            accept="application/pdf"
                            ref={fileInputRef}
                            onChange={(e) => field.onChange(e.target.files)}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <Button type="submit" disabled={isAnalyzing}>
                    {isAnalyzing ? <Loader2 className="mr-2 animate-spin" /> : <UploadCloud className="mr-2" />}
                    {isAnalyzing ? 'Analisando...' : 'Analisar Relatório'}
                </Button>
                </form>
            </Form>
            </CardContent>
        </Card>

        <Separator />

        <div>
            <h3 className="text-lg font-semibold mb-2">Histórico de Análises de Consumo</h3>
            {renderHistory()}
        </div>

        <Separator />

        <Card>
        <CardHeader className="flex flex-col gap-4">
            <div>
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-6 w-6" /> Consumo Médio Mensal
                </CardTitle>
                <CardDescription>
                    {user?.username === 'master' 
                        ? (selectedKiosk === 'matriz' ? 'Soma do consumo médio mensal de todos os quiosques.' : `Produtos consumidos no quiosque selecionado.`)
                        : `Produtos consumidos no seu quiosque.`}
                </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:justify-end">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full sm:w-auto">
                            <ListFilter className="mr-2 h-4 w-4" />
                            Filtrar Produtos ({selectedProducts.length})
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64">
                        <DropdownMenuLabel>Exibir Produtos</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setSelectedProducts(activeProducts.map(p => p.id))}>Selecionar Todos</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setSelectedProducts([])}>Limpar Seleção</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <ScrollArea className="h-60">
                        {activeProducts.sort((a,b) => a.baseName.localeCompare(b.baseName)).map(product => (
                            <DropdownMenuCheckboxItem
                                key={product.id}
                                checked={selectedProducts.includes(product.id)}
                                onCheckedChange={(checked) => handleProductSelection(product.id, !!checked)}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {product.baseName}
                            </DropdownMenuCheckboxItem>
                        ))}
                        </ScrollArea>
                    </DropdownMenuContent>
                </DropdownMenu>

                {user?.username === 'master' && (
                    <Select value={selectedKiosk} onValueChange={setSelectedKiosk} disabled={kiosksLoading}>
                        <SelectTrigger className="w-full sm:w-[240px]">
                            <SelectValue placeholder="Selecionar Quiosque" />
                        </SelectTrigger>
                        <SelectContent>
                            {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                )}
            </div>
        </CardHeader>
        <CardContent className="pl-2">
            { loadingData ? (
                <Skeleton className="h-[350px] w-full" />
                ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} interval={0} angle={-45} textAnchor="end" />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false}/>
                    <Tooltip 
                        cursor={{fill: 'hsl(var(--muted))'}}
                        contentStyle={{ 
                            backgroundColor: "hsl(var(--background))", 
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)"
                        }}
                    />
                    <Bar dataKey="Consumo" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="Consumo" position="top" style={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                    </Bar>
                    </BarChart>
                </ResponsiveContainer>
                ) : (
                <div className="flex h-[350px] flex-col items-center justify-center text-muted-foreground text-center">
                        <TrendingUp className="h-12 w-12 mb-4" />
                        <p className="font-semibold">
                            {selectedProducts.length === 0 ? "Nenhum produto selecionado" : "Sem dados de consumo"}
                        </p>
                        <p className="text-sm">
                            {selectedProducts.length === 0
                            ? "Selecione produtos no filtro para exibi-los no gráfico."
                            : user?.username === 'master' && selectedKiosk !== 'matriz' 
                                ? "Nenhum relatório de consumo encontrado para o quiosque selecionado."
                                : "Faça o upload de relatórios de consumo para gerar o gráfico."
                            }
                        </p>
                </div>
                )}
        </CardContent>
        </Card>

         {reportToDelete && (
            <DeleteConfirmationDialog
                open={!!reportToDelete}
                onOpenChange={() => setReportToDelete(null)}
                onConfirm={handleDeleteReportConfirm}
                itemName={`o relatório de consumo de ${reportToDelete.kioskName} (${reportToDelete.month}/${reportToDelete.year})`}
            />
        )}
    </div>
  )
}

    