
"use client";

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useToast } from '@/hooks/use-toast';
import { type ProductSimulation } from '@/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from './ui/separator';
import { Loader2, ChevronsUpDown } from 'lucide-react';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useKiosks } from '@/hooks/use-kiosks';
import { cn } from '@/lib/utils';


const batchEditSchema = z.object({
  target: z.enum(['selected', 'filtered']),
  statusAction: z.enum(['keep', 'set']),
  statusValue: z.enum(['active', 'archived']).optional(),
  kioskAction: z.enum(['keep', 'add', 'remove', 'set']),
  kioskIds: z.array(z.string()).optional(),
  lineAction: z.enum(['keep', 'set', 'clear']),
  lineId: z.string().optional(),
  categoryAction: z.enum(['keep', 'set', 'clear']),
  categoryId: z.string().optional(),
  groupAction: z.enum(['keep', 'add', 'remove', 'set']),
  groupId: z.string().optional(),
  priceAction: z.enum(['keep', 'change']),
  priceAdjustmentType: z.enum(['percentage', 'fixed']),
  priceValue: z.coerce.number().optional(),
  ncmAction: z.enum(['keep', 'set']),
  ncm: z.string().optional(),
  cestAction: z.enum(['keep', 'set']),
  cest: z.string().optional(),
  cfopAction: z.enum(['keep', 'set']),
  cfop: z.string().optional(),
}).refine(data => {
    return data.lineAction !== 'keep' || 
           data.categoryAction !== 'keep' || 
           data.groupAction !== 'keep' || 
           data.priceAction !== 'keep' ||
           data.statusAction !== 'keep' ||
           data.kioskAction !== 'keep' ||
           data.ncmAction !== 'keep' ||
           data.cestAction !== 'keep' ||
           data.cfopAction !== 'keep';
}, {
    message: "Selecione pelo menos uma alteração para aplicar.",
    path: ["target"], // Generic path
}).refine(data => {
    return data.statusAction !== 'set' || !!data.statusValue;
}, {
    message: "Selecione um status.",
    path: ["statusValue"],
}).refine(data => {
    return data.kioskAction === 'keep' || (data.kioskIds && data.kioskIds.length > 0);
}, {
    message: "Selecione pelo menos um quiosque.",
    path: ["kioskIds"],
}).refine(data => {
    return data.lineAction !== 'set' || !!data.lineId;
}, {
    message: "Selecione uma linha.",
    path: ["lineId"],
}).refine(data => {
    return data.categoryAction !== 'set' || !!data.categoryId;
}, {
    message: "Selecione uma categoria.",
    path: ["categoryId"],
}).refine(data => {
    return (data.groupAction === 'keep' || !!data.groupId);
}, {
    message: "Selecione um grupo.",
    path: ["groupId"],
}).refine(data => {
    return data.priceAction === 'keep' || (data.priceValue !== undefined && data.priceValue !== 0);
}, {
    message: "O valor deve ser diferente de zero.",
    path: ["priceValue"],
}).refine(data => {
    return data.ncmAction !== 'set' || (data.ncm && data.ncm.trim() !== '');
}, {
    message: "O NCM é obrigatório.",
    path: ["ncm"],
}).refine(data => {
    return data.cestAction !== 'set' || (data.cest && data.cest.trim() !== '');
}, {
    message: "O CEST é obrigatório.",
    path: ["cest"],
}).refine(data => {
    return data.cfopAction !== 'set' || (data.cfop && data.cfop.trim() !== '');
}, {
    message: "O CFOP é obrigatório.",
    path: ["cfop"],
});


type BatchEditFormValues = z.infer<typeof batchEditSchema>;

interface BatchEditSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulations: ProductSimulation[];
  filteredSimulations: ProductSimulation[];
  selectedSimulationIds: Set<string>;
}

