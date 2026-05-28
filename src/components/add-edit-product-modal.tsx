
"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import dynamic from 'next/dynamic';

import { useProducts } from '@/hooks/use-products';
import { useToast } from '@/hooks/use-toast';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { getUnitsForCategory, units, type UnitCategory, unitCategories, packageTypes, type PackageType } from '@/lib/conversion';
import { type Product, type NutritionalData } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';


import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Camera, Trash2, Upload, Info, Settings, Search, Loader2, FlaskConical, ImageIcon, ZoomIn, Tags, Plus } from 'lucide-react';
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
  operationalCategoryId: z.string().min(1, 'Selecione a categoria do item.'),
  defaultCountingUnit: z.enum(['package', 'base', 'content']).optional(),
  apparelType: z.string().optional(),
  apparelSize: z.string().optional(),
  apparelColor: z.string().optional(),
  apparelFit: z.string().optional(),
  apparelMaterial: z.string().optional(),
  apparelUsage: z.string().optional(),

  // Conditional sections
  enableLogistics: z.boolean().optional(),
  multiplo_caixa: z.coerce.number().optional(),
  rotulo_caixa: z.string().optional(),
  
  enableCountingInstruction: z.boolean().optional(),
  countingInstruction: z.string().optional(),
  countingInstructionImageUrl: z.string().optional(),

  nutritionalTableImageUrl: z.string().optional(),
  compositionImageUrl: z.string().optional(),
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

function normalizeAlias(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

interface AddEditProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit: Product | null;
  onManageBaseProducts: () => void;
}

