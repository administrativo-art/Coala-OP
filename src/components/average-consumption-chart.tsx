
      "use client"

import { useMemo, useState, useEffect } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"
import { useKiosks } from "@/hooks/use-kiosks"
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import Papa from 'papaparse';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, ListFilter, Download, ArrowUpDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion"

const formatNumberForDisplay = (value: number) => {
    if (typeof value !== 'number' || isNaN(value)) return "0";
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

type SortKey = 'name' | 'Consumo';
type SortDirection = 'asc' | 'desc';

export function AverageConsumptionChart() {
  const { user } = useAuth()
  const { kiosks, loading: kiosksLoading } = useKiosks();
  
  const { reports: consumptionHistory, baseProducts, isLoading: consumptionLoading, hasValidData } = useValidatedConsumptionData();

  const [selectedKiosk, setSelectedKiosk] = useState<string>('');
  const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([])
  const [initialSelectionMade, setInitialSelectionMade] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey, direction: SortDirection }>({ key: 'Consumo', direction: 'desc' });
  
  useEffect(() => {
    if (user && !selectedKiosk && !kiosksLoading && kiosks.length > 0) {
       const defaultKiosk = user.username === 'Tiago Brasil' ? 'matriz' : (user.assignedKioskIds?.[0] || '');
       setSelectedKiosk(defaultKiosk);
    }
  }, [user, selectedKiosk, kiosks, kiosksLoading]);

  useEffect(() => {
    if (!initialSelectionMade && baseProducts.length > 0) {
      setSelectedBaseProducts(baseProducts.map(p => p.id));
      setInitialSelectionMade(true);
    }
  }, [baseProducts, initialSelectionMade]);

  const chartData = useMemo(() => {
    if (!hasValidData || !user || !selectedKiosk) return [];

    const isMatrixView = selectedKiosk === 'matriz';
    
    const relevantReports = isMatrixView
      ? consumptionHistory.filter(r => r.kioskId !== 'matriz')
      : consumptionHistory.filter(r => r.kioskId === selectedKiosk);

    const consumptionByBaseId: { [baseProductId: string]: { total: number; monthsCount: number, monthlyValues: number[] } } = {};
    baseProducts.forEach(bp => {
        consumptionByBaseId[bp.id] = { total: 0, monthsCount: 0, monthlyValues: [] };
    });
    
    const monthlyConsumptionByBaseId: Record<string, Record<string, number>> = {};
    relevantReports.forEach(report => {
        const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
        report.results.forEach(res => {
            if (res.baseProductId) {
                if (!monthlyConsumptionByBaseId[res.baseProductId]) monthlyConsumptionByBaseId[res.baseProductId] = {};
                monthlyConsumptionByBaseId[res.baseProductId][key] = (monthlyConsumptionByBaseId[res.baseProductId][key] || 0) + res.consumedQuantity;
            }
        });
    });

    const allNetworkMonths = new Set<string>();
    if (isMatrixView) {
        for (const report of relevantReports) {
            const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
            const anyConsumption = Array.isArray(report.results) && report.results.some(r => (r?.consumedQuantity ?? 0) > 0);
            if (anyConsumption) allNetworkMonths.add(key);
        }
    }
    const networkMonthsCount = allNetworkMonths.size;

    const dataToSort = baseProducts
        .filter(bp => selectedBaseProducts.includes(bp.id))
        .map(baseProduct => {
            const productMonthlyData = monthlyConsumptionByBaseId[baseProduct.id] || {};
            const monthsWithConsumption = Object.values(productMonthlyData).filter(v => v > 0);
            const totalConsumption = monthsWithConsumption.reduce((sum, val) => sum + val, 0);

            let denominator;
            if (isMatrixView) {
                denominator = networkMonthsCount > 0 ? networkMonthsCount : 1;
            } else {
                denominator = monthsWithConsumption.length > 0 ? monthsWithConsumption.length : 1;
            }
            
            const average = totalConsumption / denominator;
            
            return {
                baseProductId: baseProduct.id,
                name: `${baseProduct.name} (${baseProduct.unit})`,
                "Consumo": parseFloat(average.toFixed(2)),
            };
        });

    return dataToSort.sort((a, b) => {
        if (sortConfig.key === 'name') {
            return sortConfig.direction === 'asc' 
                ? a.name.localeCompare(b.name) 
                : b.name.localeCompare(a.name);
        } else {
            return sortConfig.direction === 'asc' 
                ? a.Consumo - b.Consumo 
                : b.Consumo - a.Consumo;
        }
    });

  }, [user, consumptionHistory, baseProducts, hasValidData, selectedKiosk, selectedBaseProducts, sortConfig]);

  const handleExportPdf = () => {
    if (chartData.length === 0) return;
    
    const doc = new jsPDF();
    const kioskName = selectedKiosk === 'matriz' ? 'Todos os quiosques (soma)' : kiosks.find(k => k.id === selectedKiosk)?.name || 'Quiosque desconhecido';
    const monthYear = format(new Date(), 'MMMM yyyy', { locale: ptBR });
    
    doc.setFontSize(18);
    doc.text(`Relatório de consumo médio mensal`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Quiosque: ${kioskName}`, 14, 29);
    doc.text(`Gerado em: ${monthYear}`, 14, 35);

    const tableHead = [['Produto base (unidade)', 'Consumo médio']];
    const tableBody = chartData.map(item => [
        item.name,
        formatNumberForDisplay(item.Consumo),
    ]);

    autoTable(doc, {
        startY: 45,
        head: tableHead,
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: '#3F51B5' },
    });
    
    doc.save(`consumo_medio_base_${kioskName.replace(/\s/g, '_')}_${format(new Date(), 'MM-yyyy')}.pdf`);
  };

  const handleExportCsv = () => {
    if (chartData.length === 0) return;

    const kioskName = selectedKiosk === 'matriz' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKiosk)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    const monthYear = format(new Date(), 'MM-yyyy');
    
    const csvData = chartData.map(item => ({
        "Produto Base (unidade)": item.name,
        "Consumo Medio": formatNumberForDisplay(item.Consumo),
    }));
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consumo_medio_base_${kioskName}_${monthYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    if (chartData.length === 0) return;

    const kioskName = selectedKiosk === 'matriz' ? 'Todos os Quiosques (soma)' : kiosks.find(k => k.id === selectedKiosk)?.name || 'Quiosque Desconhecido';
    const monthYear = format(new Date(), 'MM-yyyy');
    
    const exportData = {
      kiosk: kioskName,
      month: monthYear,
      generated_at: new Date().toISOString(),
      data: chartData.map(item => ({
        base_product_name: item.name,
        average_consumption: item.Consumo,
        base_product_id: item.baseProductId,
      }))
    };

    const jsonData = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filenameKiosk = selectedKiosk === 'matriz' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKiosk)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consumo_medio_base_${filenameKiosk}_${monthYear}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBaseProductSelection = (baseProductId: string, checked: boolean) => {
    setSelectedBaseProducts(current => {
        if (checked) {
            return [...current, baseProductId];
        } else {
            return current.filter(id => id !== baseProductId);
        }
    });
  }

  const handleSortChange = (value: string) => {
    const [key, direction] = value.split('-') as [SortKey, SortDirection];
    setSortConfig({ key, direction });
  }

  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a, b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);
  
  const loadingData = consumptionLoading || kiosksLoading;
  const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
  ];
  const chartHeight = Math.max(350, chartData.length * 40);

  const cardTitle = useMemo(() => {
    const kioskName = kiosks.find(k => k.id === selectedKiosk)?.name;
    let title = "Consumo médio mensal";
    if (kioskName) {
        title += ` - ${kioskName}`;
    }
    return title;
  }, [selectedKiosk, kiosks]);

  return (
    <Card>
      <Accordion type="single" collapsible className="w-full" defaultValue="consumption-chart">
        <AccordionItem value="consumption-chart" className="border-b-0">
          <AccordionTrigger className="p-4 hover:no-underline">
            <div className="flex flex-col gap-4 w-full">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-6 w-6" /> {cardTitle}
                    </CardTitle>
                    <CardDescription>
                        {user?.username === 'Tiago Brasil' 
                            ? (selectedKiosk === 'matriz' ? 'Soma do consumo médio mensal de todos os quiosques.' : `Produtos consumidos no quiosque selecionado.`)
                            : `Produtos consumidos no seu quiosque.`}
                    </CardDescription>
                </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4 pt-0">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:justify-end mb-4">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full sm:w-auto">
                            <ListFilter className="mr-2 h-4 w-4" />
                            Filtrar produtos ({selectedBaseProducts.length})
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64">
                        <DropdownMenuLabel>Exibir produtos base</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setSelectedBaseProducts(baseProducts.map(p => p.id))}>Selecionar todos</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setSelectedBaseProducts([])}>Limpar seleção</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <ScrollArea className="h-60">
                        {baseProducts.sort((a,b) => a.name.localeCompare(b.name)).map(product => (
                            <DropdownMenuCheckboxItem
                                key={product.id}
                                checked={selectedBaseProducts.includes(product.id)}
                                onCheckedChange={(checked) => handleBaseProductSelection(product.id, !!checked)}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {product.name}
                            </DropdownMenuCheckboxItem>
                        ))}
                        </ScrollArea>
                    </DropdownMenuContent>
                </DropdownMenu>

                {user?.username === 'Tiago Brasil' && (
                    <Select value={selectedKiosk} onValueChange={setSelectedKiosk} disabled={kiosksLoading}>
                        <SelectTrigger className="w-full sm:w-[240px]">
                            <SelectValue placeholder="Selecionar quiosque" />
                        </SelectTrigger>
                        <SelectContent>
                            {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                )}
                 <Select value={`${sortConfig.key}-${sortConfig.direction}`} onValueChange={handleSortChange}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <ArrowUpDown className="mr-2 h-4 w-4" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Consumo-desc">Consumo (Maior para menor)</SelectItem>
                        <SelectItem value="Consumo-asc">Consumo (Menor para maior)</SelectItem>
                        <SelectItem value="name-asc">Nome (A-Z)</SelectItem>
                        <SelectItem value="name-desc">Nome (Z-A)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="pr-2 pl-0">
                { (loadingData) ? (
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
                            <XAxis type="number" tickFormatter={formatNumberForDisplay} />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={150}
                                tick={{ fontSize: 12 }}
                                interval={0}
                            />
                            <Tooltip 
                                cursor={{fill: 'hsl(var(--muted))'}}
                                formatter={formatNumberForDisplay}
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
                                <LabelList dataKey="Consumo" position="right" offset={10} formatter={formatNumberForDisplay} style={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    ) : (
                    <div className="flex h-[350px] flex-col items-center justify-center text-muted-foreground text-center">
                            <TrendingUp className="h-12 w-12 mb-4" />
                            <p className="font-semibold">
                                {selectedBaseProducts.length === 0 ? "Nenhum produto selecionado" : "Sem dados de consumo"}
                            </p>
                            <p className="text-sm">
                                {selectedBaseProducts.length === 0
                                ? "Selecione produtos base no filtro para exibi-los no gráfico."
                                : user?.username === 'Tiago Brasil' && selectedKiosk !== 'matriz' 
                                    ? "Nenhum relatório de consumo encontrado para o quiosque selecionado."
                                    : "Faça o upload de relatórios de consumo para gerar o gráfico."
                                }
                            </p>
                    </div>
                    )}
            </div>
            <CardFooter className="pt-4 border-t justify-end">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" disabled={chartData.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Exportar relatório
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onSelect={handleExportPdf}>Exportar como PDF</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportCsv}>Exportar como CSV</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportJson}>Exportar como JSON</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  )
}
