
"use client"

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon, Camera, Plus, X, Search } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { type LotEntry, type Kiosk, type Product } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const lotFormSchema = z.object({
  lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
  expiryDate: z.date({ required_error: 'A data de validade é obrigatória.' }),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
  quantity: z.coerce.number().min(0, 'A quantidade não pode ser negativa.'),
  imageUrl: z.string().optional(),
});

type LotFormValues = z.infer<typeof lotFormSchema>;

type AddEditLotModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotToEdit: LotEntry | null;
  kiosks: Kiosk[];
  addLot: (lot: Omit<LotEntry, 'id'>) => void;
  updateLot: (lot: LotEntry) => void;
  lots: LotEntry[]; // Kept for future logic if needed, but not used for prefill now
};

export function AddEditLotModal({ open, onOpenChange, lotToEdit, kiosks, addLot, updateLot }: AddEditLotModalProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const { products, getProductFullName, updateProduct } = useProducts();
  const { toast } = useToast();
  const isEditing = !!lotToEdit;
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [barcodeSearch, setBarcodeSearch] = useState('');

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotFormSchema),
    defaultValues: {
      lotNumber: '',
      expiryDate: undefined,
      kioskId: '',
      quantity: 1,
      imageUrl: '',
    }
  });

  useEffect(() => {
    if (open) {
      if (lotToEdit) {
        const product = products.find(p => p.id === lotToEdit.productId);
        setSelectedProduct(product || null);
        form.reset({
          ...lotToEdit,
          expiryDate: new Date(lotToEdit.expiryDate),
          imageUrl: lotToEdit.imageUrl || product?.imageUrl || '',
        });
      } else {
        form.reset({
            lotNumber: '',
            expiryDate: undefined,
            kioskId: '',
            quantity: 1,
            imageUrl: '',
        });
        setSelectedProduct(null);
        setBarcodeSearch('');
      }
    }
  }, [lotToEdit, open, form, products]);
  
  const onSubmit = async (values: LotFormValues) => {
    if (!selectedProduct && !lotToEdit) {
        toast({ variant: "destructive", title: "Nenhum insumo selecionado", description: "Selecione um insumo para poder registrar um lote." });
        return;
    }
    
    const targetProduct = selectedProduct || products.find(p => p.id === lotToEdit?.productId);
    if (!targetProduct) {
       toast({ variant: "destructive", title: "Erro de Produto", description: "Não foi possível encontrar o insumo associado a este lote." });
       return;
    }
    
    // Logic for updating the product's image URL if it changed in the lot form
    if (values.imageUrl && values.imageUrl !== targetProduct.imageUrl) {
        await updateProduct({ ...targetProduct, imageUrl: values.imageUrl });
    }

    if (lotToEdit) {
        const lotData: Omit<LotEntry, 'id'> = {
            productId: lotToEdit.productId,
            productName: getProductFullName(targetProduct),
            lotNumber: values.lotNumber,
            expiryDate: values.expiryDate.toISOString(),
            kioskId: values.kioskId,
            quantity: values.quantity,
            imageUrl: values.imageUrl || targetProduct.imageUrl,
        };
        await updateLot({ ...lotToEdit, ...lotData });
    } else {
        const lotData: Omit<LotEntry, 'id'> = {
          productId: targetProduct.id,
          productName: getProductFullName(targetProduct),
          lotNumber: values.lotNumber,
          expiryDate: values.expiryDate.toISOString(),
          kioskId: values.kioskId,
          quantity: values.quantity,
          imageUrl: values.imageUrl || targetProduct.imageUrl,
        };
        await addLot(lotData);
    }

    onOpenChange(false);
  };
  
  const handleBarcodeSearch = (barcode: string) => {
    if (!barcode.trim()) return;
    const product = products.find(p => p.barcode === barcode.trim());
    if (product) {
        setSelectedProduct(product);
        form.setValue('imageUrl', product.imageUrl || '');
        toast({ title: "Insumo encontrado!", description: `Insumo "${getProductFullName(product)}" selecionado. Preencha os dados do lote.` });
    } else {
        toast({ variant: "destructive", title: "Insumo não encontrado", description: "Nenhum insumo cadastrado com este código de barras." });
        setSelectedProduct(null);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    setBarcodeSearch(decodedText);
    handleBarcodeSearch(decodedText);
    setIsScannerOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar lote de insumo' : 'Adicionar novo lote ao estoque'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Atualize as informações do lote em estoque.' : 'Primeiro, encontre o insumo pelo código de barras e depois adicione os detalhes do lote.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
                <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4 py-4">

                        {!isEditing && (
                            <div className="space-y-3 p-4 border rounded-lg bg-muted/40">
                                <Label className="text-sm font-medium">1. Encontre o insumo</Label>
                                <div className="flex gap-2">
                                    <div className="relative flex-grow">
                                        <Input
                                            placeholder="Digite o código de barras"
                                            value={barcodeSearch}
                                            onChange={(e) => setBarcodeSearch(e.target.value)}
                                            onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); handleBarcodeSearch(barcodeSearch) }}}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                                            onClick={() => handleBarcodeSearch(barcodeSearch)}
                                        >
                                            <Search className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <Button type="button" variant="outline" onClick={() => setIsScannerOpen(true)}>
                                        <Camera className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                        
                        {(selectedProduct || isEditing) && (
                            <>
                                <div className="p-4 border rounded-lg space-y-4 bg-muted/40">
                                    <h4 className="text-sm font-medium text-muted-foreground">Detalhes do Insumo</h4>
                                     <div className="flex items-start gap-4">
                                          {(selectedProduct?.imageUrl || lotToEdit?.imageUrl) && (
                                            <Image src={selectedProduct?.imageUrl || lotToEdit?.imageUrl || ''} alt="Foto do insumo" width={64} height={64} className="rounded-md object-cover aspect-square" />
                                          )}
                                          <div className="flex-grow">
                                            <p className="font-semibold text-lg">{getProductFullName(selectedProduct || products.find(p => p.id === lotToEdit?.productId) as Product)}</p>
                                            <p className="text-sm text-muted-foreground">Código: {selectedProduct?.barcode || products.find(p => p.id === lotToEdit?.productId)?.barcode || 'N/A'}</p>
                                          </div>
                                      </div>
                                </div>
                                <div className="p-4 border rounded-lg space-y-4">
                                    <h4 className="text-sm font-medium text-muted-foreground">2. Detalhes do Lote</h4>
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
                                                locale={ptBR}
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
                                            <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
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
                            </>
                        )}
                    </div>
                </ScrollArea>

              <DialogFooter className="pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={form.formState.isSubmitting || (!isEditing && !selectedProduct)}>
                  {form.formState.isSubmitting ? "Salvando..." : (isEditing ? 'Salvar alterações' : 'Adicionar lote')}
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

    