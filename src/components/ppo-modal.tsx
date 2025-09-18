
"use client";

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type PPO } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useToast } from '@/hooks/use-toast';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Loader2, Upload, Camera, Video, Info } from 'lucide-react';
import Image from 'next/image';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { resizeImage } from '@/lib/image-utils';
import dynamic from 'next/dynamic';
import { Separator } from './ui/separator';


const PhotoCaptureModal = dynamic(
  () => import('./photo-capture-modal').then(mod => mod.PhotoCaptureModal),
  { ssr: false }
);


const ppoSchema = z.object({
  sku: z.string().optional(),
  ncm: z.string().optional(),
  cest: z.string().optional(),
  cfop: z.string().optional(),
  assemblyInstructions: z.array(z.object({ id: z.string(), text: z.string().min(1, "A instrução não pode ser vazia.") })),
  qualityStandard: z.string().optional(),
  allergens: z.array(z.object({ id: z.string(), text: z.string().min(1, "O alergênico não pode ser vazio.") })),
  preparationTime: z.coerce.number().optional(),
  portionWeight: z.coerce.number().optional(),
  portionTolerance: z.coerce.number().optional(),
  referenceImageUrl: z.string().optional(),
  assemblyVideoUrl: z.string().optional(),
});

type PpoFormValues = z.infer<typeof ppoSchema>;

interface PpoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

