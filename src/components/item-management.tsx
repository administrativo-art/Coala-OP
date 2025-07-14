
"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import dynamic from 'next/dynamic';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useToast } from '@/hooks/use-toast';
import { getUnitsForCategory } from '@/lib/conversion';
import { type Product, type AnalysisProduct, type UnitCategory, unitCategories } from '@/types';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from '@/components/ui/textarea';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Download, PlusCircle, Edit, Trash2, FileUp, Loader2, Info, ChevronDown, Search, Eraser, Camera, Archive, Upload } from 'lucide-react';
import { ArchivedProductsModal } from './archived-products-modal';
import { Checkbox } from './ui/checkbox';


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

export function ItemManagement() {
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
      });
      setShowForm(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
  
  const handleAddNewClick = () => {
    setEditingProduct(null);
    form.reset({
        baseName: '', brand: '', barcode: '', imageUrl: '',
        category: 'Massa', packageSize: undefined, unit: 'g',
        notes: '', analysisProductId: ''
    });
    setShowForm(true);
  };
  
  const activeProducts = products.filter(p => !p.isArchived);

  return (
    <>
      <Card>
        <CardContent className="p-6 space-y-6">
          <Button onClick={handleAddNewClick} className="w-full">
            <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Insumo
          </Button>

          {showForm && (
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle>{editingProduct ? `Editando ${getProductFullName(editingProduct)}` : 'Adicionar novo insumo'}</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                    
                    <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                        <Button type="submit">{editingProduct ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          <Accordion type="multiple" className="w-full space-y-2">
            {activeProducts.map(product => (
              <AccordionItem value={product.id} key={product.id} className="border-none">
                <Card>
                  <AccordionTrigger className="p-4 hover:no-underline rounded-lg">
                    <div className="flex justify-between items-center w-full">
                      <span className="font-semibold">{getProductFullName(product)}</span>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleArchiveClick(product)}><Archive className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-4 pt-0 text-sm text-muted-foreground">
                    <p><strong>Categoria:</strong> {product.category}</p>
                    <p><strong>Cód. Barras:</strong> {product.barcode || 'N/A'}</p>
                    <p><strong>Categoria Macro:</strong> {analysisProducts.find(ap => ap.id === product.analysisProductId)?.itemName || 'N/A'}</p>
                    {product.notes && <p><strong>Notas:</strong> {product.notes}</p>}
                  </AccordionContent>
                </Card>
              </AccordionItem>
            ))}
          </Accordion>

        </CardContent>
      </Card>
      <ArchivedProductsModal open={isArchiveModalOpen} onOpenChange={setIsArchiveModalOpen} />
      {isScannerOpen && <BarcodeScannerModal open={isScannerOpen} onOpenChange={setIsScannerOpen} onScanSuccess={handleScanSuccess} />}
      {isPhotoModalOpen && <PhotoCaptureModal open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen} onPhotoCaptured={handlePhotoCaptured} />}
      {productToDelete && <DeleteConfirmationDialog open={!!productToDelete} isDeleting={isDeleting} onOpenChange={() => setProductToDelete(null)} onConfirm={handleDeleteConfirm} itemName={`o insumo "${getProductFullName(productToDelete)}"`} />}
    </>
  );
}
