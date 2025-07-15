
"use client"

import React, { useEffect, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import dynamic from 'next/dynamic';

import { useProducts } from '@/hooks/use-products';
import { useToast } from '@/hooks/use-toast';
import { getUnitsForCategory } from '@/lib/conversion';
import { type Product, type UnitCategory, unitCategories } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Camera, Trash2, Upload, Info, Settings } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from './ui/separator';


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
  secondaryUnitValue: z.coerce.number().optional(),
  secondaryUnit: z.string().optional(),
  notes: z.string().optional(),
  baseProductId: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

const resizeImage = (dataUrl: string, maxWidth: number, maxHeight: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round(width * (maxHeight / height));
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context'));
            }
            ctx.drawImage(img, 0, 0, width, height);
            
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = (err) => {
            reject(new Error('Failed to load image'));
        };
        img.src = dataUrl;
    });
};

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
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productFormSchema),
        defaultValues: {
            baseName: '', brand: '', barcode: '', imageUrl: '',
            category: 'Massa', packageSize: undefined, unit: 'g',
            secondaryUnitValue: undefined, secondaryUnit: 'g',
            notes: '', baseProductId: ''
        }
    });
    
    const categoryWatch = form.watch('category');
    
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
                    secondaryUnitValue: productToEdit.secondaryUnitValue,
                    secondaryUnit: productToEdit.secondaryUnit || 'g',
                    notes: productToEdit.notes || '',
                    baseProductId: productToEdit.baseProductId || '',
                });
            } else {
                form.reset({
                    baseName: '', brand: '', barcode: '', imageUrl: '',
                    category: 'Massa', packageSize: undefined, unit: 'g',
                    secondaryUnitValue: undefined, secondaryUnit: 'g',
                    notes: '', baseProductId: ''
                });
            }
        }
    }, [open, productToEdit, form]);
    
    useEffect(() => {
        if (form.formState.isDirty || !productToEdit) {
            form.setValue('unit', getUnitsForCategory(categoryWatch)[0]);
        }
    }, [categoryWatch, form, productToEdit]);


    const handleScanSuccess = (decodedText: string) => {
        form.setValue('barcode', decodedText, { shouldValidate: true });
        setIsScannerOpen(false);
    };

    const handlePhotoCaptured = async (dataUrl: string) => {
        try {
            const resized = await resizeImage(dataUrl, 512, 512);
            form.setValue('imageUrl', resized, { shouldValidate: true, shouldDirty: true });
            toast({ title: "Foto capturada com sucesso!" });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erro ao processar imagem' });
        }
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
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
                    form.setValue('imageUrl', resizedDataUrl, { shouldValidate: true, shouldDirty: true });
                } catch (error) {
                    toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Não foi possível redimensionar a imagem. Tente uma imagem diferente.' });
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const onSubmit = (values: ProductFormValues) => {
        const productData = { ...values };
        if (productToEdit) {
            updateProduct({ ...productToEdit, ...productData });
        } else {
            addProduct(productData);
        }
        onOpenChange(false);
    };

    const secondaryUnitCategory = useMemo(() => {
        switch(categoryWatch) {
            case 'Unidade': return 'Massa';
            case 'Embalagem': return 'Unidade';
            default: return categoryWatch;
        }
    }, [categoryWatch]);

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
                                    <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                                    <FormField control={form.control} name="imageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField control={form.control} name="baseName" render={({ field }) => (<FormItem><FormLabel>Nome do insumo</FormLabel><FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="brand" render={({ field }) => (<FormItem><FormLabel>Marca (opcional)</FormLabel><FormControl><Input placeholder="ex: Nestlé" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                
                                <FormField control={form.control} name="barcode" render={({ field }) => (
                                    <FormItem><FormLabel>Código de barras</FormLabel><div className="flex gap-2"><FormControl><Input placeholder="Escanear ou digitar" {...field} value={field.value ?? ''} /></FormControl><Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><Camera className="h-4 w-4" /></Button></div><FormMessage /></FormItem>
                                )}/>

                                <div className="grid grid-cols-3 gap-4">
                                    <FormField control={form.control} name="category" render={({ field }) => (<FormItem><FormLabel>Categoria</FormLabel><Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="packageSize" render={({ field }) => (<FormItem>
                                        <div className="flex items-center gap-2">
                                            <FormLabel>Qtd. Embalagem</FormLabel>
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
                                
                                
                                <Separator/>
                                <div className="p-4 border rounded-lg bg-muted/30">
                                    <h4 className="text-md font-medium mb-2">Unidade de medida do insumo base (Opcional)</h4>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Use esta seção se o estoque geral (produto base) for controlado por uma unidade diferente da do insumo. Ex: um insumo em "unidades" controlado por "peso" no estoque geral.
                                    </p>
                                    <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="secondaryUnitValue" render={({ field }) => (<FormItem><FormLabel>Fator da unidade</FormLabel><FormControl><Input type="number" step="any" placeholder="ex: 12" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            <FormField control={form.control} name="secondaryUnit" render={({ field }) => (<FormItem><FormLabel>Unidade de medida</FormLabel><Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                            <SelectContent>
                                                {getUnitsForCategory(secondaryUnitCategory).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                            </SelectContent>
                                            </Select><FormMessage /></FormItem>)}/>
                                    </div>
                                </div>
                                
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
            {isPhotoModalOpen && <PhotoCaptureModal open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen} onPhotoCaptured={handlePhotoCaptured} />}
        </>
    );
}
