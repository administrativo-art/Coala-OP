

"use client"

import { useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { type BaseProduct, type ConsumptionReport, type Kiosk } from '@/types';
import { convertValue, units } from '@/lib/conversion';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UploadCloud, Loader2 } from 'lucide-react';


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

const getCategoryForUnit = (unit: string) => {
    const lowerUnit = unit.toLowerCase();
    for (const category in units) {
        const categoryUnits = units[category as keyof typeof units];
        if (Object.keys(categoryUnits).some(u => u.toLowerCase() === lowerUnit)) {
            return category as keyof typeof units;
        }
    }
    return null;
}

interface ConsumptionImportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kiosks: Kiosk[];
    baseProducts: BaseProduct[];
    addReport: (report: Omit<ConsumptionReport, 'id'>) => Promise<string | null>;
}

export function ConsumptionImportModal({ open, onOpenChange, kiosks, baseProducts, addReport }: ConsumptionImportModalProps) {
    const { user } = useAuth();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const uploadForm = useForm<ConsumptionUploadFormValues>({
        resolver: zodResolver(consumptionUploadSchema),
        defaultValues: {
            kioskId: '',
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
            file: undefined,
        }
    });

    const findBaseProductByName = (name: string): BaseProduct | undefined => {
        const normalizedName = normalizeString(name);
        if (!normalizedName) return undefined;
        return baseProducts.find(p => normalizeString(p.name) === normalizedName);
    }

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

                    const analysisResults: { [baseProductId: string]: { productName: string; consumedQuantity: number; count: number } } = {};
                    const unmatchedItems = new Set<string>();

                    for (const row of rows) {
                        const itemName = (row['Item'] || row['Produto'] || row['Descrição'])?.trim();
                        const unitFromCsv = (row['Unidade'] || row['unidade'])?.trim();
                        const quantityStr = (row['Qted.'] || row['Qtde.'] || row['Quantidade'] || row['Qtd'])?.trim();
                        
                        if (!itemName || !quantityStr) continue;

                        const baseProductConfig = findBaseProductByName(itemName);
                        if (!baseProductConfig) {
                            unmatchedItems.add(itemName);
                            continue;
                        }
                        
                        const quantityValue = parseQuantity(quantityStr);
                        const category = getCategoryForUnit(baseProductConfig.unit);

                        if (!category) {
                             unmatchedItems.add(itemName);
                             console.warn(`Could not determine category for unit "${baseProductConfig.unit}" on base product "${baseProductConfig.name}"`);
                             continue;
                        }
                        
                        const consumedQuantityInBaseUnit = convertValue(quantityValue, unitFromCsv || baseProductConfig.unit, baseProductConfig.unit, category);
                        
                        if (!analysisResults[baseProductConfig.id]) {
                            analysisResults[baseProductConfig.id] = { 
                                productName: baseProductConfig.name,
                                consumedQuantity: 0,
                                count: 0
                            };
                        }
                        analysisResults[baseProductConfig.id].consumedQuantity += consumedQuantityInBaseUnit;
                        analysisResults[baseProductConfig.id].count += 1;
                    }

                    if (unmatchedItems.size > 0) {
                        toast({
                            variant: 'destructive',
                            title: 'Alguns itens não foram encontrados ou não tem Produto Base',
                            description: `Os seguintes itens do CSV foram ignorados: ${Array.from(unmatchedItems).join(', ')}`,
                            duration: 10000,
                        });
                    }
                    
                    const finalResults = Object.entries(analysisResults).map(([baseProductId, data]) => ({
                        productId: '', 
                        productName: data.productName,
                        consumedQuantity: data.consumedQuantity,
                        baseProductId: baseProductId,
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
                    
                    toast({ title: 'Sucesso', description: `Relatório analisado e salvo.` });
                    onOpenChange(false);

                } catch (error: any) {
                    toast({ variant: 'destructive', title: 'Erro na análise', description: error.message || 'Não foi possível analisar o relatório.' });
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
                    <DialogTitle>Importar relatório de consumo</DialogTitle>
                    <DialogDescription>
                        Faça o upload de um relatório de vendas/consumo em formato CSV para análise.
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
