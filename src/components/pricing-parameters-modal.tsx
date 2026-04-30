
"use client";

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Edit, Trash2, Palette } from 'lucide-react';
import { type PricingParameters, type ProfitRange, type SalesChannel, type SimulationCategory } from '@/types';
import { useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useChannels } from '@/hooks/use-channels';
import { useToast } from '@/hooks/use-toast';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from './ui/dropdown-menu';
import { Switch } from './ui/switch';

const profitRangeSchema = z.object({
  id: z.string(),
  from: z.coerce.number(),
  to: z.coerce.number(),
  color: z.string().min(1, 'Selecione uma cor'),
});

const parametersSchema = z.object({
  averageTaxPercentage: z.coerce.number().min(0, "Deve ser um valor positivo."),
  averageCardFeePercentage: z.coerce.number().min(0, "Deve ser um valor positivo."),
  profitGoals: z.array(z.coerce.number().min(0).max(100)),
  profitRanges: z.array(profitRangeSchema),
});

type ParametersFormValues = z.infer<typeof parametersSchema>;


interface PricingParametersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PricingParametersModal({ open, onOpenChange }: PricingParametersModalProps) {
  const { pricingParameters, updatePricingParameters, loading: settingsLoading } = useCompanySettings();
  
  const form = useForm<ParametersFormValues>({
    resolver: zodResolver(parametersSchema),
    defaultValues: { 
        averageTaxPercentage: 0,
        averageCardFeePercentage: 0,
        profitGoals: [],
        profitRanges: [],
    }
  });

  const { fields: profitRangeFields, append: appendProfitRange, remove: removeProfitRange } = useFieldArray({ control: form.control, name: 'profitRanges' });

