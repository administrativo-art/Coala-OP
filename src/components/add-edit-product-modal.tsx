
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
import { getUnitsForCategory, convertValue, formatQuantity, type UnitCategory, unitCategories, packageTypes, type PackageType } from '@/lib/conversion';
import { type Product } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useClassifications } from '@/hooks/use-classifications';


import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from "@/components/ui/textarea";
import { Camera, Trash2, Upload, Settings, ImageIcon, Plus, FileText, Tag, Package, Check, ChevronLeft, ChevronRight, Link2, ScanLine } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
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
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

interface AddEditProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit: Product | null;
  onManageBaseProducts: () => void;
}

const WIZARD_STEPS = [
    { id: 1, label: 'Identificação', icon: FileText, description: 'Foto, nome, vínculo com o produto base e observações.' },
    { id: 2, label: 'Aliases de compra', icon: Tag, description: 'Nomes que os fornecedores usam para este item nos pedidos e notas. O sistema reconhece esses nomes automaticamente nas compras.' },
    { id: 3, label: 'Detalhes logísticos', icon: Package, description: 'O item físico que você compra. Define a conversão para a unidade do estoque.' },
    { id: 4, label: 'Nutricional', icon: ImageIcon, description: 'Opcional — fotografe a embalagem; o assistente transcreve quando solicitado.' },
] as const;

const APPAREL_SIZE_OPTIONS = ['Tamanho único', 'P', 'M', 'G', 'GG'] as const;