export function BatchEditSimulationModal({ open, onOpenChange, simulations, filteredSimulations, selectedSimulationIds }: BatchEditSimulationModalProps) {
    const { categories } = useProductSimulationCategories();
    const { bulkUpdateSimulations } = useProductSimulation();
    const { kiosks } = useKiosks();
    const { toast } = useToast();
    
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
    
    const form = useForm<BatchEditFormValues>({
        resolver: zodResolver(batchEditSchema),
        defaultValues: {
            target: selectedSimulationIds.size > 0 ? 'selected' : 'filtered',
            statusAction: 'keep',
            kioskAction: 'keep',
            lineAction: 'keep',
            categoryAction: 'keep',
            groupAction: 'keep',
            priceAction: 'keep',
            priceAdjustmentType: 'percentage',
            ncmAction: 'keep',
            cestAction: 'keep',
            cfopAction: 'keep',
            kioskIds: [],
        }
    });
    
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const groups = useMemo(() => categories.filter(c => c.type === 'group'), [categories]);

    const kioskAction = form.watch('kioskAction');
    const priceAdjustmentType = form.watch('priceAdjustmentType');

    const onSubmit = async (values: BatchEditFormValues) => {
        if (step < 3) {
            setStep(step + 1);
            return;
        }

        setIsSubmitting(true);
        
        const targetSimulations = values.target === 'selected'
            ? simulations.filter(sim => selectedSimulationIds.has(sim.id))
            : filteredSimulations;

        if (targetSimulations.length === 0) {
            toast({ variant: 'destructive', title: 'Nenhum item para atualizar.' });
            setIsSubmitting(false);
            return;
        }

        try {
            await bulkUpdateSimulations(targetSimulations, {
                status: { action: selectedFields.has('status') ? 'set' : 'keep', value: values.statusValue },
                kiosk: { action: selectedFields.has('kiosks') ? values.kioskAction : 'keep', ids: values.kioskIds || [] },
                line: { action: selectedFields.has('line') ? values.lineAction : 'keep', id: values.lineId },
                category: { action: selectedFields.has('category') ? values.categoryAction : 'keep', id: values.categoryId },
                group: { action: selectedFields.has('group') ? values.groupAction : 'keep', id: values.groupId },
                price: { action: selectedFields.has('price') ? 'change' : 'keep', type: values.priceAdjustmentType, value: values.priceValue || 0 },
                ncm: { action: selectedFields.has('fiscal') ? 'set' : 'keep', value: values.ncm },
                cest: { action: selectedFields.has('fiscal') ? 'set' : 'keep', value: values.cest },
                cfop: { action: selectedFields.has('fiscal') ? 'set' : 'keep', value: values.cfop },
            });
            toast({ title: "Sucesso!", description: `${targetSimulations.length} mercadorias foram atualizadas.` });
            onOpenChange(false);
            setStep(1);
            setSelectedFields(new Set());
        } catch (error) {
            toast({ variant: 'destructive', title: 'Erro ao atualizar', description: 'Não foi possível completar a operação.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleField = (field: string) => {
        const newFields = new Set(selectedFields);
        if (newFields.has(field)) newFields.delete(field);
        else newFields.add(field);
        setSelectedFields(newFields);
    };

    const fieldOptions = [
        { id: 'status', label: 'Status (Ativo/Inativo)' },
        { id: 'kiosks', label: 'Quiosques' },
        { id: 'line', label: 'Linha' },
        { id: 'category', label: 'Categoria' },
        { id: 'group', label: 'Grupo por Insumo' },
        { id: 'fiscal', label: 'Informações Fiscais (NCM/CEST/CFOP)' },
        { id: 'price', label: 'Preço de Venda' },
    ];

    return (
        <Dialog open={open} onOpenChange={(v) => { if(!v) { setStep(1); setSelectedFields(new Set()); } onOpenChange(v); }}>
            <DialogContent className="max-w-xl h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl border-none shadow-2xl">
                <div className="bg-pink-600 p-8 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tight">Alterar em lote</DialogTitle>
                        <DialogDescription className="text-pink-100 font-medium">
                            Passo {step} de 3: {step === 1 ? 'Selecionar itens' : step === 2 ? 'Escolher campos' : 'Definir valores'}
                        </DialogDescription>
                    </DialogHeader>
                    {/* Step Progress Bar */}
                    <div className="flex gap-2 mt-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-all", i <= step ? "bg-white" : "bg-white/30")} />
                        ))}
                    </div>
                </div>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden bg-gray-50">
                        <ScrollArea className="flex-1 px-8 py-6">
                            {step === 1 && (
                                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                    <FormField
                                        control={form.control}
                                        name="target"
                                        render={({ field }) => (
                                            <FormItem className="space-y-4">
                                                <FormLabel className="text-base font-black text-gray-900">Quais itens você quer alterar?</FormLabel>
                                                <FormControl>
                                                    <RadioGroup
                                                        onValueChange={field.onChange}
                                                        value={field.value}
                                                        className="grid grid-cols-1 gap-3"
                                                    >
                                                        <div className={cn(
                                                            "flex items-center space-x-3 space-y-0 p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                            field.value === 'selected' ? "border-pink-500 bg-white shadow-md" : "border-gray-200 bg-white/50 grayscale opacity-70"
                                                        )} onClick={() => selectedSimulationIds.size > 0 && field.onChange('selected')}>
                                                            <FormControl><RadioGroupItem value="selected" disabled={selectedSimulationIds.size === 0} /></FormControl>
                                                            <div>
                                                                <FormLabel className="font-bold text-gray-900 block">Itens selecionados</FormLabel>
                                                                <span className="text-xs text-muted-foreground font-medium">{selectedSimulationIds.size} mercadorias marcadas na lista</span>
                                                            </div>
                                                        </div>

                                                        <div className={cn(
                                                            "flex items-center space-x-3 space-y-0 p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                            field.value === 'filtered' ? "border-pink-500 bg-white shadow-md" : "border-gray-200 bg-white/50"
                                                        )} onClick={() => field.onChange('filtered')}>
                                                            <FormControl><RadioGroupItem value="filtered" /></FormControl>
                                                            <div>
                                                                <FormLabel className="font-bold text-gray-900 block">Resultado filtrado</FormLabel>
                                                                <span className="text-xs text-muted-foreground font-medium">{filteredSimulations.length} mercadorias baseadas nos filtros atuais</span>
                                                            </div>
                                                        </div>
                                                    </RadioGroup>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                    <h3 className="text-base font-black text-gray-900">Quais campos deseja alterar?</h3>
                                    <div className="grid grid-cols-1 gap-2">
                                        {fieldOptions.map(opt => (
                                            <div 
                                                key={opt.id}
                                                className={cn(
                                                    "flex items-center p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                    selectedFields.has(opt.id) ? "border-pink-500 bg-white shadow-md" : "border-gray-200 bg-white/50 hover:border-pink-200"
                                                )}
                                                onClick={() => toggleField(opt.id)}
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded-md border-2 mr-3 flex items-center justify-center transition-colors",
                                                    selectedFields.has(opt.id) ? "bg-pink-500 border-pink-500 text-white" : "border-gray-300"
                                                )}>
                                                    {selectedFields.has(opt.id) && <Loader2 className="w-3 h-3 animate-none" />}
                                                </div>
                                                <span className={cn("font-bold text-sm", selectedFields.has(opt.id) ? "text-gray-900" : "text-gray-500")}>
                                                    {opt.label}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    {selectedFields.size === 0 && (
                                        <p className="text-xs text-red-500 font-bold text-center">Selecione pelo menos um campo para continuar.</p>
                                    )}
                                </div>
                            )}

                            {step === 3 && (
                                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                    <h3 className="text-base font-black text-gray-900">Defina os novos valores</h3>
                                    
                                    {selectedFields.has('status') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Status</FormLabel>
                                            <FormField control={form.control} name="statusValue" render={({ field }) => (
                                                <FormItem><FormControl>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecione um status..." /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="active">Ativo</SelectItem>
                                                            <SelectItem value="archived">Inativo</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl><FormMessage /></FormItem>
                                            )}/>
                                        </div>
                                    )}

                                    {selectedFields.has('kiosks') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Quiosques</FormLabel>
                                            <FormField control={form.control} name="kioskAction" render={({ field }) => (
                                                <FormItem><FormControl>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="add">Adicionar aos selecionados</SelectItem>
                                                            <SelectItem value="remove">Remover os selecionados</SelectItem>
                                                            <SelectItem value="set">Substituir por estes:</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl></FormItem>
                                            )}/>
                                            <FormField control={form.control} name="kioskIds" render={({ field }) => (
                                                <FormItem>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <FormControl>
                                                                <Button variant="outline" className="w-full justify-between h-12 rounded-xl font-bold text-gray-700">
                                                                    {(field.value?.length ?? 0) > 0 ? `${field.value?.length} selecionado(s)` : "Selecione..."}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                                                            {kiosks.map((k) => (
                                                                <DropdownMenuCheckboxItem
                                                                    key={k.id}
                                                                    checked={field.value?.includes(k.id)}
                                                                    onCheckedChange={(checked) => {
                                                                        const current = field.value || [];
                                                                        return checked ? field.onChange([...current, k.id]) : field.onChange(current.filter(id => id !== k.id));
                                                                    }}
                                                                    onSelect={(e) => e.preventDefault()}
                                                                >
                                                                    {k.name}
                                                                </DropdownMenuCheckboxItem>
                                                            ))}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        </div>
                                    )}

                                    {selectedFields.has('line') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Linha</FormLabel>
                                            <div className="flex gap-2">
                                                <FormField control={form.control} name="lineAction" render={({ field }) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="w-[140px] h-12 rounded-xl"><SelectValue /></SelectTrigger>
                                                        <SelectContent><SelectItem value="set">Definir</SelectItem><SelectItem value="clear">Limpar</SelectItem></SelectContent>
                                                    </Select>
                                                )}/>
                                                <FormField control={form.control} name="lineId" render={({ field }) => (
                                                    <FormItem className="flex-grow"><FormControl>
                                                        <Select onValueChange={field.onChange} value={field.value} disabled={form.watch('lineAction') === 'clear'}>
                                                            <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                            <SelectContent>{lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                                                        </Select>
                                                    </FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        </div>
                                    )}

                                    {selectedFields.has('category') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Categoria</FormLabel>
                                            <div className="flex gap-2">
                                                <FormField control={form.control} name="categoryAction" render={({ field }) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="w-[140px] h-12 rounded-xl"><SelectValue /></SelectTrigger>
                                                        <SelectContent><SelectItem value="set">Definir</SelectItem><SelectItem value="clear">Limpar</SelectItem></SelectContent>
                                                    </Select>
                                                )}/>
                                                <FormField control={form.control} name="categoryId" render={({ field }) => (
                                                    <FormItem className="flex-grow"><FormControl>
                                                        <Select onValueChange={field.onChange} value={field.value} disabled={form.watch('categoryAction') === 'clear'}>
                                                            <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                            <SelectContent>{mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                                                        </Select>
                                                    </FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        </div>
                                    )}

                                    {selectedFields.has('group') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Grupo por Insumo</FormLabel>
                                            <div className="flex gap-2">
                                                <FormField control={form.control} name="groupAction" render={({ field }) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger className="w-[140px] h-12 rounded-xl"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="add">Adicionar</SelectItem>
                                                            <SelectItem value="remove">Remover</SelectItem>
                                                            <SelectItem value="set">Substituir</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                )}/>
                                                <FormField control={form.control} name="groupId" render={({ field }) => (
                                                    <FormItem className="flex-grow"><FormControl>
                                                        <Select onValueChange={field.onChange} value={field.value}>
                                                            <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                            <SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                                                        </Select>
                                                    </FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        </div>
                                    )}

                                    {selectedFields.has('fiscal') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Informações Fiscais</FormLabel>
                                            <div className="grid grid-cols-3 gap-3">
                                                <FormField control={form.control} name="ncm" render={({ field }) => (
                                                    <FormItem><FormLabel className="text-[10px] font-bold text-gray-400">NCM</FormLabel><FormControl><Input className="h-10 rounded-lg" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                                                )}/>
                                                <FormField control={form.control} name="cest" render={({ field }) => (
                                                    <FormItem><FormLabel className="text-[10px] font-bold text-gray-400">CEST</FormLabel><FormControl><Input className="h-10 rounded-lg" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                                                )}/>
                                                <FormField control={form.control} name="cfop" render={({ field }) => (
                                                    <FormItem><FormLabel className="text-[10px] font-bold text-gray-400">CFOP</FormLabel><FormControl><Input className="h-10 rounded-lg" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                                                )}/>
                                            </div>
                                        </div>
                                    )}

                                    {selectedFields.has('price') && (
                                        <div className="p-5 bg-white border rounded-2xl shadow-sm space-y-4">
                                            <FormLabel className="text-xs font-black uppercase text-pink-600 tracking-wider">Preço de Venda</FormLabel>
                                            <div className="flex flex-col gap-4">
                                                <FormField control={form.control} name="priceAdjustmentType" render={({ field }) => (
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-6">
                                                        <div className="flex items-center space-x-2"><RadioGroupItem value="percentage" id="pct" /><label htmlFor="pct" className="text-sm font-bold">Percentual (%)</label></div>
                                                        <div className="flex items-center space-x-2"><RadioGroupItem value="fixed" id="fix" /><label htmlFor="fix" className="text-sm font-bold">Fixo (R$)</label></div>
                                                    </RadioGroup>
                                                )}/>
                                                <FormField control={form.control} name="priceValue" render={({ field }) => (
                                                    <FormItem><FormControl><Input type="number" step="0.01" className="h-12 rounded-xl text-lg font-black" {...field} value={field.value || ''} placeholder={priceAdjustmentType === 'percentage' ? "Ex: 10 para +10%" : "Novo valor em R$"} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </ScrollArea>

                        <div className="px-8 py-6 bg-white border-t flex justify-between items-center mt-auto">
                            <Button 
                                type="button" 
                                variant="ghost" 
                                className="font-bold text-gray-400 hover:text-gray-900"
                                onClick={() => step > 1 ? setStep(step - 1) : onOpenChange(false)}
                            >
                                {step === 1 ? 'Cancelar' : 'Voltar'}
                            </Button>
                            
                            <Button 
                                type="submit" 
                                className="bg-pink-600 hover:bg-pink-700 text-white font-black px-8 h-12 rounded-xl"
                                disabled={isSubmitting || (step === 2 && selectedFields.size === 0)}
                            >
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {step === 3 ? 'Aplicar Alterações' : 'Próximo Passo'}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