export function PpoModal({ open, onOpenChange, simulation }: PpoModalProps) {
  const { updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<PpoFormValues>({
    resolver: zodResolver(ppoSchema),
    defaultValues: {
      sku: '',
      ncm: '',
      cest: '',
      cfop: '',
      assemblyInstructions: [],
      qualityStandard: '',
      allergens: [],
      preparationTime: 0,
      portionWeight: 0,
      portionTolerance: 0,
      referenceImageUrl: '',
      assemblyVideoUrl: '',
    },
  });

  const { fields: instructionFields, append: appendInstruction, remove: removeInstruction } = useFieldArray({
    control: form.control,
    name: 'assemblyInstructions',
  });
  
  const { fields: allergenFields, append: appendAllergen, remove: removeAllergen } = useFieldArray({
    control: form.control,
    name: 'allergens',
  });

  useEffect(() => {
    if (simulation) {
      const ppoData = simulation.ppo || {};
      form.reset({
        sku: ppoData.sku || '',
        ncm: ppoData.ncm || '',
        cest: ppoData.cest || '',
        cfop: ppoData.cfop || '',
        assemblyInstructions: ppoData.assemblyInstructions || [],
        qualityStandard: ppoData.qualityStandard || '',
        allergens: ppoData.allergens || [],
        preparationTime: ppoData.preparationTime || 0,
        portionWeight: ppoData.portionWeight || 0,
        portionTolerance: ppoData.portionTolerance || 0,
        referenceImageUrl: ppoData.referenceImageUrl || '',
        assemblyVideoUrl: ppoData.assemblyVideoUrl || '',
      });
    }
  }, [simulation, form, open]);

  const onSubmit = async (values: PpoFormValues) => {
    if (!simulation) return;

    setIsLoading(true);
    await updateSimulation({
      ...simulation,
      ppo: values,
    });
    setIsLoading(false);
    toast({ title: 'Ficha da Mercadoria salva com sucesso!' });
    onOpenChange(false);
  };

  const handlePhotoCaptured = async (dataUrl: string) => {
    try {
        const resized = await resizeImage(dataUrl, 512, 512);
        form.setValue('referenceImageUrl', resized, { shouldValidate: true, shouldDirty: true });
        toast({ title: "Foto capturada com sucesso!" });
    } catch (e) {
        toast({ variant: 'destructive', title: 'Erro ao processar imagem' });
    }
    setIsPhotoModalOpen(false);
  };
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Por favor, selecione um arquivo de imagem menor que 5MB.' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const resizedDataUrl = await resizeImage(reader.result as string, 512, 512);
          form.setValue('referenceImageUrl', resizedDataUrl, { shouldValidate: true, shouldDirty: true });
        } catch (error) {
          toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Não foi possível redimensionar a imagem. Tente uma imagem diferente.' });
        }
      };
      reader.readAsDataURL(file);
    }
  };
  
  const ingredientsList = useMemo(() => {
    if (!simulation) return [];
    return simulationItems
        .filter(item => item.simulationId === simulation.id)
        .map(item => {
            const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
            return {
                name: baseProduct?.name || 'Insumo não encontrado',
                quantity: item.quantity,
                unit: item.overrideUnit || baseProduct?.unit || 'un'
            }
        });
  }, [simulation, simulationItems, baseProducts]);


  if (!simulation) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Ficha da Mercadoria</DialogTitle>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-semibold text-lg text-foreground">{simulation.name}</span>
                <TooltipProvider>
                    <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground">
                        <Info className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent className="p-0 max-w-sm" side="top">
                         <div className="p-4">
                            <div className="font-bold mb-2">Ingredientes</div>
                                {ingredientsList.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Ingrediente</TableHead>
                                                <TableHead className="text-right">Qtd.</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {ingredientsList.map(ing => (
                                                <TableRow key={ing.name}>
                                                    <TableCell>{ing.name}</TableCell>
                                                    <TableCell className="text-right">{ing.quantity} {ing.unit}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-sm text-muted-foreground">Nenhum ingrediente na composição.</p>
                                )}
                            </div>
                    </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
              <ScrollArea className="flex-1 pr-6">
                <div className="space-y-6 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="sku" render={({ field }) => (
                        <FormItem><FormLabel>SKU (Código do Produto)</FormLabel><FormControl><Input placeholder="Ex: MSK-MOR-P" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )}/>
                  </div>
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <FormField control={form.control} name="ncm" render={({ field }) => (
                        <FormItem><FormLabel>Código NCM</FormLabel><FormControl><Input placeholder="0000.00.00" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )}/>
                     <FormField control={form.control} name="cest" render={({ field }) => (
                        <FormItem><FormLabel>Código CEST</FormLabel><FormControl><Input placeholder="00.000.00" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )}/>
                     <FormField control={form.control} name="cfop" render={({ field }) => (
                        <FormItem><FormLabel>CFOP Padrão</FormLabel><FormControl><Input placeholder="0000" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )}/>
                  </div>
                  
                  <Separator />

                   <div className="space-y-2">
                    <FormLabel>Foto de Referência</FormLabel>
                    <div className="flex items-center gap-4">
                        <div className="w-24 h-24 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                            {form.watch('referenceImageUrl') ? <Image src={form.watch('referenceImageUrl')!} alt="Pré-visualização" width={96} height={96} className="object-cover" /> : <Camera className="h-10 w-10 text-muted-foreground" />}
                        </div>
                        <div className="flex flex-col gap-2">
                            <Button type="button" variant="outline" onClick={() => setIsPhotoModalOpen(true)}><Camera className="mr-2" /> Tirar foto</Button>
                            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2" /> Upload</Button>
                            {form.watch('referenceImageUrl') && <Button type="button" variant="destructive" size="sm" onClick={() => form.setValue('referenceImageUrl', '', { shouldDirty: true })}><Trash2 className="mr-2" /> Remover</Button>}
                        </div>
                    </div>
                    <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                  </div>

                  <div className="space-y-2">
                    <FormLabel>Modo de Montagem</FormLabel>
                    {instructionFields.map((field, index) => (
                      <div key={field.id} className="flex items-center gap-2">
                          <span className="font-semibold text-muted-foreground">{index + 1}.</span>
                          <FormField control={form.control} name={`assemblyInstructions.${index}.text`} render={({ field: stepField }) => (
                              <FormItem className="flex-grow"><FormControl><Input {...stepField} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeInstruction(index)}><Trash2 className="h-4 w-4"/></Button>
                      </div>
                    ))}
                      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => appendInstruction({ id: `instr-${Date.now()}`, text: '' })}>
                        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Passo
                    </Button>
                  </div>
                  
                   <FormField control={form.control} name="assemblyVideoUrl" render={({ field }) => (
                      <FormItem>
                          <FormLabel className="flex items-center gap-2"><Video className="h-4 w-4" /> URL do Vídeo de Montagem (opcional)</FormLabel>
                          <FormControl><Input placeholder="https://exemplo.com/video.mp4" {...field} value={field.value ?? ''} /></FormControl>
                          <FormMessage />
                      </FormItem>
                   )}/>

                   <div className="space-y-2">
                    <FormLabel>Alergênicos</FormLabel>
                    {allergenFields.map((field, index) => (
                      <div key={field.id} className="flex items-center gap-2">
                          <FormField control={form.control} name={`allergens.${index}.text`} render={({ field: stepField }) => (
                              <FormItem className="flex-grow"><FormControl><Input placeholder="Ex: Leite" {...stepField} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAllergen(index)}><Trash2 className="h-4 w-4"/></Button>
                      </div>
                    ))}
                      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => appendAllergen({ id: `allergen-${Date.now()}`, text: '' })}>
                        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Alergênico
                    </Button>
                  </div>


                  <FormField control={form.control} name="qualityStandard" render={({ field }) => (
                      <FormItem><FormLabel>Padrão de Qualidade</FormLabel><FormControl><Textarea placeholder="Ex: Borda do copo limpa, cobertura uniforme..." {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                  )}/>

                  <div className="grid grid-cols-3 gap-4">
                      <FormField control={form.control} name="preparationTime" render={({ field }) => (
                          <FormItem><FormLabel>Tempo de Preparo (segundos)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                      )}/>
                      <FormField control={form.control} name="portionWeight" render={({ field }) => (
                          <FormItem><FormLabel>Peso da Porção (g)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                      )}/>
                      <FormField control={form.control} name="portionTolerance" render={({ field }) => (
                          <FormItem><FormLabel>Tolerância (±g)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                      )}/>
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter className="pt-4 border-t mt-auto">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Ficha
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <PhotoCaptureModal
        open={isPhotoModalOpen}
        onOpenChange={setIsPhotoModalOpen}
        onPhotoCaptured={handlePhotoCaptured}
      />
    </>
  );
}
