"use client"

import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { type ConsumptionReport, type Kiosk, type SalesReport, type SalesReportItem } from '@/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UploadCloud, Loader2 } from 'lucide-react';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { convertValue } from '@/lib/conversion';
import { ToastAction } from '@/components/ui/toast';
import { useSalesReports } from '@/contexts/sales-report-context';


const consumptionUploadSchema = z.object({
  kioskId: z.string().min(1, "Selecione um quiosque."),
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(new Date().getFullYear() - 5).max(new Date().getFullYear() + 5),
  file: z.any().refine((files) => files?.length > 0, "Selecione um arquivo."),
});

type ConsumptionUploadFormValues = z.infer<typeof consumptionUploadSchema>;

const parseQuantity = (qtyString: string | number): number => {
    if (typeof qtyString === 'number') {
        return isNaN(qtyString) ? 0 : qtyString;
    }
    if (typeof qtyString !== 'string' || !qtyString.trim()) {
        return 0;
    }
    const cleanedString = String(qtyString)
        .replace(/\./g, '')
        .replace(',', '.');
        
    const parsed = parseFloat(cleanedString);
    return isNaN(parsed) ? 0 : parsed;
};

interface ConsumptionImportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kiosks: Kiosk[];
    addReport: (report: Omit<ConsumptionReport, 'id'>) => Promise<string | null>;
}

export function ConsumptionImportModal({ open, onOpenChange, kiosks, addReport }: ConsumptionImportModalProps) {
    const { user } = useAuth();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const { simulations, simulationItems } = useProductSimulation();
    const { baseProducts } = useBaseProducts();
    const { addSalesReport } = useSalesReports();


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
        if (!file || !user) {
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

                    const consumptionByBaseProduct: { [baseProductId: string]: { name: string; quantity: number } } = {};
                    const salesByProduct: SalesReportItem[] = [];
                    const unmatchedSkus = new Set<string>();

                    for (const row of rows) {
                        const sku = row['codigo']?.trim();
                        const quantitySoldStr = row['quantidade'];

                        if (!sku || quantitySoldStr === undefined || quantitySoldStr === null) continue;

                        const quantitySold = parseQuantity(quantitySoldStr);
                        if (quantitySold <= 0) continue;

                        const simulation = simulations.find(s => s.ppo?.sku === sku);
                        if (!simulation) {
                            unmatchedSkus.add(sku);
                            continue;
                        }

                        salesByProduct.push({
                            sku,
                            productName: simulation.name,
                            simulationId: simulation.id,
                            quantity: quantitySold,
                        });

                        const itemsForSim = simulationItems.filter(i => i.simulationId === simulation.id);

                        for (const simItem of itemsForSim) {
                            const baseProduct = baseProducts.find(bp => bp.id === simItem.baseProductId);
                            if (!baseProduct) continue;

                            let consumedInBaseUnit = 0;
                            try {
                                const valueOfOneSimItemInBase = convertValue(simItem.quantity, simItem.overrideUnit || baseProduct.unit, baseProduct.unit, baseProduct.category);
                                consumedInBaseUnit = quantitySold * valueOfOneSimItemInBase;
                            } catch (e) {
                                console.error(`Error converting values for explosion for SKU ${sku}:`, e);
                                unmatchedSkus.add(`${sku} (erro de conversão)`);
                                continue; 
                            }
                            
                            if (!consumptionByBaseProduct[baseProduct.id]) {
                                consumptionByBaseProduct[baseProduct.id] = { name: baseProduct.name, quantity: 0 };
                            }
                            consumptionByBaseProduct[baseProduct.id].quantity += consumedInBaseUnit;
                        }
                    }
                    
                    const finalResults = Object.entries(consumptionByBaseProduct).map(([baseProductId, data]) => ({
                        productId: baseProductId,
                        productName: data.name,
                        consumedQuantity: data.quantity,
                        baseProductId: baseProductId,
                    }));

                    if (finalResults.length === 0) {
                        if (unmatchedSkus.size > 0) {
                            throw new Error("Nenhum dos SKUs no relatório correspondeu a uma mercadoria cadastrada.");
                        } else {
                            throw new Error("Nenhum item do relatório foi processado.");
                        }
                    }
                     
                    const newReport: Omit<ConsumptionReport, 'id'> = {
                        reportName: file.name,
                        month: values.month,
                        year: values.year,
                        kioskId: values.kioskId,
                        kioskName: kiosk.name,
                        createdAt: new Date().toISOString(),
                        status: 'completed',
                        results: finalResults,
                    };
                    
                    const consumptionReportId = await addReport(newReport);

                    const salesReport: Omit<SalesReport, 'id'> = {
                        reportName: file.name,
                        month: values.month,
                        year: values.year,
                        kioskId: values.kioskId,
                        kioskName: kiosk.name,
                        createdAt: new Date().toISOString(),
                        consumptionReportId: consumptionReportId || undefined,
                        items: salesByProduct,
                    };
                    await addSalesReport(salesReport);
                    
                    if (unmatchedSkus.size > 0) {
                        const unmatchedSkuList = Array.from(unmatchedSkus).join(', ');
                        toast({
                            variant: 'default',
                            title: 'Relatório processado com avisos',
                            description: `${finalResults.length} tipo(s) de insumo calculados, mas ${unmatchedSkus.size} SKU(s) ignorados.`,
                            duration: 10000,
                            action: (
                              <ToastAction altText="Copiar SKUs" onClick={() => navigator.clipboard.writeText(unmatchedSkuList)}>
                                Copiar SKUs
                              </ToastAction>
                            ),
                        });
                    } else {
                        toast({ title: 'Sucesso!', description: 'Relatório processado com sucesso.' });
                    }
                    
                    onOpenChange(false);

                } catch (error: any) {
                    toast({ variant: 'destructive', title: 'Erro na análise', description: error.message });
                } finally {
                    setIsAnalyzing(false);
                    uploadForm.reset({ ...uploadForm.getValues(), file: undefined });
                    if (fileInputRef.current) fileInputRef.current.value = "";
                }
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Importar relatório de vendas</DialogTitle>
                    <DialogDescription>
                        Faça o upload do seu relatório de vendas (CSV) para calcular o consumo e atualizar as estatísticas.
                    </DialogDescription>
                </DialogHeader>
                <Form {...uploadForm}>
                    <form onSubmit={uploadForm.handleSubmit(onUploadSubmit)} className="space-y-4 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <FormField control={uploadForm.control} name="kioskId" render={({ field }) => (
                                <FormItem className="col-span-2"><FormLabel>Quiosque</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                    <SelectContent>{kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                                </Select><FormMessage /></FormItem>
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
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit" disabled={isAnalyzing}>
                                {isAnalyzing ? <Loader2 className="mr-2 animate-spin" /> : <UploadCloud className="mr-2" />}
                                {isAnalyzing ? 'Analisando...' : 'Analisar relatório'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
