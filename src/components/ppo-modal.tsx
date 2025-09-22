
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
import { PlusCircle, Trash2, Loader2, Upload, Camera, Video, Info, Utensils } from 'lucide-react';
import Image from 'next/image';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { resizeImage } from '@/lib/image-utils';
import dynamic from 'next/dynamic';
import { Separator } from './ui/separator';
import { units, unitCategories, type UnitCategory } from '@/lib/conversion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';


const PhotoCaptureModal = dynamic(
  () => import('./photo-capture-modal').then(mod => mod.PhotoCaptureModal),
  { ssr: false }
);

const etapaSchema = z.object({
    id: z.string(),
    text: z.string().min(1, "A descrição da etapa não pode ser vazia."),
    quantity: z.coerce.number().optional(),
    unit: z.string().optional(),
    imageUrl: z.string().optional(),
});

const phaseSchema = z.object({
    id: z.string(),
    name: z.string().min(1, "O nome da fase é obrigatório."),
    etapas: z.array(etapaSchema).min(1, "A fase deve ter pelo menos uma etapa."),
});

const ppoSchema = z.object({
  sku: z.string().optional(),
  ncm: z.string().optional(),
  cest: z.string().optional(),
  cfop: z.string().optional(),
  assemblyInstructions: z.array(phaseSchema),
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

  const { fields: phaseFields, append: appendPhase, remove: removePhase } = useFieldArray({
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

                  <div className="space-y-4">
                    <FormLabel>Modo de Montagem</FormLabel>
                    {phaseFields.map((phase, phaseIndex) => (
                      <div key={phase.id} className="p-4 border rounded-lg space-y-3">
                        <div className="flex items-center gap-2">
                          <FormField control={form.control} name={`assemblyInstructions.${phaseIndex}.name`} render={({ field }) => (
                            <FormItem className="flex-grow"><FormLabel>Nome da Fase</FormLabel><FormControl><Input placeholder="Ex: Preparo da base" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive mt-7" onClick={() => removePhase(phaseIndex)}><Trash2 className="h-4 w-4"/></Button>
                        </div>
                        <PhaseEtapas control={form.control} phaseIndex={phaseIndex} form={form} />
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="w-full" onClick={() => appendPhase({ id: `phase-${Date.now()}`, name: '', etapas: [{id: `etapa-${Date.now()}`, text: ''}] })}>
                      <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Fase
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
                  Salvar
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


function PhaseEtapas({ control, phaseIndex, form }: { control: any, phaseIndex: number, form: any }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `assemblyInstructions.${phaseIndex}.etapas`,
  });

  return (
    <div className="pl-4 border-l-2 ml-2 space-y-3">
      <FormLabel>Etapas da Fase</FormLabel>
      {fields.map((etapa, etapaIndex) => (
        <div key={etapa.id} className="p-3 border rounded-md bg-background space-y-2">
           <div className="flex items-start gap-2">
                <span className="font-semibold text-muted-foreground pt-2">{etapaIndex + 1}.</span>
                <FormField control={control} name={`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.text`} render={({ field }) => (
                    <FormItem className="flex-grow">
                        <FormControl><Input placeholder="Descrição da etapa..." {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )}/>
                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(etapaIndex)}><Trash2 className="h-4 w-4"/></Button>
           </div>
           <EtapaExtras form={form} phaseIndex={phaseIndex} etapaIndex={etapaIndex} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => append({ id: `etapa-${Date.now()}`, text: '' })}>
        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Etapa
      </Button>
    </div>
  );
}

function EtapaExtras({ form, phaseIndex, etapaIndex }: { form: any, phaseIndex: number, etapaIndex: number }) {
    const [showQuantity, setShowQuantity] = useState(!!form.getValues(`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.quantity`));
    const [showImage, setShowImage] = useState(!!form.getValues(`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.imageUrl`));
    
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const allUnits = useMemo(() => {
        return unitCategories.flatMap(category => Object.keys(units[category]));
    }, []);

    const handlePhotoCaptured = async (dataUrl: string) => {
        try {
            const resized = await resizeImage(dataUrl, 256, 256);
            form.setValue(`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.imageUrl`, resized, { shouldValidate: true, shouldDirty: true });
        } catch (e) { console.error(e) }
        setIsPhotoModalOpen(false);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = async () => {
            try {
                const resized = await resizeImage(reader.result as string, 256, 256);
                form.setValue(`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.imageUrl`, resized, { shouldValidate: true, shouldDirty: true });
            } catch (error) { console.error(error) }
        };
        reader.readAsDataURL(file);
    };

    return (
        <>
            <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant={showQuantity ? "secondary" : "ghost"} onClick={() => setShowQuantity(!showQuantity)}>
                    <Utensils className="mr-2 h-4 w-4"/> Qtd.
                </Button>
                <Button type="button" size="sm" variant={showImage ? "secondary" : "ghost"} onClick={() => setShowImage(!showImage)}>
                    <Camera className="mr-2 h-4 w-4"/> Imagem
                </Button>
            </div>

            {showQuantity && (
                <div className="grid grid-cols-2 gap-2">
                    <FormField control={form.control} name={`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.quantity`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" placeholder="Ex: 20" {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                     <FormField control={form.control} name={`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.unit`} render={({ field }) => (
                        <FormItem><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                    )}/>
                </div>
            )}

            {showImage && (
                 <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                        {form.watch(`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.imageUrl`) ? <Image src={form.watch(`assemblyInstructions.${phaseIndex}.etapas.${etapaIndex}.imageUrl`)} alt="Preview" width={64} height={64} className="object-cover" /> : <Camera className="h-8 w-8 text-muted-foreground" />}
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setIsPhotoModalOpen(true)}><Camera className="mr-2 h-3 w-3" /> Tirar foto</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-3 w-3" /> Upload</Button>
                    </div>
                    <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                </div>
            )}
             {isPhotoModalOpen && (
                <PhotoCaptureModal open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen} onPhotoCaptured={handlePhotoCaptured} />
             )}
        </>
    )
}
