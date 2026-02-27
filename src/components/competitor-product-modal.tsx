"use client";

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompetitors } from '@/hooks/use-competitors';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useToast } from '@/hooks/use-toast';
import { type CompetitorProduct } from '@/types';
import { units, unitCategories } from '@/lib/conversion';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search } from 'lucide-react';
import { Switch } from './ui/switch';
import { ScrollArea } from './ui/scroll-area';

const productSchema = z.object({
  competitorId: z.string().min(1, 'Selecione um concorrente.'),
  itemName: z.string().min(1, 'O nome da mercadoria é obrigatório.'),
  packageSize: z.string().optional(),
  unit: z.string().optional(),
  price: z.coerce.number().min(0.01, "O preço deve ser maior que zero.").optional(),
  ksProductId: z.string().nullable().optional(),
  active: z.boolean(),
});

type FormValues = z.infer<typeof productSchema>;

interface CompetitorProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  productToEdit: CompetitorProduct | null;
}

export function CompetitorProductModal({ isOpen, onClose, productToEdit }: CompetitorProductModalProps) {
  const { competitors, competitorGroups, addProduct, updateProduct } = useCompetitors();
  const { simulations } = useProductSimulation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      competitorId: '',
      itemName: '',
      packageSize: '',
      unit: '',
      price: undefined,
      ksProductId: null,
      active: true,
    }
  });
  
  const allUniqueUnits = useMemo(() => {
    const all = unitCategories.flatMap(category => Object.keys(units[category]));
    return Array.from(new Set(all));
  }, []);


  const filteredSimulations = useMemo(() => {
    if (!searchTerm) return simulations;
    return simulations.filter(sim =>
      sim.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [simulations, searchTerm]);

  const competitorsInGroup = useMemo(() => {
    if (!selectedGroupId) return [];
    return competitors.filter(c => c.competitorGroupId === selectedGroupId);
  }, [competitors, selectedGroupId]);


  useEffect(() => {
    if (isOpen) {
      if (productToEdit) {
        const competitor = competitors.find(c => c.id === productToEdit.competitorId);
        if (competitor) {
          setSelectedGroupId(competitor.competitorGroupId);
        }
        form.reset({
          competitorId: productToEdit.competitorId,
          itemName: productToEdit.itemName,
          packageSize: productToEdit.packageSize || '',
          unit: productToEdit.unit || '',
          price: undefined, // Price is for new items only
          ksProductId: productToEdit.ksProductId,
          active: productToEdit.active,
        });
      } else {
        setSelectedGroupId(null);
        form.reset({
          competitorId: '',
          itemName: '',
          packageSize: '',
          unit: '',
          price: undefined,
          ksProductId: null,
          active: true,
        });
      }
    }
  }, [isOpen, productToEdit, form, competitors]);
  
  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
    const value = e.target.value;
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly === '') {
        field.onChange(undefined);
        return;
    }

    const numericValue = parseInt(digitsOnly, 10) / 100;
    field.onChange(numericValue);
  };

  const formatPrice = (value: number | undefined) => {
      if (value === undefined || value === null) return '';
      return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };


  const processSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
        if (productToEdit) {
          const { price, ...updateValues } = values; // Price is not edited here
          await updateProduct(productToEdit.id, updateValues);
          toast({ title: 'Mercadoria atualizada com sucesso!' });
        } else {
          if (!values.price) {
             toast({ variant: 'destructive', title: 'Erro', description: 'O preço inicial é obrigatório.' });
             setIsSubmitting(false);
             return false;
          }
          await addProduct(values);
          toast({ title: 'Mercadoria adicionada com sucesso!' });
        }
        return true;
    } catch (error) {
        toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Não foi possível salvar a mercadoria.' });
        return false;
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleSaveAndClose = async (values: FormValues) => {
    const success = await processSubmit(values);
    if(success) {
        onClose();
    }
  };

  const handleSaveAndAddAnother = async (values: FormValues) => {
    const success = await processSubmit(values);
    if(success) {
        form.reset({
            ...values,
            itemName: '',
            packageSize: '',
            unit: '',
            price: undefined,
            ksProductId: null,
            active: true,
        });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{productToEdit ? 'Editar' : 'Adicionar'} mercadoria do concorrente</DialogTitle>
          <DialogDescription>
            Preencha os detalhes da mercadoria como ela é vendida pelo concorrente.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4">
            <ScrollArea className="h-[60vh] -mx-6 px-6">
             <div className="space-y-4 py-4">
                <FormItem>
                    <FormLabel>Grupo de Concorrentes</FormLabel>
                    <Select 
                        onValueChange={(groupId) => {
                            setSelectedGroupId(groupId);
                            form.setValue('competitorId', ''); // Reset competitor selection
                        }} 
                        value={selectedGroupId || ''}
                    >
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione o grupo primeiro..." />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {competitorGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </FormItem>
                 <FormField
                    control={form.control}
                    name="competitorId"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Concorrente (Unidade)</FormLabel>
                        <Select 
                            onValueChange={field.onChange} 
                            value={field.value} 
                            disabled={!selectedGroupId || !!productToEdit}
                        >
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione a unidade do concorrente" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {competitorsInGroup.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                 />
                <FormField
                  control={form.control}
                  name="itemName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da mercadoria</FormLabel>
                      <FormControl><Input placeholder="Ex: Milkshake Morango" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="packageSize"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tamanho (opcional)</FormLabel>
                          <FormControl><Input placeholder="Ex: 300, P, G" {...field} value={field.value || ''} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade de medida (opcional)</FormLabel>
                           <Select onValueChange={field.onChange} value={field.value || ''}>
                                <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {allUniqueUnits.map(unit => (
                                        <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                </div>
                 {!productToEdit && (
                   <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Preço (R$)</FormLabel>
                          <FormControl>
                            <Input
                                type="text"
                                placeholder="Ex: 19,90"
                                value={formatPrice(field.value)}
                                onChange={e => handlePriceChange(e, field)}
                            />
                            </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                 )}
                <FormField
                  control={form.control}
                  name="ksProductId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Correlacionar com sua mercadoria (opcional)</FormLabel>
                       <Select
                        onValueChange={(value) => field.onChange(value === 'none' ? null : value)}
                        value={field.value || 'none'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma mercadoria..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                           <div className="p-2">
                             <Input
                               placeholder="Buscar mercadoria..."
                               className="w-full"
                               value={searchTerm}
                               onChange={(e) => setSearchTerm(e.target.value)}
                             />
                           </div>
                          <SelectItem value="none">Nenhuma</SelectItem>
                          <ScrollArea className="h-48">
                            {filteredSimulations.map((sim) => (
                              <SelectItem key={sim.id} value={sim.id}>
                                {sim.name}
                              </SelectItem>
                            ))}
                          </ScrollArea>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Mercadoria ativa</FormLabel>
                        <DialogDescription className="text-xs">
                            Desmarque para ocultar esta mercadoria das análises.
                        </DialogDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
             </div>
            </ScrollArea>
             <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
              <Button type="button" variant="secondary" onClick={form.handleSubmit(handleSaveAndClose)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar e fechar
              </Button>
               <Button type="button" onClick={form.handleSubmit(handleSaveAndAddAnother)} disabled={isSubmitting || !!productToEdit}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar e adicionar outra
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}