
"use client"

import { useMemo, useState, useEffect } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useToast } from "@/hooks/use-toast"
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import Papa from 'papaparse';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, ListFilter, UploadCloud, History, Scale, Download } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConsumptionHistoryModal } from "./consumption-history-modal";
import { ConsumptionImportModal } from "./consumption-import-modal";
import { ConsumptionComparisonModal } from "./consumption-comparison-modal"


export function ConsumptionAnalysisDashboard() {
  const { user } = useAuth()
  const { products, loading: productsLoading } = useStockAnalysisProducts()
  const { history: consumptionHistory, loading: consumptionLoading, addReport, deleteReport } = useConsumptionAnalysis()
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { toast } = useToast();

  const [selectedKiosk, setSelectedKiosk] = useState<string>('matriz');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [initialSelectionMade, setInitialSelectionMade] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);

  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);

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

    const kioskIdForChart = user.username === 'Tiago Brasil' ? selectedKiosk : user.kioskId;
    let relevantConsumptionData: { [productId: string]: number } = {};

    if (kioskIdForChart === 'matriz' && user.username === 'Tiago Brasil') {
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

  const handleExportPdf = () => {
    if (chartData.length === 0) {
        toast({
            variant: "destructive",
            title: "Sem dados para exportar",
            description: "Não há dados de consumo para os filtros selecionados.",
        });
        return;
    }

    const doc = new jsPDF();
    const kioskName = selectedKiosk === 'matriz' ? 'Todos os Quiosques (soma)' : kiosks.find(k => k.id === selectedKiosk)?.name || 'Quiosque Desconhecido';
    const monthYear = format(new Date(), 'MMMM yyyy', { locale: ptBR });
    
    doc.setFontSize(18);
    doc.text(`Relatório de Consumo Médio Mensal`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Quiosque: ${kioskName}`, 14, 29);
    doc.text(`Gerado em: ${monthYear}`, 14, 35);

    const tableHead = [['Produto (unidade)', 'Consumo Médio']];
    const tableBody = chartData.map(item => [
        item.name,
        item.Consumo.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    ]);

    autoTable(doc, {
        startY: 45,
        head: tableHead,
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: '#3F51B5' },
    });
    
    doc.save(`consumo_medio_${kioskName.replace(/\s/g, '_')}_${format(new Date(), 'MM-yyyy')}.pdf`);
  };

  const handleExportCsv = () => {
    if (chartData.length === 0) {
        toast({
            variant: "destructive",
            title: "Sem dados para exportar",
            description: "Não há dados de consumo para os filtros selecionados.",
        });
        return;
    }

    const kioskName = selectedKiosk === 'matriz' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKiosk)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    const monthYear = format(new Date(), 'MM-yyyy');
    
    const csvData = chartData.map(item => ({
        "Produto (unidade)": item.name,
        "Consumo Medio": item.Consumo,
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consumo_medio_${kioskName}_${monthYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    if (chartData.length === 0) {
        toast({
            variant: "destructive",
            title: "Sem dados para exportar",
            description: "Não há dados de consumo para os filtros selecionados.",
        });
        return;
    }

    const kioskName = selectedKiosk === 'matriz' ? 'Todos os Quiosques (soma)' : kiosks.find(k => k.id === selectedKiosk)?.name || 'Quiosque Desconhecido';
    const monthYear = format(new Date(), 'MM-yyyy');
    
    const exportData = {
      kiosk: kioskName,
      month: monthYear,
      generated_at: new Date().toISOString(),
      data: chartData.map(item => ({
        product_name: item.name,
        average_consumption: item.Consumo,
        product_id: item.productId,
      }))
    };
    
    const jsonData = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filenameKiosk = selectedKiosk === 'matriz' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKiosk)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consumo_medio_${filenameKiosk}_${monthYear}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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

  return (
    <>
        <div className="space-y-6">
            <div className="flex justify-end">
                <Button onClick={() => setIsImportModalOpen(true)}>
                    <UploadCloud className="mr-2" />
                    Importar Relatório de Consumo
                </Button>
            </div>
            
            <Card>
            <CardHeader className="flex flex-col gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-6 w-6" /> Consumo Médio Mensal
                    </CardTitle>
                    <CardDescription>
                        {user?.username === 'Tiago Brasil' 
                            ? (selectedKiosk === 'matriz' ? 'Soma do consumo médio mensal de todos os quiosques.' : `Produtos consumidos no quiosque selecionado.`)
                            : `Produtos consumidos no seu quiosque.`}
                    </CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:justify-end">
                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsHistoryModalOpen(true)}>
                        <History className="mr-2 h-4 w-4" /> Histórico
                    </Button>
                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsComparisonModalOpen(true)}>
                        <Scale className="mr-2 h-4 w-4" /> Analisar Variação
                    </Button>
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

                    {user?.username === 'Tiago Brasil' && (
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
                                : user?.username === 'Tiago Brasil' && selectedKiosk !== 'matriz' 
                                    ? "Nenhum relatório de consumo encontrado para o quiosque selecionado."
                                    : "Faça o upload de relatórios de consumo para gerar o gráfico."
                                }
                            </p>
                    </div>
                    )}
            </CardContent>
            <CardFooter className="pt-4 border-t justify-end">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Download className="mr-2 h-4 w-4" />
                            Exportar Relatório
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onSelect={handleExportPdf}>Exportar como PDF</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportCsv}>Exportar como CSV</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportJson}>Exportar como JSON</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
            </Card>
        </div>

        <ConsumptionHistoryModal
            open={isHistoryModalOpen}
            onOpenChange={setIsHistoryModalOpen}
            history={consumptionHistory}
            loading={consumptionLoading}
            deleteReport={deleteReport}
        />
        
        <ConsumptionImportModal
            open={isImportModalOpen}
            onOpenChange={setIsImportModalOpen}
            kiosks={kiosks}
            products={products}
            addReport={addReport}
        />

        <ConsumptionComparisonModal
            open={isComparisonModalOpen}
            onOpenChange={setIsComparisonModalOpen}
            history={consumptionHistory}
            products={activeProducts}
            kiosks={kiosks}
        />
    </>
  )
}