export function AddEditProductModal({ open, onOpenChange, productToEdit, onManageBaseProducts }: AddEditProductModalProps) {
    const { addProduct, updateProduct, getProductFullName } = useProducts();
    const { baseProducts } = useBaseProducts();
    const { classifications } = useClassifications();
    const { activeCategories } = useOperationalItemCategories();
    const { toast } = useToast();

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [isInstructionPhotoModalOpen, setIsInstructionPhotoModalOpen] = useState(false);
    const [isNutritionalPhotoModalOpen, setIsNutritionalPhotoModalOpen] = useState(false);
    const [isCompositionPhotoModalOpen, setIsCompositionPhotoModalOpen] = useState(false);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [aliases, setAliases] = useState<string[]>([]);
    const [aliasInput, setAliasInput] = useState('');
    const [currentStep, setCurrentStep] = useState(1);
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

    const groupedBaseProducts = useMemo(() => {
        const classMap = new Map(classifications.map(c => [c.id, c.name]));
        const groups: Record<string, typeof baseProducts> = {};
        for (const bp of baseProducts) {
            const label = bp.classification
                ? (classMap.get(bp.classification) ?? 'Outros')
                : 'Sem classificação';
            if (!groups[label]) groups[label] = [];
            groups[label].push(bp);
        }
        for (const key of Object.keys(groups)) {
            groups[key].sort((a, b) => a.name.localeCompare(b.name));
        }
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [baseProducts, classifications]);

    const categoryWatch = form.watch('category');
    const enableLogisticsWatch = form.watch('enableLogistics');
    const enableCountingInstructionWatch = form.watch('enableCountingInstruction');
    const baseProductIdWatch = form.watch('baseProductId');
    const operationalCategoryIdWatch = form.watch('operationalCategoryId');
    const packageTypeWatch = form.watch('packageType');
    const packageSizeWatch = form.watch('packageSize');
    const unitWatch = form.watch('unit');
    const logisticsMultipleWatch = form.watch('multiplo_caixa');
    const logisticsLabelWatch = form.watch('rotulo_caixa');
    const logisticsLabelDisplay =
        packageTypeWatch === 'Caixa' && logisticsLabelWatch === 'Caixa'
            ? 'Caixa mestra'
            : logisticsLabelWatch;
    const countingUnitWatch = form.watch('defaultCountingUnit') || 'package';
    const selectedOperationalCategory = useMemo(
        () => activeCategories.find((category) => category.id === operationalCategoryIdWatch),
        [activeCategories, operationalCategoryIdWatch],
    );
    const isApparel = categoryWatch === 'Vestimenta' || selectedOperationalCategory?.destination === 'uniform';
    const showNutritionStep = selectedOperationalCategory?.slug === 'insumo' || selectedOperationalCategory?.id === 'insumo';
    const wizardSteps = useMemo(
        () => showNutritionStep ? [...WIZARD_STEPS] : WIZARD_STEPS.filter((step) => step.id !== 4),
        [showNutritionStep],
    );
    const currentStepMeta = wizardSteps.find((step) => step.id === currentStep) ?? wizardSteps[0];
    const currentStepPosition = Math.max(0, wizardSteps.findIndex((step) => step.id === currentStep));

    const linkedBaseProduct = useMemo(
        () => baseProducts.find((bp) => bp.id === baseProductIdWatch),
        [baseProducts, baseProductIdWatch],
    );
    const operationalCategoryName = useMemo(
        () => activeCategories.find((c) => c.id === operationalCategoryIdWatch)?.name,
        [activeCategories, operationalCategoryIdWatch],
    );

    // Conversão da embalagem para a unidade do produto base (linha "1 Pacote = ...").
    const baseConversion = useMemo(() => {
        if (!linkedBaseProduct || !packageSizeWatch || !unitWatch) return null;
        try {
            const converted = convertValue(Number(packageSizeWatch), unitWatch, linkedBaseProduct.unit, categoryWatch);
            if (!isFinite(converted) || converted <= 0) return null;
            return `${formatQuantity(converted, linkedBaseProduct.unit)}`;
        } catch {
            return null;
        }
    }, [linkedBaseProduct, packageSizeWatch, unitWatch, categoryWatch]);

    const handleCategoryChange = (value: UnitCategory) => {
        form.setValue('category', value, { shouldDirty: true, shouldValidate: true });
        form.setValue('unit', getUnitsForCategory(value)[0] || '', { shouldDirty: true, shouldValidate: true });

        if (value === 'Vestimenta') {
            form.setValue('packageType', 'Unidade', { shouldDirty: true, shouldValidate: true });
            form.setValue('packageSize', 1, { shouldDirty: true, shouldValidate: true });
            form.setValue('defaultCountingUnit', 'package', { shouldDirty: true, shouldValidate: true });
            form.setValue('apparelSize', form.getValues('apparelSize') || 'Tamanho único', { shouldDirty: true });
            form.setValue('enableLogistics', false, { shouldDirty: true });
        }
    };

    const handleOperationalCategoryChange = (value: string, onChange: (value: string) => void) => {
        onChange(value);
        const selectedCategory = activeCategories.find((category) => category.id === value);
        if (selectedCategory?.destination === 'uniform') {
            handleCategoryChange('Vestimenta');
        }
    };

    useEffect(() => {
        if (!wizardSteps.some((step) => step.id === currentStep)) {
            setCurrentStep(wizardSteps[wizardSteps.length - 1]?.id ?? 1);
        }
    }, [currentStep, wizardSteps]);

    useEffect(() => {
        if (open) {
            setCurrentStep(1);
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
                    apparelSize: productToEdit.apparelSize === 'Único' ? 'Tamanho único' : productToEdit.apparelSize || '',
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

    /** Redimensiona e comprime um data URL para caber no limite do Firestore (1MB/doc). */
    const compressImage = (dataUrl: string, maxSide = 800, quality = 0.82): Promise<string> =>
        new Promise((resolve) => {
            const img = new window.Image();
            img.onload = () => {
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width  = Math.round(img.width  * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = dataUrl;
        });

    type PhotoTarget = 'main' | 'instruction' | 'nutritionalTable' | 'composition';

    const photoTargetField: Record<PhotoTarget, 'imageUrl' | 'countingInstructionImageUrl' | 'nutritionalTableImageUrl' | 'compositionImageUrl'> = {
        main: 'imageUrl',
        instruction: 'countingInstructionImageUrl',
        nutritionalTable: 'nutritionalTableImageUrl',
        composition: 'compositionImageUrl',
    };

    const handlePhotoCaptured = async (dataUrl: string, target: PhotoTarget) => {
        const compressed = await compressImage(dataUrl);
        form.setValue(photoTargetField[target], compressed, { shouldValidate: true, shouldDirty: true });
        toast({ title: "Foto capturada com sucesso!" });
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, target: PhotoTarget) => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) {
                toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Por favor, selecione um arquivo de imagem menor que 10MB.' });
                return;
            }
            const reader = new FileReader();
            reader.onloadend = async () => {
                const dataUrl = reader.result as string;
                const compressed = await compressImage(dataUrl);
                form.setValue(photoTargetField[target], compressed, { shouldValidate: true, shouldDirty: true });
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
            apparelType: isApparel ? values.apparelType : undefined,
            apparelSize: isApparel ? values.apparelSize : undefined,
            apparelColor: isApparel ? values.apparelColor : undefined,
            apparelFit: isApparel ? values.apparelFit : undefined,
            apparelMaterial: isApparel ? values.apparelMaterial : undefined,
            apparelUsage: isApparel ? values.apparelUsage : undefined,

            multiplo_caixa: values.enableLogistics ? values.multiplo_caixa : undefined,
            rotulo_caixa: values.enableLogistics ? values.rotulo_caixa : undefined,

            countingInstruction: values.enableCountingInstruction ? values.countingInstruction : undefined,
            countingInstructionImageUrl: values.enableCountingInstruction ? values.countingInstructionImageUrl : undefined,

            nutritionalTableImageUrl: showNutritionStep ? values.nutritionalTableImageUrl || undefined : undefined,
            compositionImageUrl: showNutritionStep ? values.compositionImageUrl || undefined : undefined,
            nutritionalData: showNutritionStep ? productToEdit?.nutritionalData : undefined,
            compositionText: showNutritionStep ? productToEdit?.compositionText : undefined,
            detectedAllergens: showNutritionStep ? productToEdit?.detectedAllergens : undefined,
            aliases: aliases.length > 0 ? aliases : undefined,
        };

        if (productToEdit) {
            updateProduct({ ...productToEdit, ...productData });
        } else {
            addProduct(productData);
        }
        onOpenChange(false);
    };

    const fieldStep: Partial<Record<keyof ProductFormValues, number>> = {
        baseName: 1, operationalCategoryId: 1,
        packageType: 3, category: 3, packageSize: 3, unit: 3, multiplo_caixa: 3, rotulo_caixa: 3, countingInstruction: 3,
    };

    const onInvalid = (errors: Record<string, unknown>) => {
        const steps = Object.keys(errors).map((key) => fieldStep[key as keyof ProductFormValues] ?? 1);
        const firstStep = steps.length > 0 ? Math.min(...steps) : 1;
        setCurrentStep(firstStep);
        toast({ variant: 'destructive', title: 'Campos obrigatórios não preenchidos', description: 'Verifique os campos destacados em vermelho.' });
    };

    const stepFields: Record<number, (keyof ProductFormValues)[]> = {
        1: ['baseName', 'operationalCategoryId'],
        2: [],
        3: ['packageType', 'category', 'packageSize', 'unit',
            ...(enableLogisticsWatch ? (['multiplo_caixa', 'rotulo_caixa'] as (keyof ProductFormValues)[]) : []),
            ...(enableCountingInstructionWatch ? (['countingInstruction'] as (keyof ProductFormValues)[]) : [])],
        4: [],
    };

    const handleNext = async () => {
        const valid = await form.trigger(stepFields[currentStep]);
        if (valid) {
            const currentIndex = wizardSteps.findIndex((step) => step.id === currentStep);
            const nextStep = wizardSteps[currentIndex + 1];
            if (nextStep) setCurrentStep(nextStep.id);
        }
    };
    const handleBack = () => {
        const currentIndex = wizardSteps.findIndex((step) => step.id === currentStep);
        const previousStep = wizardSteps[currentIndex - 1];
        if (previousStep) setCurrentStep(previousStep.id);
    };

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

    const countingOptions = [
        { value: 'package' as const, title: 'Unidade do Lote', desc: `Conta embalagens físicas${packageTypeWatch ? ` (${packageTypeWatch.toLowerCase()}s)` : ''}` },
        { value: 'base' as const, title: 'Unid. do Produto Base', desc: linkedBaseProduct ? `Conta na base (${linkedBaseProduct.unit})` : 'Conta na unidade do produto base' },
        { value: 'content' as const, title: 'Unid. do Conteúdo', desc: `Mede o conteúdo (${unitWatch || 'un'} restantes)` },
    ];

    const editingTitle = productToEdit
        ? `Editar insumo${linkedBaseProduct ? ' derivado' : ''}`
        : 'Adicionar novo insumo';
    const subtitle = productToEdit ? getProductFullName(productToEdit) : 'Preencha os detalhes do insumo nas etapas abaixo.';

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="w-[95vw] sm:max-w-5xl p-0 gap-0 overflow-hidden">
                    {/* Header */}
                    <DialogHeader className="space-y-2 border-b px-6 py-4 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                            {categoryWatch && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    {categoryWatch}
                                </span>
                            )}
                            {operationalCategoryName && (
                                <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-700">
                                    {operationalCategoryName}
                                </span>
                            )}
                            {linkedBaseProduct && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                                    <Link2 className="h-3 w-3" />
                                    {linkedBaseProduct.name}
                                </span>
                            )}
                        </div>
                        <DialogTitle className="text-2xl font-bold">{editingTitle}</DialogTitle>
                        <DialogDescription className="text-sm">{subtitle}</DialogDescription>
                    </DialogHeader>

                    <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
                        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
                            {/* Stepper sidebar */}
                            <aside className="border-r bg-muted/40 px-5 py-6">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStepPosition + 1} de {wizardSteps.length}</p>
                                <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${((currentStepPosition + 1) / wizardSteps.length) * 100}%` }} />
                                </div>
                                <nav className="space-y-1">
                                    {wizardSteps.map((step, index) => {
                                        const isActive = step.id === currentStep;
                                        const isDone = index < currentStepPosition;
                                        return (
                                            <button
                                                key={step.id}
                                                type="button"
                                                onClick={() => setCurrentStep(step.id)}
                                                className={cn(
                                                    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                                                    isActive ? 'font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted',
                                                )}
                                            >
                                                <span className={cn(
                                                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                                                    isActive ? 'bg-indigo-500 text-white' : isDone ? 'bg-indigo-100 text-indigo-600' : 'bg-muted text-muted-foreground',
                                                )}>
                                                    {isDone ? <Check className="h-4 w-4" /> : step.id}
                                                </span>
                                                <span className="truncate">{step.label}</span>
                                            </button>
                                        );
                                    })}
                                </nav>
                            </aside>

                            {/* Step content */}
                            <ScrollArea className="h-[62vh]">
                                <div className="px-6 py-6">
                                    {/* Section header */}
                                    <div className="mb-5 flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-foreground">
                                                {React.createElement(currentStepMeta.icon, { className: 'h-4 w-4' })}
                                            </div>
                                            <div>
                                                <h3 className="font-semibold leading-tight">{currentStepMeta.label}</h3>
                                                <p className="text-sm text-muted-foreground">{currentStepMeta.description}</p>
                                            </div>
                                        </div>
                                        {currentStep === 1 && linkedBaseProduct && (
                                            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                                <Link2 className="h-3 w-3" /> base vinculada
                                            </span>
                                        )}
                                    </div>

                                    {/* ===== STEP 1 — Identificação ===== */}
                                    {currentStep === 1 && (
                                        <div className="space-y-5">
                                            <div className="space-y-2">
                                                <FormLabel>Foto do insumo</FormLabel>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md bg-secondary">
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

                                            <Separator />

                                            <FormField control={form.control} name="baseName" render={({ field }) => (<FormItem><FormLabel>Nome do insumo <span className="text-rose-500">*</span></FormLabel><FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl><FormMessage /></FormItem>)}/>

                                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                <FormField control={form.control} name="brand" render={({ field }) => (<FormItem><FormLabel>Marca</FormLabel><FormControl><Input placeholder="ex: Nestlé" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="barcode" render={({ field }) => (
                                                    <FormItem>
                                                        <div className="flex items-center justify-between">
                                                            <FormLabel>Código de barras</FormLabel>
                                                            <span className="text-xs text-muted-foreground">EAN-13 / GTIN</span>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <FormControl><Input placeholder="Escanear ou digitar" {...field} value={field.value ?? ''} /></FormControl>
                                                            <Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><ScanLine className="h-4 w-4" /></Button>
                                                        </div>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}/>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                <FormField control={form.control} name="operationalCategoryId" render={({ field }) => (
                                                    <FormItem>
                                                        <div className="flex items-center justify-between">
                                                            <FormLabel>Categoria do item <span className="text-rose-500">*</span></FormLabel>
                                                            <span className="text-xs text-muted-foreground">define o fluxo de compra</span>
                                                        </div>
                                                        <Select onValueChange={(value) => handleOperationalCategoryChange(value, field.onChange)} value={field.value}>
                                                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione a categoria do item..."/></SelectTrigger></FormControl>
                                                            <SelectContent>
                                                                {activeCategories.filter((category) => category.destination !== 'asset').map((category) => (
                                                                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}/>
                                                <FormField control={form.control} name="baseProductId" render={({ field }) => (
                                                    <FormItem>
                                                        <div className="flex items-center justify-between">
                                                            <FormLabel>Insumo base</FormLabel>
                                                            <span className="text-xs text-muted-foreground">agrupa e converte o estoque</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Select onValueChange={(value) => field.onChange(value || '')} value={field.value || ''}>
                                                                <FormControl><SelectTrigger><SelectValue placeholder="Selecione para agrupar..."/></SelectTrigger></FormControl>
                                                                <SelectContent>
                                                                    {groupedBaseProducts.map(([groupName, items]) => (
                                                                        <SelectGroup key={groupName}>
                                                                            <SelectLabel>{groupName}</SelectLabel>
                                                                            {items.map(ap => (<SelectItem key={ap.id} value={ap.id}>{ap.name}</SelectItem>))}
                                                                        </SelectGroup>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            <Button type="button" variant="outline" size="icon" onClick={onManageBaseProducts}><Settings className="h-4 w-4"/></Button>
                                                        </div>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}/>
                                            </div>

                                            {activeCategories.length === 0 && (
                                                <Alert>
                                                    <AlertTitle>Cadastre categorias operacionais</AlertTitle>
                                                    <AlertDescription>As categorias padrão são Insumo, Material de limpeza, Vestimenta e Patrimônio.</AlertDescription>
                                                </Alert>
                                            )}

                                            <FormField control={form.control} name="notes" render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel>Observações</FormLabel>
                                                        <span className="text-xs text-muted-foreground">opcional</span>
                                                    </div>
                                                    <FormControl><Textarea placeholder="Insira observações (opcional)" {...field} value={field.value ?? ''} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>
                                        </div>
                                    )}

                                    {/* ===== STEP 2 — Aliases de compra ===== */}
                                    {currentStep === 2 && (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                                    {aliases.length} alias{aliases.length === 1 ? '' : 'es'}
                                                </span>
                                            </div>

                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="Ex: BISC RECH OREO 144G C/4"
                                                    value={aliasInput}
                                                    onChange={(event) => setAliasInput(event.target.value)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') { event.preventDefault(); handleAddAlias(); }
                                                    }}
                                                />
                                                <Button type="button" className="bg-indigo-500 hover:bg-indigo-600" onClick={handleAddAlias}>
                                                    <Plus className="mr-1.5 h-4 w-4" /> Adicionar
                                                </Button>
                                            </div>

                                            <div className="space-y-2">
                                                {aliases.length === 0 ? (
                                                    <p className="rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
                                                        Nenhum alias cadastrado. Adicione os nomes que os fornecedores usam para este item.
                                                    </p>
                                                ) : (
                                                    aliases.map((alias) => (
                                                        <div key={alias} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5">
                                                            <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{alias}</span>
                                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleRemoveAlias(alias)}>
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            {/* Card educativo: como o alias age numa importação */}
                                            <div className="rounded-xl bg-zinc-900 p-4 text-zinc-100">
                                                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Como o alias age numa importação de pedido</p>
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                                    <div className="flex-1 rounded-lg bg-zinc-800 p-3">
                                                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Linha do pedido · fornecedor</p>
                                                        <p className="mt-1 font-mono text-xs">OREO BISC ORIG RECH 144G</p>
                                                    </div>
                                                    <div className="flex items-center justify-center">
                                                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">match</span>
                                                    </div>
                                                    <div className="flex-1 rounded-lg bg-zinc-800 p-3">
                                                        <p className="text-[10px] uppercase tracking-wide text-emerald-400">reconhecido</p>
                                                        <p className="mt-1 text-xs font-medium">{productToEdit ? getProductFullName(productToEdit) : 'Este insumo'}</p>
                                                    </div>
                                                </div>
                                                <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                                                    Sem o alias, esta linha cairia em &quot;não reconhecido&quot; e exigiria vínculo manual a cada compra. Com o alias salvo, ela entra direto no estoque com custo e conversão corretos.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* ===== STEP 3 — Detalhes logísticos ===== */}
                                    {currentStep === 3 && (
                                        <div className="space-y-5">
                                            <Card className="space-y-4 border-amber-200 bg-amber-50/60 p-4 dark:bg-amber-900/20">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <h4 className="font-medium">Embalagem e conversão</h4>
                                                        <p className="text-sm text-muted-foreground">O item físico que você compra. Define a conversão para a unidade do estoque.</p>
                                                    </div>
                                                    {linkedBaseProduct && baseConversion && (
                                                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                                            <Check className="h-3 w-3" /> compatível com a base
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                                                    <FormField control={form.control} name="packageType" render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="flex min-h-10 items-end">Tipo de embalagem <span className="text-rose-500">*</span></FormLabel>
                                                            <Select onValueChange={field.onChange} value={field.value}>
                                                                <FormControl><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                                                                <SelectContent>{packageTypes.map((type) => (<SelectItem key={type} value={type}>{type}</SelectItem>))}</SelectContent>
                                                            </Select>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}/>
                                                    <FormField control={form.control} name="category" render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="flex min-h-10 items-end">Categoria da unidade <span className="text-rose-500">*</span></FormLabel>
                                                            <Select onValueChange={(value) => handleCategoryChange(value as UnitCategory)} value={field.value}>
                                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                                <SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                                                            </Select>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}/>
                                                    <FormField control={form.control} name="packageSize" render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="flex min-h-10 items-end">Qtd. embalagem <span className="text-rose-500">*</span></FormLabel>
                                                            <FormControl><Input type="number" step="any" placeholder="ex: 144" {...field} value={field.value ?? ''} /></FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}/>
                                                    <FormField control={form.control} name="unit" render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="flex min-h-10 items-end">Unidade <span className="text-rose-500">*</span></FormLabel>
                                                            <Select onValueChange={field.onChange} value={field.value}>
                                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                                <SelectContent>{getUnitsForCategory(categoryWatch).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                                            </Select>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}/>
                                                </div>
                                                {packageSizeWatch && unitWatch && (
                                                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-background/70 px-3 py-2 text-sm">
                                                        <Settings className="h-4 w-4 text-muted-foreground" />
                                                        <span className="font-medium">1 {packageTypeWatch || 'embalagem'} = {packageSizeWatch} {unitWatch}</span>
                                                        {linkedBaseProduct && baseConversion && (
                                                            <span className="font-semibold text-emerald-600">→ {baseConversion} de {linkedBaseProduct.name}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </Card>

                                            {isApparel && (
                                                <Card className="border-amber-200 bg-amber-50 p-4 dark:bg-amber-900/20">
                                                    <p className="mb-3 text-sm font-semibold">Atributos do item</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <FormField control={form.control} name="apparelSize" render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Tamanho</FormLabel>
                                                                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                                                                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                                                    <SelectContent>{APPAREL_SIZE_OPTIONS.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
                                                                </Select>
                                                            </FormItem>
                                                        )} />
                                                        <FormField control={form.control} name="apparelColor" render={({ field }) => (<FormItem><FormLabel>Cor</FormLabel><FormControl><Input placeholder="Ex: Preto" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                                                        <FormField control={form.control} name="apparelType" render={({ field }) => (<FormItem><FormLabel>Modelo</FormLabel><FormControl><Input placeholder="Ex: Camiseta, Avental" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                                                        <FormField control={form.control} name="apparelMaterial" render={({ field }) => (<FormItem><FormLabel>Tecido / material</FormLabel><FormControl><Input placeholder="Ex: Algodão, Poliéster" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                                                        <FormField control={form.control} name="apparelUsage" render={({ field }) => (<FormItem className="col-span-2"><FormLabel>Uso</FormLabel><FormControl><Input placeholder="Ex: Cozinha, Atendimento, EPI" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                                                    </div>
                                                </Card>
                                            )}

                                            <Card className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <FormLabel className="text-base">Embalagem de agrupamento</FormLabel>
                                                        <FormDescription>
                                                            Use quando o fornecedor agrupa várias embalagens menores em uma caixa, fardo, pallet ou tambor.
                                                        </FormDescription>
                                                    </div>
                                                    <FormField control={form.control} name="enableLogistics" render={({ field }) => (<FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>)} />
                                                </div>
                                                {enableLogisticsWatch ? (
                                                    <div className="mt-4 space-y-4 border-t pt-4">
                                                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                                                            Informe quantas <strong>{packageTypeWatch || 'embalagens menores'}</strong> existem em cada agrupamento.
                                                            Não informe a quantidade de {unitWatch || 'unidades'}.
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                            <FormField control={form.control} name="multiplo_caixa" render={({ field }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        Quantas {packageTypeWatch ? `${packageTypeWatch.toLowerCase()}s` : 'embalagens menores'} por agrupamento?
                                                                    </FormLabel>
                                                                    <FormControl><Input type="number" step="1" placeholder="Ex: 6" {...field} value={field.value ?? ''} /></FormControl>
                                                                    <FormDescription className="text-xs">
                                                                        Exemplo: se uma caixa mestra contém 6 {packageTypeWatch ? `${packageTypeWatch.toLowerCase()}s` : 'embalagens'}, informe 6 — não 1.800 unidades.
                                                                    </FormDescription>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}/>
                                                            <FormField control={form.control} name="rotulo_caixa" render={({ field }) => (
                                                                <FormItem>
                                                                    <FormLabel>Qual é o tipo do agrupamento?</FormLabel>
                                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                                                        <SelectContent>
                                                                            <SelectItem value="Caixa">
                                                                                {packageTypeWatch === 'Caixa' ? 'Caixa mestra' : 'Caixa'}
                                                                            </SelectItem>
                                                                            <SelectItem value="Fardo">Fardo</SelectItem>
                                                                            <SelectItem value="Pallet">Pallet</SelectItem>
                                                                            <SelectItem value="Tambor">Tambor</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <FormDescription className="text-xs">
                                                                        Selecione como o fornecedor chama a embalagem externa.
                                                                    </FormDescription>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}/>
                                                        </div>
                                                        {logisticsMultipleWatch && logisticsMultipleWatch > 0 && logisticsLabelWatch && (
                                                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                                                                <strong>Conversão:</strong> 1 {logisticsLabelDisplay} = {logisticsMultipleWatch}{' '}
                                                                {packageTypeWatch ? `${packageTypeWatch}(s)` : 'embalagens menores'}
                                                                {packageSizeWatch && unitWatch
                                                                    ? ` = ${Number(logisticsMultipleWatch) * Number(packageSizeWatch)} ${unitWatch}`
                                                                    : ''}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <p className="mt-3 text-xs text-muted-foreground">Desligado — este insumo é comprado por {packageTypeWatch ? packageTypeWatch.toLowerCase() : 'unidade'} avulso.</p>
                                                )}
                                            </Card>

                                            <Card className="space-y-3 border-emerald-200 bg-emerald-50/60 p-4 dark:bg-emerald-900/20">
                                                <div>
                                                    <h4 className="font-medium">Contagem de estoque</h4>
                                                    <p className="text-sm text-muted-foreground">Como este insumo é exibido e contado no inventário físico.</p>
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                    {countingOptions.map((opt) => {
                                                        const selected = countingUnitWatch === opt.value;
                                                        return (
                                                            <button
                                                                key={opt.value}
                                                                type="button"
                                                                onClick={() => form.setValue('defaultCountingUnit', opt.value, { shouldDirty: true })}
                                                                className={cn(
                                                                    'flex flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left transition-colors',
                                                                    selected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'hover:border-muted-foreground/40',
                                                                )}
                                                            >
                                                                <span className="flex items-center gap-2 text-sm font-semibold">
                                                                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', selected ? 'border-indigo-500 bg-indigo-500' : 'border-muted-foreground/40')}>
                                                                        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                                                                    </span>
                                                                    {opt.title}
                                                                </span>
                                                                <span className="text-xs text-muted-foreground">{opt.desc}</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                <div className="flex items-center justify-between border-t border-emerald-200 pt-3">
                                                    <div className="space-y-0.5">
                                                        <FormLabel className="text-sm">Instrução de contagem</FormLabel>
                                                        <FormDescription>Adicione um texto ou imagem para guiar a contagem.</FormDescription>
                                                    </div>
                                                    <FormField control={form.control} name="enableCountingInstruction" render={({ field }) => (<FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>)}/>
                                                </div>
                                                {enableCountingInstructionWatch && (
                                                    <div className="space-y-4 border-t border-emerald-200 pt-4">
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
                                                                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md bg-secondary">
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
                                        </div>
                                    )}

                                    {/* ===== STEP 4 — Nutricional ===== */}
                                    {currentStep === 4 && (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                {/* Tabela nutricional */}
                                                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => form.watch('nutritionalTableImageUrl') ? setZoomedImage(form.watch('nutritionalTableImageUrl')!) : setIsNutritionalPhotoModalOpen(true)}
                                                        className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-secondary focus:outline-none"
                                                    >
                                                        {form.watch('nutritionalTableImageUrl') ? <Image src={form.watch('nutritionalTableImageUrl')!} alt="Tabela Nutricional" width={64} height={64} className="h-full w-full object-cover" /> : <Camera className="h-7 w-7 text-muted-foreground" />}
                                                    </button>
                                                    <div>
                                                        <p className="text-sm font-semibold">Tabela nutricional</p>
                                                        <p className="text-xs text-muted-foreground">Câmera ou upload</p>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Button type="button" variant="outline" size="sm" onClick={() => setIsNutritionalPhotoModalOpen(true)}><Camera className="mr-1.5 h-3.5 w-3.5" /> Câmera</Button>
                                                        <Button type="button" variant="outline" size="sm" onClick={() => nutritionalTableFileInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" /> Upload</Button>
                                                        {form.watch('nutritionalTableImageUrl') && <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => form.setValue('nutritionalTableImageUrl', '', { shouldDirty: true })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                                                    </div>
                                                    <Input type="file" ref={nutritionalTableFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'nutritionalTable')} />
                                                    <FormField control={form.control} name="nutritionalTableImageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)}/>
                                                </div>

                                                {/* Composição */}
                                                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => form.watch('compositionImageUrl') ? setZoomedImage(form.watch('compositionImageUrl')!) : setIsCompositionPhotoModalOpen(true)}
                                                        className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-secondary focus:outline-none"
                                                    >
                                                        {form.watch('compositionImageUrl') ? <Image src={form.watch('compositionImageUrl')!} alt="Composição" width={64} height={64} className="h-full w-full object-cover" /> : <Camera className="h-7 w-7 text-muted-foreground" />}
                                                    </button>
                                                    <div>
                                                        <p className="text-sm font-semibold">Composição / ingredientes</p>
                                                        <p className="text-xs text-muted-foreground">Câmera ou upload</p>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Button type="button" variant="outline" size="sm" onClick={() => setIsCompositionPhotoModalOpen(true)}><Camera className="mr-1.5 h-3.5 w-3.5" /> Câmera</Button>
                                                        <Button type="button" variant="outline" size="sm" onClick={() => compositionFileInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" /> Upload</Button>
                                                        {form.watch('compositionImageUrl') && <Button type="button" variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => form.setValue('compositionImageUrl', '', { shouldDirty: true })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                                                    </div>
                                                    <Input type="file" ref={compositionFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'composition')} />
                                                    <FormField control={form.control} name="compositionImageUrl" render={({ field }) => (<FormItem className="hidden"><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)}/>
                                                </div>
                                            </div>

                                            {productToEdit?.nutritionalData ? (
                                                <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Dados Transcritos</p>
                                                    <div className="overflow-hidden rounded-lg border border-emerald-100 bg-white">
                                                        <div className="bg-emerald-600 px-3 py-2 text-white">
                                                            <p className="text-xs font-bold">INFORMAÇÃO NUTRICIONAL</p>
                                                            <p className="text-[10px] text-emerald-100">Porção: {productToEdit.nutritionalData.portionSize}{productToEdit.nutritionalData.portionDescription ? ` (${productToEdit.nutritionalData.portionDescription})` : ''}</p>
                                                        </div>
                                                        <div className="divide-y divide-gray-50">
                                                            {productToEdit.nutritionalData.nutrients.map((n, i) => (
                                                                <div key={i} className="flex items-center justify-between px-3 py-1.5">
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
                                                        <div className="rounded-lg border border-emerald-100 bg-white p-3">
                                                            <p className="mb-1 text-[10px] font-bold uppercase text-emerald-700">Composição</p>
                                                            <p className="text-xs leading-relaxed text-gray-600">{productToEdit.compositionText}</p>
                                                        </div>
                                                    )}
                                                    {productToEdit.detectedAllergens && productToEdit.detectedAllergens.length > 0 && (
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {productToEdit.detectedAllergens.map((a, i) => (
                                                                <span key={i} className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">{a}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="py-2 text-center text-xs text-muted-foreground">Dados nutricionais ainda não transcritos — solicite no chat.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Footer */}
                        <DialogFooter className="flex flex-row items-center justify-between gap-4 border-t px-6 py-4 sm:justify-between">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <div className="hidden flex-col items-center text-center sm:flex">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStepPosition + 1} de {wizardSteps.length}</span>
                                <span className="text-sm font-medium">{currentStepMeta.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {currentStepPosition > 0 && (
                                    <Button type="button" variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>
                                )}
                                {currentStepPosition < wizardSteps.length - 1 ? (
                                    <Button type="button" className="bg-indigo-500 hover:bg-indigo-600" onClick={handleNext}>Avançar <ChevronRight className="ml-1 h-4 w-4" /></Button>
                                ) : (
                                    <Button type="submit" className="bg-indigo-500 hover:bg-indigo-600">{productToEdit ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                                )}
                            </div>
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
                    <DialogContent className="max-w-3xl border-none bg-black p-2">
                        <Image src={zoomedImage} alt="Ampliado" width={800} height={1000} className="h-auto max-h-[85vh] w-full rounded object-contain" />
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
