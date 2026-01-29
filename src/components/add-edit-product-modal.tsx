
"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import dynamic from 'next/dynamic';

import { useProducts } from '@/hooks/use-products';
import { useToast } from '@/hooks/use-toast';
import { getUnitsForCategory, units, type UnitCategory, unitCategories, packageTypes, type PackageType } from '@/lib/conversion';
import { type Product } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';


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
import { Card } from './ui/card';


const BarcodeScannerModal = dynamic(
  () => import('@/components/barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const PhotoCaptureModal = dynamic(
  () => import('@/components/photo-capture-modal').then(mod => mod.PhotoCaptureModal),
  { ssr: false }
);

const productFormSchema = z.object({
  baseName: z.string().min(1, 'O nome base é obrigatório.'),
  brand: z.string().optional(),
  barcode: z.string().optional(),
  imageUrl: z.string().optional(),
  packageType: z.string().min(1, 'O tipo de embalagem é obrigatório.'),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
  notes: z.string().optional(),
  baseProductId: z.string().optional(),
  defaultCountingUnit: z.enum(['package', 'base', 'content']).optional(),

  // Conditional sections
  enableLogistics: z.boolean().optional(),
  multiplo_caixa: z.coerce.number().optional(),
  rotulo_caixa: z.string().optional(),
  
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
            packageType: '',
            category: 'Massa', packageSize: undefined, unit: 'g',
            notes: '', baseProductId: '',
            defaultCountingUnit: 'package',
            enableLogistics: false, multiplo_caixa: undefined, rotulo_caixa: '',
            enableCountingInstruction: false, countingInstruction: '', countingInstructionImageUrl: '',
        }
    });
    
    const categoryWatch = form.watch('category');
    const enableLogisticsWatch = form.watch('enableLogistics');
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
                    packageType: productToEdit.packageType || '',
                    category: productToEdit.category,
                    packageSize: productToEdit.packageSize,
                    unit: productToEdit.unit,
                    notes: productToEdit.notes || '',
                    baseProductId: productToEdit.baseProductId || '',
                    defaultCountingUnit: productToEdit.defaultCountingUnit || 'package',
                    // Switches
                    enableLogistics: !!productToEdit.multiplo_caixa,
                    multiplo_caixa: productToEdit.multiplo_caixa || undefined,
                    rotulo_caixa: productToEdit.rotulo_caixa || '',
                    
                    enableCountingInstruction: !!(productToEdit.countingInstruction || productToEdit.countingInstructionImageUrl),
                    countingInstruction: productToEdit.countingInstruction || '',
                    countingInstructionImageUrl: productToEdit.countingInstructionImageUrl || '',
                });
            } else {
                form.reset({
                    baseName: '', brand: '', barcode: '', imageUrl: '',
                    packageType: '',
                    category: 'Massa', packageSize: undefined, unit: 'g',
                    notes: '', baseProductId: '',
                    defaultCountingUnit: 'package',
                    enableLogistics: false, multiplo_caixa: undefined, rotulo_caixa: '',
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
        if (target === 'main') {
            form.setValue('imageUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
        } else {
            form.setValue('countingInstructionImageUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
        }
        toast({ title: "Foto capturada com sucesso!" });
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
                const dataUrl = reader.result as string;
                if (target === 'main') {
                    form.setValue('imageUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
                } else {
                    form.setValue('countingInstructionImageUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
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

                if (insumoCategory !== baseProductCategory) {
                    toast({
                        variant: "destructive",
                        title: "Vínculo Inválido",
                        description: `A categoria do insumo (${insumoCategory}) é diferente da do produto base (${baseProductCategory}).`,
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
            packageType: values.packageType as PackageType,
            category: values.category,
            packageSize: values.packageSize,
            unit: values.unit,
            notes: values.notes,
            baseProductId: values.baseProductId,
            defaultCountingUnit: values.defaultCountingUnit,
            
            multiplo_caixa: values.enableLogistics ? values.multiplo_caixa : undefined,
            rotulo_caixa: values.enableLogistics ? values.rotulo_caixa : undefined,
                        
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
        
        return baseProduct.category !== categoryWatch;
    }, [baseProductIdWatch, categoryWatch, baseProducts]);


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
                                <Card className="p-4 bg-blue-500/5 dark:bg-blue-900/10">
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
                                </Card>

                                <Card className="p-4 bg-blue-500/5 dark:bg-blue-900/10">
                                     <h3 className="font-medium mb-4">Informações básicas</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField control={form.control} name="baseName" render={({ field }) => (<FormItem><FormLabel>Nome do insumo</FormLabel><FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                        <FormField control={form.control} name="brand" render={({ field }) => (<FormItem><FormLabel>Marca</FormLabel><FormControl><Input placeholder="ex: Nestlé" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                    </div>
                                    
                                    <FormField control={form.control} name="barcode" render={({ field }) => (
                                        <FormItem className='mt-4'><FormLabel>Código de barras</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl><Input placeholder="Escanear ou digitar" {...field} value={field.value ?? ''} /></FormControl>
                                                <Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><Camera className="h-4 w-4" /></Button>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}/>
                                </Card>
                                
                                <Card className="p-4 bg-amber-100 dark:bg-amber-900/20">
                                    <div className="space-y-0.5 mb-4">
                                        <h3 className="font-medium">Embalagem de conteúdo</h3>
                                        <p className="text-sm text-muted-foreground">
                                            Detalhes do item físico que você compra. Ex: um pacote de 500g, uma lata de 395g, etc.
                                        </p>
                                    </div>
                                     <FormField
                                        control={form.control}
                                        name="packageType"
                                        render={({ field }) => (
                                            <FormItem>
                                            <FormLabel>Tipo de embalagem</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione o tipo de embalagem" />
                                                </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {packageTypes.map((type) => (
                                                        <SelectItem key={type} value={type}>
                                                        {type}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="grid grid-cols-3 gap-4 mt-4">
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
                                </Card>
                                
                                <Card className="p-4 bg-blue-100 dark:bg-blue-900/20">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <FormLabel className="text-base">Detalhes logísticos</FormLabel>
                                            <FormDescription>Embalagem de agrupamento.</FormDescription>
                                        </div>
                                        <FormField control={form.control} name="enableLogistics" render={({ field }) => (
                                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        )} />
                                    </div>
                                    {enableLogisticsWatch && (
                                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-blue-500/20 mt-4">
                                            <FormField control={form.control} name="multiplo_caixa" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Quantidade</FormLabel>
                                                    <FormControl><Input type="number" step="1" placeholder="Ex: 12" {...field} value={field.value ?? ''} /></FormControl>
                                                    <FormDescription className="text-xs">
                                                        Informe quantas unidades do insumo de compra (ex: bags, latas, pacotes) cabem dentro da embalagem de agrupamento. Exemplo: se 1 'Caixa' contém 10 'Bags', insira '10'.
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>
                                            <FormField control={form.control} name="rotulo_caixa" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Tipo de agrupamento</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="Caixa">Caixa</SelectItem>
                                                            <SelectItem value="Fardo">Fardo</SelectItem>
                                                            <SelectItem value="Pallet">Pallet</SelectItem>
                                                            <SelectItem value="Tambor">Tambor</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>
                                        </div>
                                    )}
                                </Card>
                                
                                <Card className="p-4 bg-green-100 dark:bg-green-900/20">
                                  <FormField
                                      control={form.control}
                                      name="defaultCountingUnit"
                                      render={({ field }) => (
                                          <FormItem>
                                              <FormLabel>Unidade Padrão para Contagem</FormLabel>
                                              <Select onValueChange={field.onChange} value={field.value}>
                                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                  <SelectContent>
                                                      <SelectItem value="package">Unidade do Lote</SelectItem>
                                                      <SelectItem value="base">Unidade do Produto Base</SelectItem>
                                                      <SelectItem value="content">Unidade do Conteúdo</SelectItem>
                                                  </SelectContent>
                                              </Select>
                                              <FormDescription>Define como este insumo será exibido e contado no módulo de contagem de estoque.</FormDescription>
                                              <FormMessage />
                                          </FormItem>
                                      )}
                                  />
                                </Card>

                                <Card className="p-4 bg-sky-100 dark:bg-sky-900/20">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <FormLabel className="text-base">Instrução de Contagem</FormLabel>
                                            <FormDescription>Adicione um texto ou imagem para guiar a contagem.</FormDescription>
                                        </div>
                                        <FormField control={form.control} name="enableCountingInstruction" render={({ field }) => (
                                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        )}/>
                                    </div>
                                    {enableCountingInstructionWatch && (
                                        <div className="space-y-4 pt-4 border-t border-sky-500/20 mt-4">
                                            <FormField control={form.control} name="countingInstruction" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Texto da instrução</FormLabel>
                                                    <FormControl><Textarea placeholder="Ex: Contar por peso na balança..." {...field} value={field.value ?? ''} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>
                                            <div className="space-y-2">
                                                <FormLabel>Imagem de instrução</FormLabel>
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
                                </Card>
                                
                                <Card className="p-4 bg-violet-100 dark:bg-violet-900/20">
                                    <h3 className="font-medium mb-4">Vínculo e observações</h3>
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
                                                A categoria deste insumo é diferente da categoria do produto base. A conversão de unidades pode não funcionar corretamente.
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    <FormField control={form.control} name="notes" render={({ field }) => (<FormItem className='mt-4'><FormLabel>Observações</FormLabel><FormControl><Textarea placeholder="Insira observações (opcional)" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </Card>
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

    