export function AddEditProductModal({ open, onOpenChange, productToEdit, onManageBaseProducts }: AddEditProductModalProps) {
    const { addProduct, updateProduct, getProductFullName } = useProducts();
    const { baseProducts } = useBaseProducts();
    const { activeCategories } = useOperationalItemCategories();
    const { toast } = useToast();

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [isInstructionPhotoModalOpen, setIsInstructionPhotoModalOpen] = useState(false);
    const [isNutritionalPhotoModalOpen, setIsNutritionalPhotoModalOpen] = useState(false);
    const [isCompositionPhotoModalOpen, setIsCompositionPhotoModalOpen] = useState(false);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [isFetchingProduct, setIsFetchingProduct] = useState(false);
    const [aliases, setAliases] = useState<string[]>([]);
    const [aliasInput, setAliasInput] = useState('');
    const [aliasesOpen, setAliasesOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const instructionFileInputRef = useRef<HTMLInputElement>(null);
    const nutritionalTableFileInputRef = useRef<HTMLInputElement>(null);
    const compositionFileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productFormSchema),
        defaultValues: {
            baseName: '', brand: '', barcode: '', imageUrl: '',
            packageType: '',
            category: 'Massa', packageSize: undefined, unit: 'g',
            notes: '', baseProductId: '',
            operationalCategoryId: '',
            apparelType: '', apparelSize: '', apparelColor: '', apparelFit: '',
            apparelMaterial: '', apparelUsage: '',
            defaultCountingUnit: 'package',
            enableLogistics: false, multiplo_caixa: undefined, rotulo_caixa: '',
            enableCountingInstruction: false, countingInstruction: '', countingInstructionImageUrl: '',
            nutritionalTableImageUrl: '', compositionImageUrl: '',
        }
    });
    
    const categoryWatch = form.watch('category');
    const enableLogisticsWatch = form.watch('enableLogistics');
    const enableCountingInstructionWatch = form.watch('enableCountingInstruction');
    const baseProductIdWatch = form.watch('baseProductId');
    const isApparel = categoryWatch === 'Vestimenta';

    const handleCategoryChange = (value: UnitCategory) => {
        form.setValue('category', value, { shouldDirty: true, shouldValidate: true });
        form.setValue('unit', getUnitsForCategory(value)[0] || '', { shouldDirty: true, shouldValidate: true });

        if (value === 'Vestimenta') {
            form.setValue('packageType', 'Unidade', { shouldDirty: true, shouldValidate: true });
            form.setValue('packageSize', 1, { shouldDirty: true, shouldValidate: true });
            form.setValue('defaultCountingUnit', 'package', { shouldDirty: true, shouldValidate: true });
            form.setValue('enableLogistics', false, { shouldDirty: true });
        }
    };

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
                    operationalCategoryId: productToEdit.operationalCategoryId || '',
                    apparelType: productToEdit.apparelType || '',
                    apparelSize: productToEdit.apparelSize || '',
                    apparelColor: productToEdit.apparelColor || '',
                    apparelFit: productToEdit.apparelFit || '',
                    apparelMaterial: productToEdit.apparelMaterial || '',
                    apparelUsage: productToEdit.apparelUsage || '',
                    defaultCountingUnit: productToEdit.defaultCountingUnit || 'package',
                    // Switches
                    enableLogistics: !!productToEdit.multiplo_caixa,
                    multiplo_caixa: productToEdit.multiplo_caixa || undefined,
                    rotulo_caixa: productToEdit.rotulo_caixa || '',
                    
                    enableCountingInstruction: !!(productToEdit.countingInstruction || productToEdit.countingInstructionImageUrl),
                    countingInstruction: productToEdit.countingInstruction || '',
                    countingInstructionImageUrl: productToEdit.countingInstructionImageUrl || '',
                    nutritionalTableImageUrl: productToEdit.nutritionalTableImageUrl || '',
                    compositionImageUrl: productToEdit.compositionImageUrl || '',
                });
                setAliases(productToEdit.aliases ?? []);
            } else {
                form.reset({
                    baseName: '', brand: '', barcode: '', imageUrl: '',
                    packageType: '',
                    category: 'Massa', packageSize: undefined, unit: 'g',
                    notes: '', baseProductId: '',
                    operationalCategoryId: '',
                    apparelType: '', apparelSize: '', apparelColor: '', apparelFit: '',
                    apparelMaterial: '', apparelUsage: '',
                    defaultCountingUnit: 'package',
                    enableLogistics: false, multiplo_caixa: undefined, rotulo_caixa: '',
                    enableCountingInstruction: false, countingInstruction: '', countingInstructionImageUrl: '',
                    nutritionalTableImageUrl: '', compositionImageUrl: '',
                });
                setAliases([]);
            }
            setAliasInput('');
            setAliasesOpen(false);
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

    type PhotoTarget = 'main' | 'instruction' | 'nutritionalTable' | 'composition';

    const photoTargetField: Record<PhotoTarget, 'imageUrl' | 'countingInstructionImageUrl' | 'nutritionalTableImageUrl' | 'compositionImageUrl'> = {
        main: 'imageUrl',
        instruction: 'countingInstructionImageUrl',
        nutritionalTable: 'nutritionalTableImageUrl',
        composition: 'compositionImageUrl',
    };

    const handlePhotoCaptured = async (dataUrl: string, target: PhotoTarget) => {
        form.setValue(photoTargetField[target], dataUrl, { shouldValidate: true, shouldDirty: true });
        toast({ title: "Foto capturada com sucesso!" });
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, target: PhotoTarget) => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Por favor, selecione um arquivo de imagem menor que 5MB.' });
                return;
            }
            const reader = new FileReader();
            reader.onloadend = async () => {
                const dataUrl = reader.result as string;
                form.setValue(photoTargetField[target], dataUrl, { shouldValidate: true, shouldDirty: true });
            };
            reader.readAsDataURL(file);
        }
    };

    const onSubmit = (values: ProductFormValues) => {


        const productData: Omit<Product, 'id'> = {
            operationalCategoryId: values.operationalCategoryId,
            operationalCategoryName: activeCategories.find((category) => category.id === values.operationalCategoryId)?.name,
            operationalDestination: activeCategories.find((category) => category.id === values.operationalCategoryId)?.destination,
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
            apparelType: values.category === 'Vestimenta' ? values.apparelType : undefined,
            apparelSize: values.category === 'Vestimenta' ? values.apparelSize : undefined,
            apparelColor: values.category === 'Vestimenta' ? values.apparelColor : undefined,
            apparelFit: values.category === 'Vestimenta' ? values.apparelFit : undefined,
            apparelMaterial: values.category === 'Vestimenta' ? values.apparelMaterial : undefined,
            apparelUsage: values.category === 'Vestimenta' ? values.apparelUsage : undefined,

            multiplo_caixa: values.enableLogistics ? values.multiplo_caixa : undefined,
            rotulo_caixa: values.enableLogistics ? values.rotulo_caixa : undefined,

            countingInstruction: values.enableCountingInstruction ? values.countingInstruction : undefined,
            countingInstructionImageUrl: values.enableCountingInstruction ? values.countingInstructionImageUrl : undefined,

            nutritionalTableImageUrl: values.nutritionalTableImageUrl || undefined,
            compositionImageUrl: values.compositionImageUrl || undefined,
            nutritionalData: productToEdit?.nutritionalData,
            compositionText: productToEdit?.compositionText,
            detectedAllergens: productToEdit?.detectedAllergens,
            aliases: aliases.length > 0 ? aliases : undefined,
        };

        if (productToEdit) {
            updateProduct({ ...productToEdit, ...productData });
        } else {
            addProduct(productData);
        }
        onOpenChange(false);
    };
    
    // Auto-fill category from base product when linked
    useEffect(() => {
        if (!baseProductIdWatch) return;
        const baseProduct = baseProducts.find(bp => bp.id === baseProductIdWatch);
        if (!baseProduct) return;
        if (baseProduct.category !== form.getValues('category')) {
            handleCategoryChange(baseProduct.category);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseProductIdWatch, baseProducts]);

    const handleAddAlias = () => {
        const nextAlias = aliasInput.trim();
        if (!nextAlias) return;
        const normalized = normalizeAlias(nextAlias);
        const conflictsWithName = normalizeAlias(form.getValues('baseName')) === normalized;
        const alreadyExists = aliases.some((alias) => normalizeAlias(alias) === normalized);
        if (conflictsWithName || alreadyExists) {
            setAliasInput('');
            return;
        }
        setAliases((current) => [...current, nextAlias]);
        setAliasInput('');
    };

    const handleRemoveAlias = (aliasToRemove: string) => {
        setAliases((current) => current.filter((alias) => normalizeAlias(alias) !== normalizeAlias(aliasToRemove)));
    };

    const renderLinkageCard = () => (
        <Card className="p-4 bg-violet-100 dark:bg-violet-900/20">
            <h3 className="font-medium mb-4">Vínculo</h3>
            <FormField control={form.control} name="operationalCategoryId" render={({ field }) => (
                <FormItem className="mb-4">
                    <FormLabel>Categoria do item</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                            <SelectTrigger><SelectValue placeholder="Selecione a categoria do item..."/></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {activeCategories
                                .filter((category) => category.destination !== 'asset')
                                .map((category) => (
                                    <SelectItem key={category.id} value={category.id}>
                                        {category.name}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                    <FormDescription>
                        Esta categoria define como o item será tratado nas compras e no recebimento.
                    </FormDescription>
                    <FormMessage />
                </FormItem>
            )}/>
            {activeCategories.length === 0 && (
                <Alert className="mb-4">
                    <AlertTitle>Cadastre categorias operacionais</AlertTitle>
                    <AlertDescription>
                        As categorias padrão são Insumo, Material de limpeza, Vestimenta e Patrimônio.
                    </AlertDescription>
                </Alert>
            )}
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
            
        </Card>
    );

    const renderNotesCard = () => (
        <Card className="p-4 bg-muted/40">
            <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                    <FormLabel>Observações</FormLabel>
                    <FormControl>
                        <Textarea placeholder="Insira observações (opcional)" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}/>
        </Card>
    );


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
                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/70 p-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium">Aliases de compra</p>
                                            <p className="text-xs text-muted-foreground">
                                                {aliases.length > 0
                                                    ? `${aliases.length} alias${aliases.length === 1 ? '' : 'es'} vinculado${aliases.length === 1 ? '' : 's'} a este insumo.`
                                                    : 'Nenhum alias cadastrado.'}
                                            </p>
                                        </div>
                                        <Popover open={aliasesOpen} onOpenChange={setAliasesOpen}>
                                            <PopoverTrigger asChild>
                                                <Button type="button" variant="outline" size="sm">
                                                    <Tags className="mr-2 h-4 w-4" />
                                                    Gerenciar aliases
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent align="end" className="w-80 space-y-3">
                                                <div>
                                                    <p className="text-sm font-medium">Aliases deste insumo</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Nomes vindos de pedidos que devem apontar para este cadastro.
                                                    </p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Input
                                                        placeholder="Ex: TUBITOS 750G POTE C/50UN"
                                                        value={aliasInput}
                                                        onChange={(event) => setAliasInput(event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                handleAddAlias();
                                                            }
                                                        }}
                                                    />
                                                    <Button type="button" size="icon" onClick={handleAddAlias}>
                                                        <Plus className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <div className="max-h-48 space-y-2 overflow-y-auto">
                                                    {aliases.length === 0 ? (
                                                        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                                                            Nenhum alias salvo.
                                                        </p>
                                                    ) : (
                                                        aliases.map((alias) => (
                                                            <div key={alias} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                                                                <span className="min-w-0 flex-1 truncate text-sm">{alias}</span>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                                                    onClick={() => handleRemoveAlias(alias)}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </PopoverContent>
                                        </Popover>
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

                                {renderLinkageCard()}
                                
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
                                        <FormField control={form.control} name="category" render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Categoria</FormLabel>
                                            {baseProductIdWatch ? (
                                              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground gap-1.5">
                                                <span>{field.value}</span>
                                                <span className="text-xs opacity-60">· herdado do insumo base</span>
                                              </div>
                                            ) : (
                                              <Select onValueChange={(value) => handleCategoryChange(value as UnitCategory)} value={field.value}>
                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                                              </Select>
                                            )}
                                            <FormMessage />
                                          </FormItem>
                                        )}/>
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

                                {isApparel && (
                                  <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700">
                                    <p className="text-sm font-semibold mb-3">Atributos do item</p>
                                    <div className="grid grid-cols-2 gap-3">
                                      <FormField control={form.control} name="apparelSize" render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Tamanho</FormLabel>
                                          <Select value={field.value ?? ''} onValueChange={field.onChange}>
                                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                            <SelectContent>
                                              {['PP','P','M','G','GG','XGG','Único'].map(s => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </FormItem>
                                      )} />
                                      <FormField control={form.control} name="apparelColor" render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Cor</FormLabel>
                                          <FormControl><Input placeholder="Ex: Preto" {...field} value={field.value ?? ''} /></FormControl>
                                        </FormItem>
                                      )} />
                                      <FormField control={form.control} name="apparelType" render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Modelo</FormLabel>
                                          <FormControl><Input placeholder="Ex: Camiseta, Avental" {...field} value={field.value ?? ''} /></FormControl>
                                        </FormItem>
                                      )} />
                                      <FormField control={form.control} name="apparelMaterial" render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Tecido / material</FormLabel>
                                          <FormControl><Input placeholder="Ex: Algodão, Poliéster" {...field} value={field.value ?? ''} /></FormControl>
                                        </FormItem>
                                      )} />
                                      <FormField control={form.control} name="apparelUsage" render={({ field }) => (
                                        <FormItem className="col-span-2">
                                          <FormLabel>Uso</FormLabel>
                                          <FormControl><Input placeholder="Ex: Cozinha, Atendimento, EPI" {...field} value={field.value ?? ''} /></FormControl>
                                        </FormItem>
                                      )} />
                                    </div>
                                  </Card>
                                )}

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
                                
                                <Card className="p-4 bg-emerald-50 dark:bg-emerald-900/20">
                                    <div className="flex items-center gap-2 mb-1">
                                        <FlaskConical className="h-4 w-4 text-emerald-600" />
                                        <h3 className="font-medium text-emerald-900 dark:text-emerald-100">Tabela Nutricional e Composição</h3>
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-4">Fotografe a embalagem. Os dados serão transcritos pelo assistente quando solicitado.</p>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* Nutritional Table Photo */}
                                        <div className="space-y-2">
                                            <FormLabel className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Foto — Tabela Nutricional</FormLabel>
                                            <div className="flex items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => form.watch('nutritionalTableImageUrl') ? setZoomedImage(form.watch('nutritionalTableImageUrl')!) : undefined}
                                                    className="w-20 h-20 rounded-md bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0 border border-emerald-200 focus:outline-none"
                                                >
                                                    {form.watch('nutritionalTableImageUrl') ? (
                                                        <div className="relative w-full h-full group">
                                                            <Image src={form.watch('nutritionalTableImageUrl')!} alt="Tabela Nutricional" width={80} height={80} className="object-cover w-full h-full" />
                                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <ZoomIn className="h-5 w-5 text-white" />
                                                            </div>
                                                        </div>
                                                    ) : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                                                </button>
                                                <div className="flex flex-col gap-1.5">
                                                    <Button type="button" variant="outline" size="sm" onClick={() => setIsNutritionalPhotoModalOpen(true)}><Camera className="mr-1.5 h-3.5 w-3.5" /> Câmera</Button>
                                                    <Button type="button" variant="outline" size="sm" onClick={() => nutritionalTableFileInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" /> Upload</Button>
                                                    {form.watch('nutritionalTableImageUrl') && (
                                                        <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-600 px-2" onClick={() => form.setValue('nutritionalTableImageUrl', '', { shouldDirty: true })}>
                                                            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            <Input type="file" ref={nutritionalTableFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'nutritionalTable')} />
                                            <FormField control={form.control} name="nutritionalTableImageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)}/>
                                        </div>

                                        {/* Composition Photo */}
                                        <div className="space-y-2">
                                            <FormLabel className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Foto — Composição / Ingredientes</FormLabel>
                                            <div className="flex items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => form.watch('compositionImageUrl') ? setZoomedImage(form.watch('compositionImageUrl')!) : undefined}
                                                    className="w-20 h-20 rounded-md bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0 border border-emerald-200 focus:outline-none"
                                                >
                                                    {form.watch('compositionImageUrl') ? (
                                                        <div className="relative w-full h-full group">
                                                            <Image src={form.watch('compositionImageUrl')!} alt="Composição" width={80} height={80} className="object-cover w-full h-full" />
                                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <ZoomIn className="h-5 w-5 text-white" />
                                                            </div>
                                                        </div>
                                                    ) : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                                                </button>
                                                <div className="flex flex-col gap-1.5">
                                                    <Button type="button" variant="outline" size="sm" onClick={() => setIsCompositionPhotoModalOpen(true)}><Camera className="mr-1.5 h-3.5 w-3.5" /> Câmera</Button>
                                                    <Button type="button" variant="outline" size="sm" onClick={() => compositionFileInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" /> Upload</Button>
                                                    {form.watch('compositionImageUrl') && (
                                                        <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-600 px-2" onClick={() => form.setValue('compositionImageUrl', '', { shouldDirty: true })}>
                                                            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            <Input type="file" ref={compositionFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'composition')} />
                                            <FormField control={form.control} name="compositionImageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)}/>
                                        </div>
                                    </div>

                                    {/* Read-only display of transcribed nutritional data */}
                                    {productToEdit?.nutritionalData ? (
                                        <div className="mt-4 pt-4 border-t border-emerald-200 space-y-3">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Dados Transcritos</p>
                                            <div className="bg-white rounded-lg border border-emerald-100 overflow-hidden">
                                                <div className="px-3 py-2 bg-emerald-600 text-white">
                                                    <p className="text-xs font-bold">INFORMAÇÃO NUTRICIONAL</p>
                                                    <p className="text-[10px] text-emerald-100">Porção: {productToEdit.nutritionalData.portionSize}{productToEdit.nutritionalData.portionDescription ? ` (${productToEdit.nutritionalData.portionDescription})` : ''}</p>
                                                </div>
                                                <div className="divide-y divide-gray-50">
                                                    {productToEdit.nutritionalData.nutrients.map((n, i) => (
                                                        <div key={i} className="flex justify-between items-center px-3 py-1.5">
                                                            <span className="text-xs text-gray-700">{n.name}</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-bold text-gray-900">{n.amount}{n.unit}</span>
                                                                {n.dailyValue && <span className="text-[10px] text-gray-400">{n.dailyValue}</span>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {productToEdit.compositionText && (
                                                <div className="bg-white rounded-lg border border-emerald-100 p-3">
                                                    <p className="text-[10px] font-bold uppercase text-emerald-700 mb-1">Composição</p>
                                                    <p className="text-xs text-gray-600 leading-relaxed">{productToEdit.compositionText}</p>
                                                </div>
                                            )}
                                            {productToEdit.detectedAllergens && productToEdit.detectedAllergens.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {productToEdit.detectedAllergens.map((a, i) => (
                                                        <span key={i} className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold border border-orange-200">{a}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="mt-4 pt-4 border-t border-emerald-200">
                                            <p className="text-xs text-muted-foreground text-center py-2">Dados nutricionais ainda não transcritos — solicite no chat.</p>
                                        </div>
                                    )}
                                </Card>

                                {renderNotesCard()}
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
            {isNutritionalPhotoModalOpen && <PhotoCaptureModal open={isNutritionalPhotoModalOpen} onOpenChange={setIsNutritionalPhotoModalOpen} onPhotoCaptured={(dataUrl) => handlePhotoCaptured(dataUrl, 'nutritionalTable')} />}
            {isCompositionPhotoModalOpen && <PhotoCaptureModal open={isCompositionPhotoModalOpen} onOpenChange={setIsCompositionPhotoModalOpen} onPhotoCaptured={(dataUrl) => handlePhotoCaptured(dataUrl, 'composition')} />}

            {/* Zoom lightbox */}
            {zoomedImage && (
                <Dialog open={!!zoomedImage} onOpenChange={() => setZoomedImage(null)}>
                    <DialogContent className="max-w-3xl p-2 bg-black border-none">
                        <Image src={zoomedImage} alt="Ampliado" width={800} height={1000} className="w-full h-auto object-contain max-h-[85vh] rounded" />
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}

    