  // Reset form when the modal opens AND settings have finished loading.
  // Depends on both `open` and `settingsLoading` so that if the modal is opened
  // before Firestore returns data, the form still populates once loading finishes.
  useEffect(() => {
    if (open && pricingParameters && !settingsLoading) {
      form.reset({
        averageTaxPercentage: pricingParameters.averageTaxPercentage ?? 0,
        averageCardFeePercentage: pricingParameters.averageCardFeePercentage ?? 0,
        profitGoals: pricingParameters.profitGoals || [45, 50, 55, 60, 65],
        profitRanges: pricingParameters.profitRanges || [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settingsLoading]);

  const onSubmit = (values: ParametersFormValues) => {
    const sortedGoals = [...values.profitGoals].sort((a,b) => a - b);
    updatePricingParameters({
        ...values, 
        profitGoals: sortedGoals,
    });
    onOpenChange(false);
  };
  
  const handleAddProfitRange = () => {
    appendProfitRange({
      id: `range-${Date.now()}`,
      from: 0,
      to: 0,
      color: 'text-primary'
    });
  };

  const handleAddGoal = () => {
    const currentGoals = form.getValues('profitGoals') || [];
    form.setValue('profitGoals', [...currentGoals, 50]);
  }

  const handleRemoveGoal = (index: number) => {
    const currentGoals = form.getValues('profitGoals') || [];
    form.setValue('profitGoals', currentGoals.filter((_, i) => i !== index));
  }


  const colorOptions = [
    { value: 'text-green-600', label: 'Verde', hex: '#16A34A' },
    { value: 'text-yellow-600', label: 'Amarelo', hex: '#D97706' },
    { value: 'text-orange-500', label: 'Laranja', hex: '#F97316' },
    { value: 'text-destructive', label: 'Vermelho', hex: '#EF4444' },
    { value: 'text-blue-600', label: 'Azul', hex: '#2563EB' },
    { value: 'text-primary', label: 'Padrão (Rosa)', hex: '#F43F5E' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Configurar parâmetros de precificação</DialogTitle>
          <DialogDescription>
            Defina os valores padrão, faixas de preço e as categorias para classificação automática.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4 flex-1 flex flex-col overflow-hidden">
             <Tabs defaultValue="general" className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="general">Geral</TabsTrigger>
                    <TabsTrigger value="categories">Categorias</TabsTrigger>
                    <TabsTrigger value="lines">Linhas</TabsTrigger>
                    <TabsTrigger value="groups">Grupos</TabsTrigger>
                    <TabsTrigger value="channels">Canais</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="flex-1 overflow-y-auto pr-2">
                   <div className="space-y-6 py-4">
                     <FormField
                        control={form.control}
                        name="averageTaxPercentage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Imposto médio por mercadoria (%)</FormLabel>
                            <div className="relative w-32">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  className="pr-8" 
                                  {...field} 
                                  value={field.value ?? ''}
                                  onChange={(e) => field.onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                />
                              </FormControl>
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                       <FormField
                        control={form.control}
                        name="averageCardFeePercentage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Taxa média de transação (%)</FormLabel>
                            <div className="relative w-32">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  className="pr-8" 
                                  {...field} 
                                  value={field.value ?? ''}
                                  onChange={(e) => field.onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                />
                              </FormControl>
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <div>
                        <FormLabel>Metas de margem bruta Disponíveis (%)</FormLabel>
                        <div className="space-y-2 mt-2 p-3 border rounded-lg">
                            {(form.watch('profitGoals') || []).map((goal, index) => (
                                <div key={index} className="flex items-center gap-2">
                                  <FormField control={form.control} name={`profitGoals.${index}`} render={({ field: inputField }) => (
                                      <FormItem className="flex-grow"><FormControl><Input type="number" {...inputField} value={inputField.value ?? ''} onChange={e => inputField.onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))} /></FormControl><FormMessage /></FormItem>
                                  )}/>
                                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => handleRemoveGoal(index)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => handleAddGoal()}><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Meta</Button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-medium">Faixas de Cor da Lucratividade</h3>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader><TableRow><TableHead>De (%)</TableHead><TableHead>Até (%)</TableHead><TableHead>Cor</TableHead><TableHead></TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {profitRangeFields.map((field, index) => (
                                        <TableRow key={field.id}>
                                            <TableCell><FormField control={form.control} name={`profitRanges.${index}.from`} render={({field}) => <Input type="number" {...field} />} /></TableCell>
                                            <TableCell><FormField control={form.control} name={`profitRanges.${index}.to`} render={({field}) => <Input type="number" placeholder="infinito" {...field} />} /></TableCell>
                                            <TableCell>
                                                 <FormField control={form.control} name={`profitRanges.${index}.color`} render={({field}) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger>
                                                          <div className="flex items-center gap-2">
                                                            <div className={cn("h-3 w-3 rounded-full")} style={{backgroundColor: colorOptions.find(c => c.value === field.value)?.hex}} />
                                                            <SelectValue />
                                                          </div>
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {colorOptions.map(opt => (
                                                                <SelectItem key={opt.value} value={opt.value}>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className={cn("h-3 w-3 rounded-full")} style={{backgroundColor: opt.hex}} />
                                                                        {opt.label}
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )} />
                                            </TableCell>
                                            <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => removeProfitRange(index)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                         <Button type="button" variant="outline" size="sm" onClick={handleAddProfitRange}><PlusCircle className="mr-2 h-4 w-4" /> Nova Faixa</Button>
                    </div>
                   </div>
                </TabsContent>

                <TabsContent value="categories" className="flex-1 overflow-y-auto pr-2">
                  <div className="space-y-4 py-4">
                      <GenericCategoryManager type="category" label="Categoria de Simulação" />
                  </div>
                </TabsContent>
                
                 <TabsContent value="lines" className="flex-1 overflow-y-auto pr-2">
                    <div className="space-y-4 py-4">
                        <GenericCategoryManager type="line" label="Linha" />
                    </div>
                </TabsContent>
                <TabsContent value="groups" className="flex-1 overflow-y-auto pr-2">
                    <div className="space-y-4 py-4">
                        <GenericCategoryManager type="group" label="Grupo por Insumo" />
                    </div>
                </TabsContent>
                <TabsContent value="channels" className="flex-1 overflow-y-auto pr-2">
                    <div className="space-y-4 py-4">
                        <ChannelManager />
                    </div>
                </TabsContent>
            </Tabs>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Salvar parâmetros</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const CATEGORY_COLORS = [
    '#F43F5E', // Rose-500
    '#F97316', // Orange-500
    '#F59E0B', // Amber-500
    '#84CC16', // Lime-500
    '#10B981', // Emerald-500
    '#06B6D4', // Cyan-500
    '#3B82F6', // Blue-500
    '#8B5CF6', // Violet-500
    '#D946EF', // Fuchsia-500
    '#64748B', // Slate-500
    '#FFADAD', // Light Red
    '#FFD6A5', // Light Orange
    '#FDFFB6', // Light Yellow
    '#CAFFBF', // Light Green
    '#9BF6FF', // Light Cyan
    '#A0C4FF', // Light Blue
    '#BDB2FF', // Light Indigo
    '#FFC6FF', // Light Pink
];

function GenericCategoryManager({ type, label }: { type: 'line' | 'group' | 'category', label: string }) {
    const { categories, addCategory, updateCategory, deleteCategory } = useProductSimulationCategories();
    const [editingItem, setEditingItem] = useState<SimulationCategory | null>(null);
    const [newItemName, setNewItemName] = useState('');
    const [newItemColor, setNewItemColor] = useState(CATEGORY_COLORS[0]);
    const [itemToDelete, setItemToDelete] = useState<SimulationCategory | null>(null);

    const items = useMemo(() => categories.filter(c => c.type === type), [categories, type]);

    const handleAdd = async () => {
        if (!newItemName.trim()) return;
        await addCategory({ name: newItemName.trim(), type: type, color: type === 'category' ? newItemColor : '' });
        setNewItemName('');
    };
    
    const handleSaveEdit = async () => {
        if (!editingItem || !newItemName.trim()) return;
        await updateCategory({ ...editingItem, name: newItemName.trim(), color: type === 'category' ? newItemColor : '' });
        setEditingItem(null);
        setNewItemName('');
        setNewItemColor(CATEGORY_COLORS[0]);
    };
    
    const handleStartEdit = (item: SimulationCategory) => {
        setEditingItem(item);
        setNewItemName(item.name);
        if (type === 'category') {
          setNewItemColor(item.color || CATEGORY_COLORS[0]);
        }
    };

    const handleCancelEdit = () => {
        setEditingItem(null);
        setNewItemName('');
        setNewItemColor(CATEGORY_COLORS[0]);
    };

    const handleDeleteConfirm = () => {
        if (itemToDelete) {
            deleteCategory(itemToDelete.id);
            setItemToDelete(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="p-4 border rounded-lg space-y-3">
                 <h3 className="font-semibold">{editingItem ? 'Editando...' : `Adicionar ${label}`}</h3>
                <div className="flex gap-2">
                    {type === 'category' && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button type="button" variant="outline" size="icon">
                                    <div className="h-5 w-5 rounded-full border" style={{ backgroundColor: newItemColor }} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="grid grid-cols-5 gap-1 p-1">
                                {CATEGORY_COLORS.map(color => (
                                    <button key={color} className="h-8 w-8 rounded-md border" style={{ backgroundColor: color }} onClick={() => setNewItemColor(color)} />
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    <Input
                        placeholder={`Nome da nova ${label.toLowerCase()}`}
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                    />
                    {editingItem ? (
                        <div className="flex gap-2">
                            <Button type="button" onClick={handleSaveEdit}>Salvar</Button>
                            <Button type="button" variant="outline" onClick={handleCancelEdit}>Cancelar</Button>
                        </div>
                    ) : (
                        <Button type="button" onClick={handleAdd}><PlusCircle className="mr-2 h-4 w-4"/> Adicionar</Button>
                    )}
                </div>
            </div>
             <div className="rounded-md border p-2 space-y-2">
                {items.map(item => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border p-3">
                        <div className="font-medium flex items-center gap-2">
                            {type === 'category' && item.color && (
                                <div className="h-4 w-4 rounded-full" style={{backgroundColor: item.color}}/>
                            )}
                            {item.name}
                        </div>
                        <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleStartEdit(item)}><Edit className="h-4 w-4" /></Button>
                            <DeleteConfirmationDialog
                                open={false}
                                onOpenChange={()=>{}}
                                onConfirm={handleDeleteConfirm}
                                itemName={`o item "${itemToDelete?.name}"`}
                                triggerButton={
                                  <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => setItemToDelete(item)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                }
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ChannelManager() {
    const { channels, addChannel, updateChannel, estimateChannelRuleImpact } = useChannels();
    const { toast } = useToast();
    const [name, setName] = useState('');
    const [type, setType] = useState<'custom' | 'balcao' | 'delivery_proprio' | 'ifood' | 'rappi'>('custom');
    const [ruleMode, setRuleMode] = useState<'none' | 'markup'>('none');
    const [rulePercent, setRulePercent] = useState<number>(0);

    const handleAdd = async () => {
        if (!name.trim()) return;
        try {
            await addChannel({
              name: name.trim(),
              type,
              active: true,
              defaultPriceRule: ruleMode === 'markup' ? { mode: 'markup', value: rulePercent / 100 } : null,
            });
            setName('');
            setType('custom');
            setRuleMode('none');
            setRulePercent(0);
            toast({ title: 'Canal criado com sucesso.' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Erro ao criar canal.' });
        }
    };

    const handleToggle = async (channelId: string, active: boolean) => {
        try {
            const channel = channels.find((entry) => entry.id === channelId);
            if (!channel) return;
            await updateChannel(channelId, { active, updatedAt: channel.updatedAt });
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Não foi possível atualizar o canal.',
                description: error instanceof Error ? error.message : 'Erro inesperado.',
            });
        }
    };

    const handleRuleSave = async (channelId: string, nextMode: 'none' | 'markup', nextPercent: number) => {
        const channel = channels.find((entry) => entry.id === channelId);
        if (!channel) return;

        const impact = await estimateChannelRuleImpact(channelId).catch((error) => {
          toast({
            variant: 'destructive',
            title: 'Não foi possível calcular o impacto da regra.',
            description: error instanceof Error ? error.message : 'Erro inesperado.',
          });
          return null;
        });

        if (!impact) {
          return;
        }

        const message = `Esta mudança afetará ${impact.affectedProducts} produtos em ${impact.affectedUnits} unidades. Confirmar?`;
        if (typeof window !== 'undefined' && !window.confirm(message)) {
          return;
        }

        try {
          await updateChannel(channelId, {
            defaultPriceRule: nextMode === 'markup' ? { mode: 'markup', value: nextPercent / 100 } : null,
            updatedAt: channel.updatedAt,
          });
          toast({
            title: 'Regra do canal atualizada.',
            description: `${impact.affectedProducts} produtos e ${impact.affectedUnits} unidades herdam desta regra.`,
          });
        } catch (error) {
          toast({
            variant: 'destructive',
            title: 'Não foi possível salvar a regra do canal.',
            description: error instanceof Error ? error.message : 'Erro inesperado.',
          });
        }
    };

    const previewBasePrice = 12;
    const previewRulePrice = ruleMode === 'markup' ? previewBasePrice * (1 + rulePercent / 100) : previewBasePrice;

    return (
        <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
                <h3 className="font-semibold">Adicionar canal</h3>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    <Input
                        placeholder="Nome do canal"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="custom">Personalizado</SelectItem>
                            <SelectItem value="balcao">Balcao</SelectItem>
                            <SelectItem value="delivery_proprio">Delivery proprio</SelectItem>
                            <SelectItem value="ifood">iFood</SelectItem>
                            <SelectItem value="rappi">Rappi</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-3 md:grid-cols-[220px_180px_1fr_auto] md:items-end">
                    <div className="space-y-2">
                        <p className="text-sm font-medium">Regra padrão</p>
                        <Select value={ruleMode} onValueChange={(value) => setRuleMode(value as 'none' | 'markup')}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sem regra automática</SelectItem>
                                <SelectItem value="markup">Acréscimo percentual</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">Acréscimo (%)</p>
                        <Input
                          type="number"
                          step="0.01"
                          disabled={ruleMode !== 'markup'}
                          value={rulePercent}
                          onChange={(event) => setRulePercent(Number(event.target.value) || 0)}
                        />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      R$ 12,00 (base) → <span className="font-semibold text-foreground">{previewRulePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    </p>
                    <Button type="button" onClick={handleAdd}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Adicionar
                    </Button>
                </div>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Canal</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Regra padrão</TableHead>
                            <TableHead className="w-[140px]">Ativo</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {channels.map((channel) => (
                            <TableRow key={channel.id}>
                                <TableCell className="font-medium">{channel.name}</TableCell>
                                <TableCell className="uppercase text-xs text-muted-foreground">{channel.type}</TableCell>
                                <TableCell>
                                    <InlineChannelRuleEditor channel={channel} onSave={handleRuleSave} />
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Switch
                                            checked={channel.active}
                                            onCheckedChange={(checked) => handleToggle(channel.id, checked)}
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {channel.active ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

function InlineChannelRuleEditor({
  channel,
  onSave,
}: {
  channel: SalesChannel;
  onSave: (channelId: string, nextMode: 'none' | 'markup', nextPercent: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<'none' | 'markup'>(channel.defaultPriceRule?.mode === 'markup' ? 'markup' : 'none');
  const [percent, setPercent] = useState<number>((channel.defaultPriceRule?.value ?? 0) * 100);

  useEffect(() => {
    setMode(channel.defaultPriceRule?.mode === 'markup' ? 'markup' : 'none');
    setPercent((channel.defaultPriceRule?.value ?? 0) * 100);
  }, [channel.defaultPriceRule?.mode, channel.defaultPriceRule?.value]);

  const previewBasePrice = 12;
  const previewRulePrice = mode === 'markup' ? previewBasePrice * (1 + percent / 100) : previewBasePrice;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={mode} onValueChange={(value) => setMode(value as 'none' | 'markup')}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem regra automática</SelectItem>
            <SelectItem value="markup">Acréscimo percentual</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.01"
          className="h-9 w-[110px]"
          disabled={mode !== 'markup'}
          value={percent}
          onChange={(event) => setPercent(Number(event.target.value) || 0)}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => onSave(channel.id, mode, percent)}>
          Salvar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        R$ 12,00 (base) → {previewRulePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>
    </div>
  );
}
