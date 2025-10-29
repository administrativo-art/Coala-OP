
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
import { type PricingParameters, type ProfitRange, type SimulationCategory } from '@/types';
import { useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from './ui/dropdown-menu';

const profitRangeSchema = z.object({
  id: z.string(),
  from: z.coerce.number(),
  to: z.coerce.number(),
  color: z.string().min(1, 'Selecione uma cor'),
});

const parametersSchema = z.object({
  defaultOperationPercentage: z.coerce.number().min(0, "Deve ser um valor positivo."),
  profitGoals: z.array(z.coerce.number().min(0).max(100)),
  profitRanges: z.array(profitRangeSchema),
});

type ParametersFormValues = z.infer<typeof parametersSchema>;


interface PricingParametersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PricingParametersModal({ open, onOpenChange }: PricingParametersModalProps) {
  const { pricingParameters, updatePricingParameters } = useCompanySettings();
  
  const form = useForm<ParametersFormValues>({
    resolver: zodResolver(parametersSchema),
  });

  const { fields: goalFields, append: appendGoal, remove: removeGoal } = useFieldArray({ control: form.control, name: 'profitGoals' });
  const { fields: profitRangeFields, append: appendProfitRange, remove: removeProfitRange } = useFieldArray({ control: form.control, name: 'profitRanges' });

  useEffect(() => {
    if (open && pricingParameters) {
      form.reset({
        defaultOperationPercentage: pricingParameters.defaultOperationPercentage,
        profitGoals: pricingParameters.profitGoals || [45, 50, 55, 60],
        profitRanges: pricingParameters.profitRanges || [],
      });
    }
  }, [open, pricingParameters, form]);

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
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="general">Geral</TabsTrigger>
                    <TabsTrigger value="categories">Categorias</TabsTrigger>
                    <TabsTrigger value="lines">Linhas</TabsTrigger>
                    <TabsTrigger value="groups">Grupos</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="flex-1 overflow-y-auto pr-2">
                   <div className="space-y-6 py-4">
                     <FormField
                        control={form.control}
                        name="defaultOperationPercentage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Percentual de operação padrão</FormLabel>
                            <div className="relative w-32">
                              <Input type="number" className="pr-8" {...field} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <div>
                        <FormLabel>Metas de Lucro Disponíveis (%)</FormLabel>
                        <div className="space-y-2 mt-2 p-3 border rounded-lg">
                            {goalFields.map((field, index) => (
                                <div key={field.id} className="flex items-center gap-2">
                                  <FormField control={form.control} name={`profitGoals.${index}`} render={({ field: inputField }) => (
                                      <FormItem className="flex-grow"><FormControl><Input type="number" {...inputField} value={inputField.value ?? ''} onChange={e => inputField.onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))} /></FormControl><FormMessage /></FormItem>
                                  )}/>
                                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeGoal(index)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => appendGoal(50)}><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Meta</Button>
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

const CATEGORY_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'];

function GenericCategoryManager({ type, label }: { type: 'line' | 'group' | 'category', label: string }) {
    const { categories, addCategory, updateCategory, deleteCategory } = useProductSimulationCategories();
    const [editingItem, setEditingItem] = useState<SimulationCategory | null>(null);
    const [newItemName, setNewItemName] = useState('');
    const [newItemColor, setNewItemColor] = useState(CATEGORY_COLORS[0]);
    const [itemToDelete, setItemToDelete] = useState<SimulationCategory | null>(null);

    const items = useMemo(() => categories.filter(c => c.type === type), [categories, type]);

    const handleAdd = async () => {
        if (!newItemName.trim()) return;
        await addCategory({ name: newItemName.trim(), type: type, color: newItemColor });
        setNewItemName('');
    };
    
    const handleSaveEdit = async () => {
        if (!editingItem || !newItemName.trim()) return;
        await updateCategory({ ...editingItem, name: newItemName.trim(), color: newItemColor });
        setEditingItem(null);
        setNewItemName('');
        setNewItemColor(CATEGORY_COLORS[0]);
    };
    
    const handleStartEdit = (item: SimulationCategory) => {
        setEditingItem(item);
        setNewItemName(item.name);
        if (type !== 'line') {
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
                    {type !== 'line' && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button type="button" variant="outline" size="icon">
                                    <div className="h-5 w-5 rounded-full border" style={{ backgroundColor: newItemColor }} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="grid grid-cols-4 gap-1 p-1">
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
                            {type !== 'line' && item.color && (
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
