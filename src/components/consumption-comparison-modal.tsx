
"use client"

import { useState, useMemo } from "react";
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useAuth } from "@/hooks/use-auth";
import { type ConsumptionReport, type Product, type Kiosk } from "@/types";
import { compareConsumption, type ComparisonInput } from "@/ai/flows/compare-consumption-flow";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Wand2, Scale, Loader2 } from "lucide-react";

interface ConsumptionComparisonModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    history: ConsumptionReport[];
    products: Product[];
    kiosks: Kiosk[];
}

const comparisonSchema = z.object({
  kioskId: z.string().min(1, "Selecione um quiosque."),
  periodA: z.string().min(1, "Selecione o período A."),
  periodB: z.string().min(1, "Selecione o período B."),
}).refine(data => data.periodA !== data.periodB, {
  message: "Os períodos A e B não podem ser iguais.",
  path: ["periodB"],
});


type ComparisonFormValues = z.infer<typeof comparisonSchema>;

type ComparisonResult = {
    productName: string;
    unit: string;
    consumptionA: number;
    consumptionB: number;
    variation: number;
    variationPercent: number;
}

export function ConsumptionComparisonModal({ open, onOpenChange, history, products, kiosks }: ConsumptionComparisonModalProps) {
    const { user } = useAuth();
    const [results, setResults] = useState<ComparisonResult[]>([]);
    const [isComparing, setIsComparing] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<string>('');

    const form = useForm<ComparisonFormValues>({
        resolver: zodResolver(comparisonSchema),
        defaultValues: { kioskId: user?.username !== 'master' ? user?.kioskId : '' }
    });

    const availablePeriods = useMemo(() => {
        const kioskId = form.watch('kioskId');
        const periods = new Set<string>();
        history
            .filter(report => !kioskId || report.kioskId === kioskId)
            .forEach(report => {
                periods.add(`${report.year}-${String(report.month).padStart(2, '0')}`);
        });
        return Array.from(periods).sort().reverse();
    }, [history, form.watch('kioskId')]);

    const handleCompare = (values: ComparisonFormValues) => {
        setIsComparing(true);
        setResults([]);
        setAiAnalysis('');
        
        const [yearA, monthA] = values.periodA.split('-').map(Number);
        const [yearB, monthB] = values.periodB.split('-').map(Number);
        
        const reportA = history.find(r => r.kioskId === values.kioskId && r.year === yearA && r.month === monthA);
        const reportB = history.find(r => r.kioskId === values.kioskId && r.year === yearB && r.month === monthB);
        
        if (!reportA || !reportB) {
            setIsComparing(false);
            return;
        }

        const consumptionMapA = new Map(reportA.results.map(r => [r.productId, r.consumedQuantity]));
        const consumptionMapB = new Map(reportB.results.map(r => [r.productId, r.consumedQuantity]));
        const allProductIds = new Set([...consumptionMapA.keys(), ...consumptionMapB.keys()]);
        const comparisonResults: ComparisonResult[] = [];

        allProductIds.forEach(productId => {
            const product = products.find(p => p.id === productId);
            if (!product) return;

            const consumptionA = consumptionMapA.get(productId) || 0;
            const consumptionB = consumptionMapB.get(productId) || 0;
            const variation = consumptionB - consumptionA;
            const variationPercent = consumptionA !== 0 ? (variation / consumptionA) * 100 : (consumptionB > 0 ? Infinity : 0);

            comparisonResults.push({
                productName: product.baseName,
                unit: product.unit,
                consumptionA,
                consumptionB,
                variation,
                variationPercent
            });
        });

        setResults(comparisonResults.sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation)));
        setIsComparing(false);
    };

    const handleAiAnalysis = async () => {
        if (results.length === 0) return;
        setIsAnalyzing(true);
        setAiAnalysis('');
        
        const values = form.getValues();
        const [yearA, monthA] = values.periodA.split('-')
        const [yearB, monthB] = values.periodB.split('-')
        
        const periodALabel = `${monthA}/${yearA}`;
        const periodBLabel = `${monthB}/${yearB}`;
        
        try {
            const aiInput: ComparisonInput = {
                periodA: periodALabel,
                periodB: periodBLabel,
                items: results.map(r => ({
                    productName: r.productName,
                    consumptionA: r.consumptionA,
                    consumptionB: r.consumptionB,
                    unit: r.unit,
                }))
            };
            const analysis = await compareConsumption(aiInput);
            setAiAnalysis(analysis);
        } catch (error) {
            console.error("AI analysis failed:", error);
            setAiAnalysis("Ocorreu um erro ao gerar a análise. Tente novamente.");
        } finally {
            setIsAnalyzing(false);
        }
    };
    
    const sortedKiosks = kiosks.sort((a,b) => {
      if (a.id === 'matriz') return -1;
      if (b.id === 'matriz') return 1;
      return a.name.localeCompare(b.name);
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Scale /> Comparar Consumo Mensal</DialogTitle>
                    <DialogDescription>
                        Selecione dois períodos para analisar a variação no consumo de insumos.
                    </DialogDescription>
                </DialogHeader>
                
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleCompare)} className="flex flex-col sm:flex-row gap-2 items-end border-b pb-4">
                        <FormField control={form.control} name="kioskId" render={({ field }) => (
                            <FormItem className="w-full sm:w-auto flex-grow"><FormLabel>Quiosque</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value} disabled={user?.username !== 'master'}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                <SelectContent>{sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                            </Select><FormMessage />
                            </FormItem>
                        )}/>
                         <FormField control={form.control} name="periodA" render={({ field }) => (
                            <FormItem><FormLabel>Período A</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={!form.getValues('kioskId')}><FormControl><SelectTrigger className="w-[180px]"><SelectValue placeholder="Mês/Ano A" /></SelectTrigger></FormControl>
                                <SelectContent>{availablePeriods.map(p => <SelectItem key={p} value={p}>{p.split('-')[1]}/{p.split('-')[0]}</SelectItem>)}</SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                         )}/>
                         <FormField control={form.control} name="periodB" render={({ field }) => (
                            <FormItem><FormLabel>Período B</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={!form.getValues('kioskId')}><FormControl><SelectTrigger className="w-[180px]"><SelectValue placeholder="Mês/Ano B" /></SelectTrigger></FormControl>
                                <SelectContent>{availablePeriods.map(p => <SelectItem key={p} value={p}>{p.split('-')[1]}/{p.split('-')[0]}</SelectItem>)}</SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                         )}/>
                        <Button type="submit" disabled={isComparing}>
                           {isComparing ? <Loader2 className="mr-2 animate-spin" /> : 'Comparar'}
                        </Button>
                    </form>
                </Form>

                <div className="flex-grow overflow-hidden mt-4">
                    <ScrollArea className="h-full pr-4">
                        {results.length > 0 ? (
                             <div className="space-y-4">
                                <div className="rounded-md border">
                                    <Table>
                                        <TableHeader><TableRow>
                                            <TableHead>Insumo</TableHead>
                                            <TableHead>Período A</TableHead>
                                            <TableHead>Período B</TableHead>
                                            <TableHead>Variação</TableHead>
                                        </TableRow></TableHeader>
                                        <TableBody>{results.map((r, i) => {
                                            const variationClass = r.variation > 0 ? 'text-green-600' : r.variation < 0 ? 'text-red-600' : '';
                                            const percentText = isFinite(r.variationPercent) ? `(${r.variation > 0 ? '+' : ''}${r.variationPercent.toFixed(1)}%)` : '(Novo)';
                                            
                                            return (
                                                <TableRow key={i}>
                                                    <TableCell className="font-medium">{r.productName}</TableCell>
                                                    <TableCell>{r.consumptionA.toLocaleString(undefined, {maximumFractionDigits: 2})} {r.unit}</TableCell>
                                                    <TableCell>{r.consumptionB.toLocaleString(undefined, {maximumFractionDigits: 2})} {r.unit}</TableCell>
                                                    <TableCell className={variationClass}>
                                                        {r.variation.toFixed(2)} {percentText}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        }}</TableBody>
                                    </Table>
                                </div>
                                <div className="space-y-2">
                                    <Button onClick={handleAiAnalysis} disabled={isAnalyzing}>
                                        <Wand2 className="mr-2" /> 
                                        {isAnalyzing ? "Analisando..." : "Obter Análise da IA"}
                                    </Button>
                                    {isAnalyzing && <Skeleton className="h-16 w-full" />}
                                    {aiAnalysis && (
                                        <Alert>
                                            <AlertTitle className="flex items-center gap-2"><Wand2 /> Análise Inteligente</AlertTitle>
                                            <AlertDescription className="pt-2">{aiAnalysis}</AlertDescription>
                                        </Alert>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center text-muted-foreground text-center">
                                <Scale className="h-12 w-12 mb-4" />
                                <p className="font-semibold">Aguardando comparação</p>
                                <p className="text-sm">Selecione o quiosque e os períodos para iniciar.</p>
                            </div>
                        )}
                    </ScrollArea>
                </div>

                <DialogFooter className="pt-4 mt-auto border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
