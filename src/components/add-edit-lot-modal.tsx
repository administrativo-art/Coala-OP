
"use client"

import { useState, useEffect, useRef } from 'react';
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
import { Calendar as CalendarIcon, Camera, Plus, X, ChevronsUpDown } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { type LotEntry, type Kiosk, type Product } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { ScrollArea } from '@/components/ui/scroll-area';

const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const lotSchema = z.object({
  productId: z.string().min(1, 'O produto é obrigatório.'),
  barcode: z.string().optional(),
  lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
  expiryDate: z.date({ required_error: 'A data de validade é obrigatória.' }),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
  quantity: z.coerce.number().min(1, 'A quantidade deve ser de pelo menos 1.'),
  imageUrl: z.string().optional(),
  alertThreshold: z.coerce.number().optional(),
  urgentThreshold: z.coerce.number().optional(),
});

type LotFormValues = z.infer<typeof lotSchema>;

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
  const { products, updateProduct: updateProductInDB, getProductFullName } = useProducts();

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotSchema),
  });
  
  const productIdWatch = form.watch('productId');

  useEffect(() => {
    if (open) {
      if (lotToEdit) {
        const product = products.find(p => p.id === lotToEdit.productId);
        form.reset({
          ...lotToEdit,
          expiryDate: new Date(lotToEdit.expiryDate),
          imageUrl: lotToEdit.imageUrl || '',
          alertThreshold: product?.alertThreshold,
          urgentThreshold: product?.urgentThreshold,
        });
      } else {
        form.reset({
          productId: '',
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
  
  useEffect(() => {
    if (productIdWatch) {
      const product = products.find(p => p.id === productIdWatch);
      if (product) {
        form.setValue('alertThreshold', product.alertThreshold);
        form.setValue('urgentThreshold', product.urgentThreshold);
      }
    }
  }, [productIdWatch, products, form]);

  const onSubmit = async (values: LotFormValues) => {
    const selectedProduct = products.find(p => p.id === values.productId);
    if (!selectedProduct) return;

    const lotData = {
      productId: values.productId,
      productName: getProductFullName(selectedProduct),
      barcode: values.barcode || '',
      lotNumber: values.lotNumber,
      expiryDate: values.expiryDate.toISOString(),
      kioskId: values.kioskId,
      quantity: values.quantity,
      imageUrl: values.imageUrl || undefined,
    };

    if (lotToEdit) {
      updateLot({ ...lotToEdit, ...lotData });
    } else {
      addLot(lotData);
    }
    
    // Side effect: update product parameters
    const needsUpdate = selectedProduct.alertThreshold !== values.alertThreshold || selectedProduct.urgentThreshold !== values.urgentThreshold;
    if (needsUpdate) {
        const updatedProduct: Product = {
            ...selectedProduct,
            alertThreshold: values.alertThreshold,
            urgentThreshold: values.urgentThreshold,
        };
        await updateProductInDB(updatedProduct);
    }

    onOpenChange(false);
  };

  const handleScanSuccess = (decodedText: string) => {
    form.setValue('barcode', decodedText);
    // Try to find a product or lot with this barcode to pre-fill info
    const existingLot = lots.find(l => l.barcode === decodedText);
    if (existingLot) {
        form.setValue('productId', existingLot.productId);
        if(existingLot.imageUrl) {
            form.setValue('imageUrl', existingLot.imageUrl);
        }
    }
    setIsScannerOpen(false);
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

  const sortedProducts = [...products].sort((a,b) => getProductFullName(a).localeCompare(getProductFullName(b)));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{lotToEdit ? 'Editar lote' : 'Adicionar novo lote'}</DialogTitle>
            <DialogDescription>
              {lotToEdit ? 'Atualize as informações do lote.' : 'Preencha os detalhes do novo lote de produtos.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
                <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4 py-4">
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
                        <FormField
                            control={form.control}
                            name="productId"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Produto</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um produto..." />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {sortedProducts.map(product => (
                                        <SelectItem key={product.id} value={product.id}>
                                        {getProductFullName(product)}
                                        </SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormDescription>
                                    Não encontrou? Cadastre na tela de Conversão de Medidas.
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
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
                        name="barcode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Código de barras (opcional)</FormLabel>
                            <div className="flex gap-2">
                              <FormControl><Input placeholder="ex: 7891234567890" {...field} /></FormControl>
                              <Button type="button" variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
                                <Camera className="h-4 w-4" />
                              </Button>
                            </div>
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

                       <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="item-1">
                            <AccordionTrigger className="text-sm">Parâmetros de Vencimento (Opcional)</AccordionTrigger>
                            <AccordionContent className="pt-4">
                                 <FormDescription className="mb-4">
                                    Defina os parâmetros de alerta para este produto. Eles serão salvos e aplicados a todos os lotes futuros com este mesmo nome de produto.
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
                <Button type="submit">{lotToEdit ? 'Salvar alterações' : 'Adicionar lote'}</Button>
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
