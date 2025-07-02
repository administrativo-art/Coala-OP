"use client"

import { useState, useEffect, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon, Camera, Plus, X } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { type LotEntry, type Kiosk, type Product, unitCategories } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { getUnitsForCategory } from '@/lib/conversion';
import { Label } from '@/components/ui/label';

const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const lotFormSchema = z.object({
  // Product fields
  baseName: z.string().min(1, 'O nome base é obrigatório.'),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
  
  // Lot fields
  barcode: z.string().optional(),
  lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
  expiryDate: z.date({ required_error: 'A data de validade é obrigatória.' }),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
  quantity: z.coerce.number().min(0, 'A quantidade não pode ser negativa.'),
  imageUrl: z.string().optional(),

  // Thresholds (optional, but part of the form)
  alertThreshold: z.coerce.number().optional(),
  urgentThreshold: z.coerce.number().optional(),
});


type LotFormValues = z.infer<typeof lotFormSchema>;

type AddEditLotModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotToEdit: LotEntry | null;
  kiosks: Kiosk[];
  addLot: (lot: Omit<LotEntry, 'id'>) => void;
  updateLot: (lot: LotEntry) => void;
  lots: LotEntry[];
};

export function AddEditLotModal({ open, onOpenChange, lotToEdit, kiosks, addLot, updateLot, lots }: AddEditLotModalProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { products, findOrCreateProduct, updateProduct, getProductFullName } = useProducts();
  const { toast } = useToast();
  const isEditing = !!lotToEdit;

  const lotSchema = useMemo(() => {
    return z.object({
        // Product fields have strict validation only on creation
        baseName: isEditing ? z.string().optional() : z.string().min(1, 'O nome base é obrigatório.'),
        category: z.enum(unitCategories),
        packageSize: isEditing ? z.coerce.number().optional() : z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
        unit: isEditing ? z.string().optional() : z.string().min(1, 'A unidade é obrigatória.'),
        
        // Lot fields are always validated
        barcode: z.string().optional(),
        lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
        expiryDate: z.date({ required_error: 'A data de validade é obrigatória.' }),
        kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
        quantity: z.coerce.number().min(0, 'A quantidade não pode ser negativa.'),
        imageUrl: z.string().optional(),
    
        // Thresholds (optional, but part of the form)
        alertThreshold: z.coerce.number().optional(),
        urgentThreshold: z.coerce.number().optional(),
    });
  }, [isEditing]);

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotSchema),
    defaultValues: {
      baseName: '',
      category: 'Massa',
      packageSize: undefined,
      unit: 'g',
      barcode: '',
      lotNumber: '',
      expiryDate: undefined,
      kioskId: '',
      quantity: 1,
      imageUrl: '',
      alertThreshold: undefined,
      urgentThreshold: undefined,
    }
  });
  
  const categoryWatch = form.watch('category');
  const availableUnits = getUnitsForCategory(categoryWatch);

  useEffect(() => {
    // Reset unit when category changes
    if(form.formState.isDirty) {
        form.setValue('unit', availableUnits[0]);
    }
  }, [categoryWatch, form, availableUnits]);


  useEffect(() => {
    if (open) {
      if (lotToEdit) {
        const product = products.find(p => p.id === lotToEdit.productId);
        form.reset({
          // Product fields
          baseName: product?.baseName || '',
          category: product?.category || 'Massa',
          packageSize: product?.packageSize || 0,
          unit: product?.unit || 'g',
          // Lot fields
          ...lotToEdit,
          expiryDate: new Date(lotToEdit.expiryDate),
          imageUrl: lotToEdit.imageUrl || '',
          // Thresholds
          alertThreshold: product?.alertThreshold,
          urgentThreshold: product?.urgentThreshold,
        });
      } else {
        form.reset({
            baseName: '',
            category: 'Massa',
            packageSize: undefined,
            unit: 'g',
            barcode: '',
            lotNumber: '',
            expiryDate: undefined,
            kioskId: '',
            quantity: 1,
            imageUrl: '',
            alertThreshold: undefined,
            urgentThreshold: undefined,
        });
      }
    }
  }, [lotToEdit, open, form, products]);
  
  const onSubmit = async (values: LotFormValues) => {
    // This validation only applies when creating a new lot from scratch.
    if (!isEditing && values.quantity < 1) {
        form.setError('quantity', { message: 'Para um novo insumo, a quantidade deve ser pelo menos 1.' });
        return;
    }

    // --- EDITING AN EXISTING LOT ---
    if (lotToEdit) { 
        // We can trust lotToEdit to have the correct product ID and name.
        // We don't need to re-find the product just to update the lot.
        const lotData: Omit<LotEntry, 'id'> = {
            productId: lotToEdit.productId,
            productName: lotToEdit.productName, // Reuse existing name.
            barcode: values.barcode || '',
            lotNumber: values.lotNumber,
            expiryDate: values.expiryDate.toISOString(),
            kioskId: values.kioskId,
            quantity: values.quantity,
            imageUrl: values.imageUrl || lotToEdit.imageUrl,
        };

        // The updateLot function will handle deletion if quantity is 0.
        await updateLot({ ...lotToEdit, ...lotData });

        // As a secondary action, try to update product thresholds.
        // If the product doesn't exist anymore, this part will be skipped,
        // but the lot update will still succeed.
        const productToUpdate = products.find(p => p.id === lotToEdit.productId);
        if (productToUpdate) {
            const needsUpdate = productToUpdate.alertThreshold !== values.alertThreshold || productToUpdate.urgentThreshold !== values.urgentThreshold;
            if (needsUpdate) {
                await updateProduct({
                    ...productToUpdate,
                    alertThreshold: values.alertThreshold,
                    urgentThreshold: values.urgentThreshold,
                });
            }
        }
        
        onOpenChange(false);
        return;
    }

    // --- CREATING A NEW LOT ---
    const productDefinition = {
        baseName: values.baseName,
        category: values.category,
        packageSize: values.packageSize,
        unit: values.unit,
    };
    const product = await findOrCreateProduct(productDefinition);

    if (!product) {
      toast({
        variant: "destructive",
        title: "Erro de Produto",
        description: "Não foi possível encontrar ou criar o produto para este novo lote.",
      });
      return;
    }

    const lotData: Omit<LotEntry, 'id'> = {
      productId: product.id,
      productName: getProductFullName(product),
      barcode: values.barcode || '',
      lotNumber: values.lotNumber,
      expiryDate: values.expiryDate.toISOString(),
      kioskId: values.kioskId,
      quantity: values.quantity,
      imageUrl: values.imageUrl || undefined,
    };

    await addLot(lotData);
    
    // Update thresholds for the newly found/created product if they were changed.
    const needsUpdate = product.alertThreshold !== values.alertThreshold || product.urgentThreshold !== values.urgentThreshold;
    if (needsUpdate) {
        await updateProduct({
            ...product,
            alertThreshold: values.alertThreshold,
            urgentThreshold: values.urgentThreshold,
        });
    }

    onOpenChange(false);
  };
  
  const prefillFromBarcode = (barcode: string) => {
      if (!barcode.trim()) return;
      const existingLot = lots.find(l => l.barcode === barcode);
      if (existingLot) {
          const product = products.find(p => p.id === existingLot.productId);
          if (product) {
              form.setValue('baseName', product.baseName, { shouldValidate: true });
              form.setValue('category', product.category, { shouldValidate: true });
              form.setValue('packageSize', product.packageSize, { shouldValidate: true });
              form.setValue('unit', product.unit, { shouldValidate: true });
              if(existingLot.imageUrl) form.setValue('imageUrl', existingLot.imageUrl, { shouldValidate: true });
              if(product.alertThreshold) form.setValue('alertThreshold', product.alertThreshold, { shouldValidate: true });
              if(product.urgentThreshold) form.setValue('urgentThreshold', product.urgentThreshold, { shouldValidate: true });

              toast({
                  title: "Produto encontrado!",
                  description: "Os dados do produto foram preenchidos. Complete as informações do lote.",
              });
          }
      }
  };

  const handleScanSuccess = (decodedText: string) => {
    form.setValue('barcode', decodedText, { shouldValidate: true });
    prefillFromBarcode(decodedText);
    setIsScannerOpen(false);
  };
  
  const handleBarcodeBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      prefillFromBarcode(event.target.value);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        form.setValue('imageUrl', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const imageUrl = form.watch('imageUrl');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar insumo' : 'Adicionar novo insumo ao estoque'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Atualize as informações do insumo em estoque.' : 'Preencha os detalhes do produto e do insumo que está entrando no estoque.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
                <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4 py-4">

                        {!isEditing && (
                            <div className="space-y-3 p-4 border rounded-lg bg-muted/40">
                                <Label className="text-sm font-medium">Comece por aqui</Label>
                                <Button type="button" className="w-full" variant="outline" onClick={() => setIsScannerOpen(true)}>
                                    <Camera className="mr-2 h-4 w-4" /> Escanear código de barras
                                </Button>
                                <div className="relative py-1">
                                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Ou</span></div>
                                </div>
                                <FormField
                                    control={form.control}
                                    name="barcode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    placeholder="Digite o código manualmente"
                                                    {...field}
                                                    onBlur={handleBarcodeBlur}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}

                        <FormField
                            control={form.control}
                            name="imageUrl"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Foto do Produto (Opcional)</FormLabel>
                                    <FormControl>
                                        <div className="w-full">
                                            <input
                                                type="file"
                                                accept="image/*"
                                                ref={fileInputRef}
                                                className="hidden"
                                                onChange={handleImageUpload}
                                            />
                                            {imageUrl ? (
                                                <div className="relative w-32 h-32">
                                                    <Image src={imageUrl} alt="Pré-visualização" layout="fill" className="rounded-md object-cover" />
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="icon"
                                                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                                                        onClick={() => form.setValue('imageUrl', '')}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="h-32 w-32 flex flex-col items-center justify-center border-dashed"
                                                    onClick={() => fileInputRef.current?.click()}
                                                >
                                                    <Plus className="h-8 w-8 text-muted-foreground" />
                                                    <span>Adicionar foto</span>
                                                </Button>
                                            )}
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="p-4 border rounded-lg space-y-4 bg-muted/40">
                             <h4 className="text-sm font-medium text-muted-foreground">Detalhes do Produto</h4>
                              <FormField
                                control={form.control}
                                name="baseName"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Nome base do produto</FormLabel>
                                    <FormControl><Input placeholder="ex: Ovomaltine" {...field} disabled={isEditing} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                             <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Categoria</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value} disabled={isEditing}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                                    </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={form.control}
                                name="packageSize"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Tamanho do pacote</FormLabel>
                                    <FormControl><Input type="number" step="any" placeholder="ex: 250" {...field} disabled={isEditing} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="unit"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Unidade</FormLabel>
                                     <Select onValueChange={field.onChange} value={field.value} disabled={isEditing}>
                                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                      <SelectContent>
                                         {availableUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            <FormDescription>
                                {isEditing ? "Para alterar os detalhes do produto, você deve criar um novo lote." : "Se um produto com estas características já existir, ele será reutilizado."}
                            </FormDescription>
                        </div>
                        
                        <div className="p-4 border rounded-lg space-y-4">
                            <h4 className="text-sm font-medium text-muted-foreground">Detalhes do Insumo</h4>
                            <FormField
                                control={form.control}
                                name="lotNumber"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Número do lote</FormLabel>
                                    <FormControl><Input placeholder="ex: L12345" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                           
                            <FormField
                                control={form.control}
                                name="expiryDate"
                                render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Data de validade</FormLabel>
                                    <Popover>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                            "w-full pl-3 text-left font-normal",
                                            !field.value && "text-muted-foreground"
                                            )}
                                        >
                                            {field.value ? (
                                            format(field.value, "dd/MM/yyyy")
                                            ) : (
                                            <span>Escolha uma data</span>
                                            )}
                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                        mode="single"
                                        selected={field.value}
                                        onSelect={field.onChange}
                                        disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                                        initialFocus
                                        />
                                    </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                control={form.control}
                                name="quantity"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Quantidade</FormLabel>
                                    <FormControl><Input type="number" {...field} /></FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                                />
                                <FormField
                                control={form.control}
                                name="kioskId"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Quiosque</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value} disabled={kiosks.length === 0}>
                                        <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                        {kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                    </FormItem>
                                )}
                                />
                            </div>
                        </div>

                       <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="item-1">
                            <AccordionTrigger className="text-sm">Parâmetros de Alerta de Vencimento (Opcional)</AccordionTrigger>
                            <AccordionContent className="pt-4 space-y-4">
                                 <FormDescription>
                                    Defina os dias de alerta para este produto. A configuração será salva e aplicada a todos os lotes futuros deste mesmo produto.
                                </FormDescription>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="alertThreshold"
                                        render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Alerta (dias)</FormLabel>
                                            <FormControl><Input type="number" placeholder="ex: 30" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || undefined)} /></FormControl>
                                        </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="urgentThreshold"
                                        render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Urgente (dias)</FormLabel>
                                            <FormControl><Input type="number" placeholder="ex: 7" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || undefined)}/></FormControl>
                                        </FormItem>
                                        )}
                                    />
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                </ScrollArea>

              <DialogFooter className="pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Salvando..." : (isEditing ? 'Salvar alterações' : 'Adicionar insumo')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      {isScannerOpen && <BarcodeScannerModal
        open={isScannerOpen}
        onOpenChange={setIsScannerOpen}
        onScanSuccess={handleScanSuccess}
      />}
    </>
  );
}
