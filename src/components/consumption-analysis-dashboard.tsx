
"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import { useAuth } from "@/hooks/use-auth"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useToast } from "@/hooks/use-toast"
import { type Product } from '@/types';
import { convertValue } from '@/lib/conversion';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, ListFilter, UploadCloud, Loader2, FileClock, Trash2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "./ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

import { type ConsumptionReport } from "@/types";
import { format } from "date-fns";
import { ptBR } from 'date-fns/locale';

const consumptionUploadSchema = z.object({
  kioskId: z.string().min(1, "Selecione um quiosque."),
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(new Date().getFullYear() - 5).max(new Date().getFullYear() + 5),
  file: z.any().refine((files) => files?.length > 0, "Selecione um arquivo."),
});

type ConsumptionUploadFormValues = z.infer<typeof consumptionUploadSchema>;

const normalizeString = (str: string) => {
    if (!str) return '';
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
};

const parseQuantity = (qtyString: string | number): number => {
    if (typeof qtyString === 'number') {
        return isNaN(qtyString) ? 0 : qtyString;
    }

    if (typeof qtyString !== 'string' || !qtyString.trim()) {
        return 0;
    }

    let numStr = qtyString.trim();

    if (numStr.startsWith('(') && numStr.endsWith(')')) {
        numStr = '-' + numStr.substring(1, numStr.length - 1);
    }

    const lastComma = numStr.lastIndexOf(',');
    const lastDot = numStr.lastIndexOf('.');

    if (lastComma > lastDot) {
        numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
        numStr = numStr.replace(/,/g, '');
    } else if (lastComma !== -1) {
        numStr = numStr.replace(',', '.');
    }

    numStr = numStr.replace(/[^0-9.-]/g, '');

    const parsed = parseFloat(numStr);
    return isNaN(parsed) ? 0 : parsed;
};


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
  
  const findAnalysisProductByName = (baseName: string): Product | undefined => {
    const normalizedName = normalizeString(baseName);
    if (!normalizedName) return undefined;
    return activeProducts.find(p => normalizeString(p.baseName) === normalizedName);
  }

  const onUploadSubmit = async (values: ConsumptionUploadFormValues) => {
    const file = values.file[0];
    if (!file || !user || productsLoading) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Dados incompletos para iniciar a análise.' });
      return;
    }

    setIsAnalyzing(true);
    
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            try {
                const rows = results.data as any[];
                if (rows.length === 0) throw new Error("A planilha CSV está vazia ou em formato inválido.");
                
                const kiosk = kiosks.find(k => k.id === values.kioskId);
                if (!kiosk) throw new Error("Quiosque selecionado inválido.");

                const analysisResults: { [productId: string]: { productName: string; consumedQuantity: number; count: number } } = {};
                const unmatchedItems = new Set<string>();

                for (const row of rows) {
                    const itemName = (row['Item'] || row['Produto'] || row['Descrição'])?.trim();
                    const unitFromCsv = (row['Unidade'] || row['unidade'])?.trim();
                    const quantityStr = (row['Qted.'] || row['Qtde.'] || row['Quantidade'] || row['Qtd'])?.trim();
                    
                    if (!itemName || !quantityStr) continue;

                    const productConfig = findAnalysisProductByName(itemName);
                    if (!productConfig) {
                        unmatchedItems.add(itemName);
                        continue;
                    }

                    const quantityValue = parseQuantity(quantityStr);
                    const unitToUse = unitFromCsv || productConfig.pdfUnit || productConfig.unit;
                    
                    const consumedQuantityInBaseUnit = convertValue(quantityValue, unitToUse, productConfig.unit, productConfig.category);
                    
                    if (!analysisResults[productConfig.id]) {
                        analysisResults[productConfig.id] = { 
                            productName: productConfig.baseName,
                            consumedQuantity: 0,
                            count: 0
                        };
                    }
                    analysisResults[productConfig.id].consumedQuantity += consumedQuantityInBaseUnit;
                    analysisResults[productConfig.id].count += 1;
                }

                if (unmatchedItems.size > 0) {
                    toast({
                        variant: 'destructive',
                        title: 'Alguns itens não foram encontrados',
                        description: `Os seguintes itens do CSV não foram localizados: ${Array.from(unmatchedItems).join(', ')}`,
                        duration: 10000,
                    });
                }
                
                const finalResults = Object.entries(analysisResults).map(([productId, data]) => ({
                    productId,
                    productName: data.productName,
                    consumedQuantity: data.consumedQuantity
                }));

                await addReport({
                    reportName: file.name,
                    month: values.month,
                    year: values.year,
                    kioskId: values.kioskId,
                    kioskName: kiosk.name,
                    createdAt: new Date().toISOString(),
                    status: 'completed',
                    results: finalResults,
                });
                
                toast({ title: 'Sucesso', description: `Relatório "${file.name}" analisado e salvo.` });

            } catch (error: any) {
                 toast({ variant: 'destructive', title: 'Erro na Análise', description: error.message || 'Não foi possível analisar o relatório.' });
            } finally {
                setIsAnalyzing(false);
                uploadForm.reset({ ...uploadForm.getValues(), file: undefined });
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        }
    });
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
        kioskConsumption[report.kioskId][item.productId].total += item.consumedQuantity;
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
        const avgQuantity = relevantConsumptionData[product.id] || 0;
        return {
          productId: product.id,
          name: `${product.baseName} (${product.unit})`,
          "Consumo": parseFloat(avgQuantity.toFixed(2)),
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
  const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
  ];
  const chartHeight = Math.max(350, chartData.length * 40);

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
                                        <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd. Consumida (Unidade Base)</TableHead></TableRow></TableHeader>
                                        <TableBody>
                                            {report.results.map((item, index) => {
                                                const productConfig = activeProducts.find(p => p.id === item.productId);
                                                return (
                                                    <TableRow key={index}>
                                                        <TableCell>{item.productName}</TableCell>
                                                        <TableCell className="text-right font-semibold">{item.consumedQuantity.toLocaleString()} {productConfig?.unit || ''}</TableCell>
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
        <Accordion type="single" collapsible className="w-full" defaultValue="importer">
          <AccordionItem value="importer" className="border-0">
            <Card>
                <AccordionTrigger className="w-full p-0 text-left hover:no-underline [&[data-state=open]>div>button>svg]:rotate-180">
                    <CardHeader className="flex-grow">
                    <CardTitle>Importar Relatório de Consumo</CardTitle>
                    <CardDescription>Faça o upload de um relatório de vendas/consumo em formato CSV para análise.</CardDescription>
                    </CardHeader>
                </AccordionTrigger>
              <AccordionContent>
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
                              <FormLabel>Arquivo (CSV)</FormLabel>
                              <FormControl>
                              <Input
                                  type="file"
                                  accept=".csv"
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
              </AccordionContent>
            </Card>
          </AccordionItem>
        </Accordion>

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
        <CardContent className="pr-2 pl-0">
            { loadingData ? (
                <Skeleton className="h-[350px] w-full" />
                ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart
                        layout="vertical"
                        data={chartData}
                        margin={{
                            top: 5,
                            right: 50,
                            left: 20,
                            bottom: 5,
                        }}
                    >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={150}
                            tick={{ fontSize: 12 }}
                            interval={0}
                        />
                        <Tooltip 
                            cursor={{fill: 'hsl(var(--muted))'}}
                            contentStyle={{ 
                                backgroundColor: "hsl(var(--background))", 
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "var(--radius)"
                            }}
                        />
                        <Bar dataKey="Consumo" radius={[0, 4, 4, 0]}>
                           {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                            ))}
                            <LabelList dataKey="Consumo" position="right" offset={10} style={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
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
