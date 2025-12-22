

"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import dynamic from 'next/dynamic';

import { useProducts } from '@/hooks/use-products';
import { useToast } from '@/hooks/use-toast';
import { getUnitsForCategory, units, type UnitCategory, unitCategories } from '@/lib/conversion';
import { type Product } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';
import { resizeImage } from '@/lib/image-utils';


import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Camera, Trash2, Upload, Info, Settings, Search, Loader2 } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';


const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const PhotoCaptureModal = dynamic(
  () => import('./photo-capture-modal').then(mod => mod.PhotoCaptureModal),
  { ssr: false }
);

const productFormSchema = z.object({
  baseName: z.string().min(1, 'O nome base é obrigatório.'),
  brand: z.string().optional(),
  barcode: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
  notes: z.string().optional(),
  baseProductId: z.string().optional(),

  // Conditional sections
  enableLogistics: z.boolean().optional(),
  multiplo_caixa: z.coerce.number().optional(),
  rotulo_caixa: z.string().optional(),

  enableSecondaryUnit: z.boolean().optional(),
  secondaryUnitValue: z.coerce.number().optional(),
  secondaryUnit: z.string().optional(),
  
  enableCountingInstruction: z.boolean().optional(),
  countingInstruction: z.string().optional(),
  countingInstructionImageUrl: z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.enableLogistics) {
        if (!data.multiplo_caixa || data.multiplo_caixa <= 0) {
            ctx.addIssue({ code: 'custom', path: ['multiplo_caixa'], message: 'Deve ser > 0.' });
        }
        if (!data.rotulo_caixa || data.rotulo_caixa.trim() === '') {
            ctx.addIssue({ code: 'custom', path: ['rotulo_caixa'], message: 'Obrigatório.' });
        }
    }
    if (data.enableSecondaryUnit) {
        if (!data.secondaryUnitValue || data.secondaryUnitValue <= 0) {
            ctx.addIssue({ code: 'custom', path: ['secondaryUnitValue'], message: 'Deve ser > 0.' });
        }
        if (!data.secondaryUnit) {
            ctx.addIssue({ code: 'custom', path: ['secondaryUnit'], message: 'Obrigatório.' });
        }
    }
    if (data.enableCountingInstruction) {
        if (!data.countingInstruction && !data.countingInstructionImageUrl) {
            ctx.addIssue({ code: 'custom', path: ['countingInstruction'], message: 'Adicione um texto ou uma imagem.' });
        }
    }
});


type ProductFormValues = z.infer<typeof productFormSchema>;

interface AddEditProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit: Product | null;
  onManageBaseProducts: () => void;
}

