"use client"

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useToast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Edit, Trash2, PlusCircle, Camera, Archive, Upload, Settings } from 'lucide-react';
import { type Product, unitCategories, type UnitCategory, type AnalysisProduct } from '@/types';
import { getUnitsForCategory } from '@/lib/conversion';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ArchivedProductsModal } from './archived-products-modal';
import { Textarea } from '@/components/ui/textarea';


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
  analysisProductId: z.string().optional(),
  stockLevels: z.any().optional(), // For compatibility, not directly edited here
  pdfUnit: z.string().optional(),
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

interface ProductManagementProps {
  productToEdit?: Product | null;
}

export function ProductManagement({ productToEdit: initialProductToEdit }: ProductManagementProps) {
    const { products, loading: productsLoading, getProductFullName, addProduct, updateProduct, deleteProduct, deleteMultipleProducts } = useProducts();
    const { analysisProducts } = useStockAnalysisProducts();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { lists, loading: listsLoading } = usePredefinedLists();
    const { toast } = useToast();

    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);
    const [productsToDelete, setProductsToDelete] = useState<Product[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productFormSchema),
        defaultValues: {
            baseName: '', brand: '', barcode: '', imageUrl: '',
            category: 'Massa', packageSize: undefined, unit: 'g',
            notes: '', analysisProductId: ''
        }
    });
    
    useEffect(() => {
        if(initialProductToEdit) {
            handleEdit(initialProductToEdit);
        }
    }, [initialProductToEdit]);
    
    const categoryWatch = form.watch('category');
    
    useEffect(() => {
        if (form.formState.isDirty || !editingProduct) {
            form.setValue('unit', getUnitsForCategory(categoryWatch)[0]);
        }
    }, [categoryWatch, form, editingProduct]);

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        form.reset({
            baseName: product.baseName,
            brand: product.brand || '',
            barcode: product.barcode || '',
            imageUrl: product.imageUrl || '',
            category: product.category,
            packageSize: product.packageSize,
            unit: product.unit,
            notes: product.notes || '',
            analysisProductId: product.analysisProductId || '',
            stockLevels: product.stockLevels,
            pdfUnit: product.pdfUnit,
        });
        setShowForm(true);
    };

    const handleDeleteClick = (product: Product) => {
        const usedInLotsCount = lots.filter(lot => lot.productId === product.id).length;
        const usedInLists = lists.filter(list => list.items.some(item => item.productId === product.id));

        let messages = [];
        if (usedInLotsCount > 0) messages.push(`está sendo usado em ${usedInLotsCount} lote(s)`);
        if (usedInLists.length > 0) messages.push(`está nas listas predefinidas: ${usedInLists.map(l => `"${l.name}"`).join(', ')}`);

        if (messages.length > 0) {
            alert(`Não é possível excluir o insumo: Este insumo não pode ser excluído pois ${messages.join(' e ')}.`);
            return;
        }
        setProductToDelete(product);
    };

    const handleArchiveClick = (product: Product) => {
        updateProduct({ ...product, isArchived: true });
    };
    
    const handleDeleteConfirm = async () => {
        if (productToDelete) {
            setIsDeleting(true);
            try { await deleteProduct(productToDelete.id); } 
            finally { setIsDeleting(false); setProductToDelete(null); }
        }
    };
    
    const handleProductSelectionChange = (id: string, isSelected: boolean) => {
        setSelectedProducts(prev => {
            const newSet = new Set(prev);
            if (isSelected) newSet.add(id);
            else newSet.delete(id);
            return newSet;
        });
    };

    const handleSelectAllChange = (isSelected: boolean) => {
        const activeProducts = products.filter(p => !p.isArchived);
        setSelectedProducts(isSelected ? new Set(activeProducts.map(p => p.id)) : new Set());
    };

    const handleDeleteSelectedClick = () => {
        const toDelete = products.filter(p => selectedProducts.has(p.id));
        setProductsToDelete(toDelete);
    };

    const handleDeleteMultipleConfirm = async () => {
        if (productsToDelete.length > 0) {
            setIsDeleting(true);
            try {
                const idsToDelete = productsToDelete.map(p => p.id);
                await deleteMultipleProducts(idsToDelete);
                setSelectedProducts(new Set());
                setProductsToDelete([]);
            } finally { setIsDeleting(false); }
        }
    };

    const handleScanSuccess = (decodedText: string) => {
        form.setValue('barcode', decodedText, { shouldValidate: true });
        setIsScannerOpen(false);
    };

    const handlePhotoCaptured = (dataUrl: string) => {
        handlePhotoUpdate(dataUrl);
    };

    const handlePhotoUpdate = (dataUrl: string) => {
        if (editingProduct) {
          updateProduct({ ...editingProduct, imageUrl: dataUrl });
        }
        form.setValue('imageUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
        toast({ title: "Foto do insumo atualizada!" });
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
                    handlePhotoUpdate(resizedDataUrl);
                } catch (error) {
                    toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Não foi possível redimensionar a imagem. Tente uma imagem diferente.' });
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const onSubmit = (values: ProductFormValues) => {
        const productData = { ...values };
        if (editingProduct) {
            updateProduct({ ...editingProduct, ...productData });
        } else {
            addProduct(productData);
        }
        setShowForm(false);
        setEditingProduct(null);
    };

    const activeProducts = products.filter(p => !p.isArchived);
    const allProductsSelected = activeProducts.length > 0 && selectedProducts.size === activeProducts.length;

    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle>Insumos Cadastrados</CardTitle>
                 <CardDescription>Adicione, edite ou exclua os insumos (itens físicos) do seu estoque.</CardDescription>
            </CardHeader>
            <CardContent>
                {showForm ? (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
                            <ScrollArea className="flex-1 pr-6 -mr-6">
                            <div className="space-y-4 pt-4">
                                <h3 className="text-lg font-medium">{editingProduct ? `Editando ${getProductFullName(editingProduct)}` : 'Adicionar novo insumo'}</h3>
                                
                                <div className="space-y-2">
                                    <FormLabel>Foto do Insumo</FormLabel>
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
                                    <FormField control={form.control} name="brand" render={({ field }) => (<FormItem><FormLabel>Marca (Opcional)</FormLabel><FormControl><Input placeholder="ex: Nestlé" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                
                                <FormField control={form.control} name="barcode" render={({ field }) => (
                                    <FormItem><FormLabel>Código de Barras</FormLabel><div className="flex gap-2"><FormControl><Input placeholder="Escanear ou digitar" {...field} value={field.value ?? ''} /></FormControl><Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}><Camera className="h-4 w-4" /></Button></div><FormMessage /></FormItem>
                                )}/>

                                <div className="grid grid-cols-3 gap-4">
                                    <FormField control={form.control} name="category" render={({ field }) => (<FormItem><FormLabel>Categoria</FormLabel><Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="packageSize" render={({ field }) => (<FormItem><FormLabel>Tamanho</FormLabel><FormControl><Input type="number" step="any" placeholder="ex: 250" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="unit" render={({ field }) => (<FormItem><FormLabel>Unidade</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{getUnitsForCategory(categoryWatch).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)}/>
                                </div>

                                <FormField control={form.control} name="analysisProductId" render={({ field }) => (
                                    <FormItem><FormLabel>Categoria (Agrupador Macro)</FormLabel><Select onValueChange={(value) => field.onChange(value || '')} value={field.value || ''}><FormControl><SelectTrigger><SelectValue placeholder="Selecione para agrupar este insumo..."/></SelectTrigger></FormControl><SelectContent>{analysisProducts.map(ap => <SelectItem key={ap.id} value={ap.id}>{ap.itemName}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                                )}/>
                                
                                <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>Observações</FormLabel><FormControl><Textarea placeholder="Insira observações (opcional)" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                            </div>
                            </ScrollArea>
                            <div className="flex justify-end gap-2 pt-4">
                                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                                <Button type="submit">{editingProduct ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                            </div>
                        </form>
                    </Form>
                ) : (
                    <div className="flex flex-col flex-1 overflow-hidden">
                        <div className="p-1 flex gap-2">
                            <Button type="button" className="flex-grow" onClick={() => { setEditingProduct(null); form.reset({ baseName: '', brand: '', barcode: '', imageUrl: '', category: 'Massa', packageSize: undefined, unit: 'g', notes: '' }); setShowForm(true); }}>
                                <PlusCircle className="mr-2" /> Adicionar Novo Insumo
                            </Button>
                            <Button type="button" variant="outline" className="flex-grow" onClick={() => setIsArchiveModalOpen(true)}>
                                <Archive className="mr-2" /> Ver Arquivados
                            </Button>
                        </div>
                        <Separator className="my-4" />

                            {activeProducts.length > 0 && (
                            <div className="flex items-center gap-3 px-1 py-2 mb-2 border-y bg-muted/50">
                                <Checkbox id="select-all-active-products" checked={allProductsSelected} onCheckedChange={(checked) => handleSelectAllChange(!!checked)} aria-label="Selecionar todos"/>
                                <label htmlFor="select-all-active-products" className="text-sm font-medium leading-none cursor-pointer">Selecionar todos</label>
                            </div>
                        )}

                        <ScrollArea className="flex-grow">
                            <div className="space-y-2 pr-4">
                                {activeProducts.length > 0 ? activeProducts.map(product => (
                                    <div key={product.id} className="flex items-center justify-between rounded-md border p-2">
                                        <div className="flex items-center gap-3">
                                                <Checkbox id={`active-product-${product.id}`} checked={selectedProducts.has(product.id)} onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}/>
                                            <label htmlFor={`active-product-${product.id}`} className="font-medium cursor-pointer">{getProductFullName(product)}</label>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleArchiveClick(product)}><Archive className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <p>Nenhum insumo cadastrado.</p>
                                        <p className="text-sm">Clique em "Adicionar Novo Insumo" para começar.</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                        <div className="pt-4 border-t mt-auto shrink-0 flex justify-between">
                            <Button type="button" variant="destructive" onClick={handleDeleteSelectedClick} disabled={selectedProducts.size === 0}><Trash2 className="mr-2 h-4 w-4" /> Excluir ({selectedProducts.size})</Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
            
        <ArchivedProductsModal open={isArchiveModalOpen} onOpenChange={setIsArchiveModalOpen} />
        {isScannerOpen && <BarcodeScannerModal open={isScannerOpen} onOpenChange={setIsScannerOpen} onScanSuccess={handleScanSuccess} />}
        {isPhotoModalOpen && <PhotoCaptureModal open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen} onPhotoCaptured={handlePhotoCaptured} />}
        {productToDelete && <DeleteConfirmationDialog open={!!productToDelete} isDeleting={isDeleting} onOpenChange={() => setProductToDelete(null)} onConfirm={handleDeleteConfirm} itemName={`o insumo "${getProductFullName(productToDelete)}"`} />}
        {productsToDelete.length > 0 && <DeleteConfirmationDialog open={productsToDelete.length > 0} isDeleting={isDeleting} onOpenChange={(isOpen) => { if (!isOpen) setProductsToDelete([]); }} onConfirm={handleDeleteMultipleConfirm} itemName={`os ${productsToDelete.length} insumo(s) selecionado(s)`} />}
        </>
    );
}
