
"use client"

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Edit, Trash2, PlusCircle, Camera } from 'lucide-react';
import { type Product, unitCategories, type UnitCategory } from '@/types';
import { getUnitsForCategory } from '@/lib/conversion';
import { useToast } from '@/hooks/use-toast';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';


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
  barcode: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
});

type ProductFormValues = z.infer<typeof productFormSchema>;


interface ProductManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductManagement({ open, onOpenChange }: ProductManagementProps) {
    const { products, loading: productsLoading, getProductFullName, addProduct, updateProduct, deleteProduct, deleteMultipleProducts } = useProducts();
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
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productFormSchema),
        defaultValues: {
            baseName: '',
            barcode: '',
            imageUrl: '',
            category: 'Massa',
            packageSize: undefined,
            unit: 'g',
        }
    });
    
    const categoryWatch = form.watch('category');
    
    useEffect(() => {
        if (form.formState.isDirty || !editingProduct) {
            form.setValue('unit', getUnitsForCategory(categoryWatch)[0]);
        }
    }, [categoryWatch, form, editingProduct]);

    const handleOpenChangeAndReset = (isOpen: boolean) => {
        if (!isOpen) {
            setShowForm(false);
            setEditingProduct(null);
            setProductToDelete(null);
            setProductsToDelete([]);
            setSelectedProducts(new Set());
            setIsDeleting(false);
        }
        onOpenChange(isOpen);
    };

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        form.reset({
            baseName: product.baseName,
            barcode: product.barcode || '',
            imageUrl: product.imageUrl || '',
            category: product.category,
            packageSize: product.packageSize,
            unit: product.unit
        });
        setShowForm(true);
    };

    const handleDeleteClick = (product: Product) => {
        const usedInLotsCount = lots.filter(lot => lot.productId === product.id).length;
        const usedInLists = lists.filter(list => list.items.some(item => item.productId === product.id));

        let messages = [];
        if (usedInLotsCount > 0) {
            messages.push(`está sendo usado em ${usedInLotsCount} lote(s)`);
        }
        if (usedInLists.length > 0) {
            messages.push(`está nas listas predefinidas: ${usedInLists.map(l => `"${l.name}"`).join(', ')}`);
        }

        if (messages.length > 0) {
            toast({
                variant: "destructive",
                title: "Não é possível excluir o insumo",
                description: `Este insumo não pode ser excluído pois ${messages.join(' e ')}.`,
                duration: 8000,
            });
            return;
        }
        setProductToDelete(product);
    };
    
    const handleDeleteConfirm = async () => {
        if (productToDelete) {
            setIsDeleting(true);
            try {
                await deleteProduct(productToDelete.id);
            } finally {
                setIsDeleting(false);
                setProductToDelete(null);
            }
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
        setSelectedProducts(isSelected ? new Set(products.map(p => p.id)) : new Set());
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
            } finally {
                setIsDeleting(false);
            }
        }
    };

    const handleScanSuccess = (decodedText: string) => {
        form.setValue('barcode', decodedText, { shouldValidate: true });
        setIsScannerOpen(false);
    };

    const handlePhotoCaptured = (dataUrl: string) => {
        form.setValue('imageUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
    };

    const onSubmit = (values: ProductFormValues) => {
        if (editingProduct) {
            updateProduct({ ...editingProduct, ...values });
        } else {
            addProduct(values);
        }
        setShowForm(false);
        setEditingProduct(null);
    };
    
    if (!open) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChangeAndReset}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Gerenciar Insumos</DialogTitle>
                        <DialogDescription>
                            Adicione, edite ou exclua os insumos usados no controle de estoque e validade.
                        </DialogDescription>
                    </DialogHeader>

                    {showForm ? (
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                                <h3 className="text-lg font-medium">{editingProduct ? `Editando ${getProductFullName(editingProduct)}` : 'Adicionar novo insumo'}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField control={form.control} name="baseName" render={({ field }) => (
                                        <FormItem><FormLabel>Nome base</FormLabel><FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name="barcode" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Código de Barras (Opcional)</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input placeholder="Escanear ou digitar" {...field} />
                                                </FormControl>
                                                <Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
                                                    <Camera className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}/>
                                </div>
                                
                                <div className="space-y-2">
                                    <FormLabel>Foto do Insumo (Opcional)</FormLabel>
                                    <div className="flex items-center gap-4">
                                        <div className="w-24 h-24 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                                            {form.watch('imageUrl') ? (
                                                <Image src={form.watch('imageUrl')!} alt="Pré-visualização do insumo" width={96} height={96} className="object-cover" />
                                            ) : (
                                                <Camera className="h-10 w-10 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Button type="button" variant="outline" onClick={() => setIsPhotoModalOpen(true)}>
                                                <Camera className="mr-2" /> {form.watch('imageUrl') ? 'Tirar outra foto' : 'Tirar foto'}
                                            </Button>
                                            {form.watch('imageUrl') && (
                                                <Button type="button" variant="destructive" size="sm" onClick={() => form.setValue('imageUrl', '', { shouldValidate: true })}>
                                                    <Trash2 className="mr-2" /> Remover foto
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <FormField control={form.control} name="imageUrl" render={({ field }) => (
                                        <FormItem className="hidden">
                                            <FormControl><Input {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}/>
                                </div>


                                <div className="grid grid-cols-3 gap-4">
                                    <FormField control={form.control} name="category" render={({ field }) => (
                                        <FormItem><FormLabel>Categoria</FormLabel>
                                            <Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}>
                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                                            </Select><FormMessage />
                                        </FormItem>
                                    )}/>
                                    <FormField control={form.control} name="packageSize" render={({ field }) => (
                                        <FormItem><FormLabel>Tamanho</FormLabel><FormControl><Input type="number" step="any" placeholder="ex: 250" {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name="unit" render={({ field }) => (
                                        <FormItem><FormLabel>Unidade</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>{getUnitsForCategory(categoryWatch).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                            </Select><FormMessage />
                                        </FormItem>
                                    )}/>
                                </div>
                                <DialogFooter className="pt-4 border-t">
                                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                                    <Button type="submit">{editingProduct ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    ) : (
                       <div className="flex flex-col h-[60vh]">
                            <div className="p-1">
                                <Button type="button" className="w-full" onClick={() => setShowForm(true)}>
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Adicionar Novo Insumo
                                </Button>
                            </div>
                            <Separator className="my-4" />

                             {products.length > 0 && (
                                <div className="flex items-center gap-3 px-1 py-2 mb-2 border-y bg-muted/50">
                                    <Checkbox
                                        id="select-all-products"
                                        checked={selectedProducts.size === products.length && products.length > 0}
                                        onCheckedChange={(checked) => handleSelectAllChange(!!checked)}
                                        aria-label="Selecionar todos os insumos"
                                    />
                                    <label htmlFor="select-all-products" className="text-sm font-medium leading-none cursor-pointer">
                                        Selecionar todos
                                    </label>
                                </div>
                            )}

                            <ScrollArea className="flex-grow">
                                <div className="space-y-2 pr-4">
                                    {products.length > 0 ? products.map(product => (
                                        <div key={product.id} className="flex items-center justify-between rounded-md border p-2">
                                            <div className="flex items-center gap-3">
                                                 <Checkbox
                                                    id={`product-${product.id}`}
                                                    checked={selectedProducts.has(product.id)}
                                                    onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}
                                                />
                                                <label htmlFor={`product-${product.id}`} className="font-medium cursor-pointer">{getProductFullName(product)}</label>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /></Button>
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
                            <DialogFooter className="pt-4 mt-auto border-t !justify-between">
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={handleDeleteSelectedClick}
                                    disabled={selectedProducts.size === 0}
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir Selecionados ({selectedProducts.size})
                                </Button>
                                <Button type="button" variant="outline" onClick={() => handleOpenChangeAndReset(false)}>Fechar</Button>
                           </DialogFooter>
                       </div>
                    )}
                </DialogContent>
            </Dialog>

            {isScannerOpen && (
                <BarcodeScannerModal
                    open={isScannerOpen}
                    onOpenChange={setIsScannerOpen}
                    onScanSuccess={handleScanSuccess}
                />
            )}

             {isPhotoModalOpen && (
                <PhotoCaptureModal
                    open={isPhotoModalOpen}
                    onOpenChange={setIsPhotoModalOpen}
                    onPhotoCaptured={handlePhotoCaptured}
                />
            )}

            {productToDelete && (
                <DeleteConfirmationDialog
                    open={!!productToDelete}
                    isDeleting={isDeleting}
                    onOpenChange={() => setProductToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`o insumo "${getProductFullName(productToDelete)}"`}
                />
            )}
            
            {productsToDelete.length > 0 && (
                <DeleteConfirmationDialog
                    open={productsToDelete.length > 0}
                    isDeleting={isDeleting}
                    onOpenChange={(isOpen) => { if (!isOpen) setProductsToDelete([]); }}
                    onConfirm={handleDeleteMultipleConfirm}
                    itemName={`os ${productsToDelete.length} insumo(s) selecionado(s)`}
                />
            )}
        </>
    );
}