export function AddEditProductModal({ open, onOpenChange, productToEdit, onManageBaseProducts }: AddEditProductModalProps) {
    const { addProduct, updateProduct, getProductFullName } = useProducts();
    const { baseProducts } = useBaseProducts();
    const { toast } = useToast();

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [isInstructionPhotoModalOpen, setIsInstructionPhotoModalOpen] = useState(false);
    const [isFetchingProduct, setIsFetchingProduct] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const instructionFileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productFormSchema),
        defaultValues: {
            baseName: '', brand: '', barcode: '', imageUrl: '',
            category: 'Massa', packageSize: undefined, unit: 'g',
            notes: '', baseProductId: '',
            enableLogistics: false, multiplo_caixa: undefined, rotulo_caixa: '',
            enableSecondaryUnit: false, secondaryUnitValue: undefined, secondaryUnit: 'g',
            enableCountingInstruction: false, countingInstruction: '', countingInstructionImageUrl: '',
        }
    });
    
    const categoryWatch = form.watch('category');
    const enableLogisticsWatch = form.watch('enableLogistics');
    const enableSecondaryUnitWatch = form.watch('enableSecondaryUnit');
    const enableCountingInstructionWatch = form.watch('enableCountingInstruction');
    const baseProductIdWatch = form.watch('baseProductId');

    useEffect(() => {
        if (open) {
            if (productToEdit) {
                 form.reset({
                    baseName: productToEdit.baseName,
                    brand: productToEdit.brand || '',
                    barcode: productToEdit.barcode || '',
                    imageUrl: productToEdit.imageUrl || '',
                    category: productToEdit.category,
                    packageSize: productToEdit.packageSize,
                    unit: productToEdit.unit,
                    notes: productToEdit.notes || '',
                    baseProductId: productToEdit.baseProductId || '',
                    // Switches
                    enableLogistics: !!productToEdit.multiplo_caixa,
                    multiplo_caixa: productToEdit.multiplo_caixa || undefined,
                    rotulo_caixa: productToEdit.rotulo_caixa || '',
                    
                    enableSecondaryUnit: !!productToEdit.secondaryUnitValue,
                    secondaryUnitValue: productToEdit.secondaryUnitValue,
                    secondaryUnit: productToEdit.secondaryUnit || 'g',

                    enableCountingInstruction: !!(productToEdit.countingInstruction || productToEdit.countingInstructionImageUrl),
                    countingInstruction: productToEdit.countingInstruction || '',
                    countingInstructionImageUrl: productToEdit.countingInstructionImageUrl || '',
                });
            } else {
                form.reset({
                    baseName: '', brand: '', barcode: '', imageUrl: '',
                    category: 'Massa', packageSize: undefined, unit: 'g',
                    notes: '', baseProductId: '',
                    enableLogistics: false, multiplo_caixa: undefined, rotulo_caixa: '',
                    enableSecondaryUnit: false, secondaryUnitValue: undefined, secondaryUnit: 'g',
                    enableCountingInstruction: false, countingInstruction: '', countingInstructionImageUrl: '',
                });
            }
        }
    }, [open, productToEdit, form]);
    
    useEffect(() => {
        if (form.formState.isDirty && !productToEdit) {
            form.setValue('unit', getUnitsForCategory(categoryWatch)[0]);
        }
    }, [categoryWatch, form, productToEdit]);


    const handleScanSuccess = (decodedText: string) => {
        form.setValue('barcode', decodedText, { shouldValidate: true });
        setIsScannerOpen(false);
    };

    const handlePhotoCaptured = async (dataUrl: string, target: 'main' | 'instruction') => {
        try {
            const resized = await resizeImage(dataUrl, 512, 512);
            if (target === 'main') {
                form.setValue('imageUrl', resized, { shouldValidate: true, shouldDirty: true });
            } else {
                form.setValue('countingInstructionImageUrl', resized, { shouldValidate: true, shouldDirty: true });
            }
            toast({ title: "Foto capturada com sucesso!" });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erro ao processar imagem' });
        }
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, target: 'main' | 'instruction') => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Por favor, selecione um arquivo de imagem menor que 5MB.' });
                return;
            }
            const reader = new FileReader();
            reader.onloadend = async () => {
                try {
                    const resizedDataUrl = await resizeImage(reader.result as string, 512, 512);
                    if (target === 'main') {
                        form.setValue('imageUrl', resizedDataUrl, { shouldValidate: true, shouldDirty: true });
                    } else {
                        form.setValue('countingInstructionImageUrl', resizedDataUrl, { shouldValidate: true, shouldDirty: true });
                    }
                } catch (error) {
                    toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Não foi possível redimensionar a imagem. Tente uma imagem diferente.' });
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const onSubmit = (values: ProductFormValues) => {
        // Validation Trava 1
        if (values.baseProductId) {
            const baseProduct = baseProducts.find(bp => bp.id === values.baseProductId);
            if (baseProduct) {
                const insumoCategory = values.category;
                const baseProductCategory = baseProduct.category;

                if (insumoCategory !== baseProductCategory && !values.enableSecondaryUnit) {
                    toast({
                        variant: "destructive",
                        title: "Vínculo Inválido",
                        description: `A categoria do insumo (${insumoCategory}) é diferente da do produto base (${baseProductCategory}). Ative e preencha a "Qtd por Embalagem (Opcional)" para criar a regra de conversão.`,
                        duration: 8000,
                    });
                    return; // Stop submission
                }
            }
        }

        const productData: Omit<Product, 'id'> = {
            baseName: values.baseName,
            brand: values.brand,
            barcode: values.barcode,
            imageUrl: values.imageUrl,
            category: values.category,
            packageSize: values.packageSize,
            unit: values.unit,
            notes: values.notes,
            baseProductId: values.baseProductId,
            
            multiplo_caixa: values.enableLogistics ? values.multiplo_caixa : undefined,
            rotulo_caixa: values.enableLogistics ? values.rotulo_caixa : undefined,
            
            secondaryUnitValue: values.enableSecondaryUnit ? values.secondaryUnitValue : undefined,
            secondaryUnit: values.enableSecondaryUnit ? values.secondaryUnit : undefined,
            
            countingInstruction: values.enableCountingInstruction ? values.countingInstruction : undefined,
            countingInstructionImageUrl: values.enableCountingInstruction ? values.countingInstructionImageUrl : undefined,
        };

        if (productToEdit) {
            updateProduct({ ...productToEdit, ...productData });
        } else {
            addProduct(productData);
        }
        onOpenChange(false);
    };

    const allUnits = useMemo(() => {
        return (Object.keys(units) as UnitCategory[]).flatMap(cat => 
            Object.keys(units[cat])
        );
    }, []);
    
    const showCategoryMismatchWarning = useMemo(() => {
        if (!baseProductIdWatch) return false;
        const baseProduct = baseProducts.find(bp => bp.id === baseProductIdWatch);
        if (!baseProduct) return false;
        
        return baseProduct.category !== categoryWatch && !enableSecondaryUnitWatch;
    }, [baseProductIdWatch, categoryWatch, enableSecondaryUnitWatch, baseProducts]);


    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{productToEdit ? `Editando ${getProductFullName(productToEdit)}` : 'Adicionar novo insumo'}</DialogTitle>
                        <DialogDescription>
                            Preencha os detalhes do insumo abaixo.
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <ScrollArea className="h-[60vh] -mx-6 px-6 pr-8">
                            <div className="space-y-4 pt-4">
                                <div className="space-y-2">
                                    <FormLabel>Foto do insumo</FormLabel>
                                    <div className="flex items-center gap-4">
                                        <div className="w-24 h-24 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                                            {form.watch('imageUrl') ? <Image src={form.watch('imageUrl')!} alt="Pré-visualização" width={96} height={96} className="object-cover" /> : <Camera className="h-10 w-10 text-muted-foreground" />}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Button type="button" variant="outline" onClick={() => setIsPhotoModalOpen(true)}><Camera className="mr-2" /> {form.watch('imageUrl') ? 'Tirar outra' : 'Tirar foto'}</Button>
                                            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2" /> Upload</Button>
                                            {form.watch('imageUrl') && <Button type="button" variant="destructive" size="sm" onClick={() => form.setValue('imageUrl', '', { shouldDirty: true })}><Trash2 className="mr-2" /> Remover</Button>}
                                        </div>
                                    </div>
                                    <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'main')} />
                                    <FormField control={form.control} name="imageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField control={form.control} name="baseName" render={({ field }) => (<FormItem><FormLabel>Nome do insumo</FormLabel><FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="brand" render={({ field }) => (<FormItem><FormLabel>Marca</FormLabel><FormControl><Input placeholder="ex: Nestlé" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                
                                <FormField control={form.control} name="barcode" render={({ field }) => (
                                    <FormItem><FormLabel>Código de barras</FormLabel>
                                        <div className="flex gap-2">
                                            <FormControl><Input placeholder="Escanear ou digitar" {...field} value={field.value ?? ''} /></FormControl>
                                            <Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><Camera className="h-4 w-4" /></Button>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}/>

                                <div className="grid grid-cols-3 gap-4">
                                    <FormField control={form.control} name="category" render={({ field }) => (<FormItem><FormLabel>Categoria</FormLabel><Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="packageSize" render={({ field }) => (<FormItem>
                                        <div className="flex items-center gap-2">
                                            <FormLabel>Qtd. embalagem</FormLabel>
                                            <TooltipProvider delayDuration={100}>
                                                <Tooltip>
                                                    <TooltipTrigger type="button" onClick={(e) => e.preventDefault()}>
                                                        <Info className="h-4 w-4 text-muted-foreground" />
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Informe o conteúdo da embalagem. Ex: para 400g, digite 400.</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                        <FormControl><Input type="number" step="any" placeholder="ex: 250" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="unit" render={({ field }) => (<FormItem><FormLabel>Unidade</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{getUnitsForCategory(categoryWatch).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)}/>
                                </div>
                                
                                <Separator />

                                <FormField control={form.control} name="enableLogistics" render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm bg-blue-100/40 dark:bg-blue-900/20">
                                        <div className="space-y-0.5"><FormLabel>Detalhes Logísticos (Opcional)</FormLabel><FormDescription>Otimize a separação no estoque, agrupando em caixas ou fardos.</FormDescription></div>
                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    </FormItem>
                                )} />
                                {enableLogisticsWatch && (
                                    <div className="p-4 border rounded-lg bg-blue-100/20 dark:bg-blue-900/10 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="multiplo_caixa" render={({ field }) => (<FormItem><FormLabel>Unidades por Caixa</FormLabel><FormControl><Input type="number" step="1" placeholder="Ex: 12" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            <FormField control={form.control} name="rotulo_caixa" render={({ field }) => (<FormItem><FormLabel>Rótulo da Embalagem</FormLabel><FormControl><Input placeholder="Ex: Caixa, Fardo" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                        </div>
                                    </div>
                                )}
                                
                                <FormField control={form.control} name="enableSecondaryUnit" render={({ field }) => (
                                     <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm bg-green-100/40 dark:bg-green-900/20">
                                        <div className="space-y-0.5"><FormLabel>Qtd por Embalagem (Opcional)</FormLabel><FormDescription>Use se o estoque geral for controlado por uma unidade diferente.</FormDescription></div>
                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    </FormItem>
                                )} />
                                {enableSecondaryUnitWatch && (
                                    <div className="p-4 border rounded-lg bg-green-100/20 dark:bg-green-900/10 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="secondaryUnitValue" render={({ field }) => (<FormItem><FormLabel>Quantidade</FormLabel><FormControl><Input type="number" step="any" placeholder="ex: 300" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            <FormField control={form.control} name="secondaryUnit" render={({ field }) => (<FormItem><FormLabel>Unidade de medida</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{allUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)}/>
                                        </div>
                                    </div>
                                )}
                                
                                <FormField control={form.control} name="enableCountingInstruction" render={({ field }) => (
                                     <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm bg-purple-100/40 dark:bg-purple-900/20">
                                        <div className="space-y-0.5"><FormLabel>Instrução de Contagem (Opcional)</FormLabel><FormDescription>Adicione um texto ou imagem para guiar a contagem.</FormDescription></div>
                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    </FormItem>
                                )} />
                                {enableCountingInstructionWatch && (
                                    <div className="p-4 border rounded-lg bg-purple-100/20 dark:bg-purple-900/10 space-y-4">
                                        <FormField control={form.control} name="countingInstruction" render={({ field }) => (<FormItem><FormLabel>Texto da instrução</FormLabel><FormControl><Textarea placeholder="Ex: Contar por peso na balança..." {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                        <div className="space-y-2">
                                            <FormLabel>Imagem de instrução (opcional)</FormLabel>
                                            <div className="flex items-center gap-4">
                                                <div className="w-24 h-24 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                                                    {form.watch('countingInstructionImageUrl') ? <Image src={form.watch('countingInstructionImageUrl')!} alt="Pré-visualização" width={96} height={96} className="object-cover" /> : <Camera className="h-10 w-10 text-muted-foreground" />}
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    <Button type="button" variant="outline" onClick={() => setIsInstructionPhotoModalOpen(true)}><Camera className="mr-2" /> {form.watch('countingInstructionImageUrl') ? 'Tirar outra' : 'Tirar foto'}</Button>
                                                    <Button type="button" variant="outline" onClick={() => instructionFileInputRef.current?.click()}><Upload className="mr-2" /> Upload</Button>
                                                    {form.watch('countingInstructionImageUrl') && <Button type="button" variant="destructive" size="sm" onClick={() => form.setValue('countingInstructionImageUrl', '', { shouldDirty: true })}><Trash2 className="mr-2" /> Remover</Button>}
                                                </div>
                                            </div>
                                            <Input type="file" ref={instructionFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'instruction')} />
                                            <FormField control={form.control} name="countingInstructionImageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                        </div>
                                    </div>
                                )}
                                
                                <Separator />

                                <FormField control={form.control} name="baseProductId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Insumo base</FormLabel>
                                        <div className="flex gap-2 items-center">
                                            <Select onValueChange={(value) => field.onChange(value || '')} value={field.value || ''}>
                                                <FormControl>
                                                    <SelectTrigger><SelectValue placeholder="Selecione para agrupar este insumo..."/></SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {baseProducts.map(ap => <SelectItem key={ap.id} value={ap.id}>{ap.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Button type="button" variant="outline" size="icon" onClick={onManageBaseProducts}>
                                                <Settings className="h-4 w-4"/>
                                            </Button>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                                
                                {showCategoryMismatchWarning && (
                                     <Alert variant="destructive">
                                        <AlertTitle>Vínculo de categorias diferentes</AlertTitle>
                                        <AlertDescription>
                                            A categoria deste insumo é diferente da categoria do produto base. Para que a conversão funcione, você <b>precisa</b> habilitar e preencher a "Qtd por Embalagem (Opcional)".
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>Observações</FormLabel><FormControl><Textarea placeholder="Insira observações (opcional)" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                            </div>
                        </ScrollArea>
                        <DialogFooter className="pt-4 border-t">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit">{productToEdit ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                        </DialogFooter>
                    </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {isScannerOpen && <BarcodeScannerModal open={isScannerOpen} onOpenChange={setIsScannerOpen} onScanSuccess={handleScanSuccess} />}
            {isPhotoModalOpen && <PhotoCaptureModal open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen} onPhotoCaptured={(dataUrl) => handlePhotoCaptured(dataUrl, 'main')} />}
            {isInstructionPhotoModalOpen && <PhotoCaptureModal open={isInstructionPhotoModalOpen} onOpenChange={setIsInstructionPhotoModalOpen} onPhotoCaptured={(dataUrl) => handlePhotoCaptured(dataUrl, 'instruction')} />}
        </>
    );
}

    

    