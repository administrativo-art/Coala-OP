
"use client"

import { useState, useEffect, useMemo } from 'react';
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
import { Calendar as CalendarIcon, Camera, Settings, AlertCircle, Info, X } from 'lucide-react';
import { type LotEntry, type Kiosk, type Product, type BaseProduct } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { useBaseProducts } from '@/hooks/use-base-products';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StorageLocationManagementModal } from './storage-location-management-modal';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/use-auth';


const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const lotFormSchema = z.object({
  lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
  expiryDate: z.date().optional().nullable(),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
  locationId: z.string().optional(),
  quantity: z.coerce.number().min(0.01, 'A quantidade deve ser maior que zero.'),
  imageUrl: z.string().optional(),
});

type LotFormValues = z.infer<typeof lotFormSchema>;

type AddEditLotModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotToEdit: LotEntry | null;
  kiosks: Kiosk[];
  addLot: (lot: Omit<LotEntry, 'id'>, user: any) => void;
  updateLot: (lot: LotEntry) => void;
  lots: LotEntry[];
};

export function AddEditLotModal({ open, onOpenChange, lotToEdit, kiosks, addLot, updateLot }: AddEditLotModalProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const { products, getProductFullName, updateProduct } = useProducts();
  const { locations } = useLocations();
  const { baseProducts } = useBaseProducts();
  const { user } = useAuth();
  const isEditing = !!lotToEdit;
  
  const [selectedBaseProductId, setSelectedBaseProductId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotFormSchema),
    defaultValues: {
      lotNumber: '',
      expiryDate: undefined,
      kioskId: '',
      locationId: '',
      quantity: 1,
      imageUrl: '',
    }
  });
  
  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId) || null;
  }, [products, selectedProductId]);

  const selectedKioskId = form.watch('kioskId');
  
  const availableLocations = useMemo(() => {
    if (!selectedKioskId) return [];
    return locations.filter(loc => loc.kioskId === selectedKioskId);
  }, [locations, selectedKioskId]);

  const linkedProducts = useMemo(() => {
    if (!selectedBaseProductId) return [];
    return products.filter(p => p.baseProductId === selectedBaseProductId && !p.isArchived);
  }, [products, selectedBaseProductId]);

  const handleBaseProductChange = (baseId: string) => {
    setSelectedBaseProductId(baseId);
    setSelectedProductId(null); // Reset product selection
  };

  const handleProductChange = (productId: string) => {
    setSelectedProductId(productId);
    const product = products.find(p => p.id === productId);
    if (product) {
        form.setValue('imageUrl', product.imageUrl || '');
    }
  };

  useEffect(() => {
    if (open) {
      if (lotToEdit) {
        const product = products.find(p => p.id === lotToEdit.productId);
        setSelectedBaseProductId(product?.baseProductId || null);
        setSelectedProductId(lotToEdit.productId);
        form.reset({
          ...lotToEdit,
          expiryDate: lotToEdit.expiryDate ? new Date(lotToEdit.expiryDate) : null,
          locationId: lotToEdit.locationId || '',
          imageUrl: lotToEdit.imageUrl || product?.imageUrl || '',
        });
      } else {
        form.reset({
            lotNumber: '',
            expiryDate: undefined,
            kioskId: '',
            locationId: '',
            quantity: 1,
            imageUrl: '',
        });
        setSelectedBaseProductId(null);
        setSelectedProductId(null);
      }
    }
  }, [lotToEdit, open, form, products]);
  
  const onSubmit = async (values: LotFormValues) => {
    if (!selectedProduct || !user) {
        return;
    }

    try {
        const location = locations.find(l => l.id === values.locationId);
        
        if (values.imageUrl && values.imageUrl !== selectedProduct.imageUrl) {
            await updateProduct({ ...selectedProduct, imageUrl: values.imageUrl });
        }

        if (lotToEdit) {
            const updatedLotData: LotEntry = {
                ...lotToEdit,
                ...values,
                productId: selectedProduct.id,
                productName: getProductFullName(selectedProduct),
                expiryDate: values.expiryDate ? values.expiryDate.toISOString() : null,
                locationId: values.locationId || null,
                locationName: location?.name || null,
                locationCode: location?.code || null,
                imageUrl: values.imageUrl || selectedProduct.imageUrl || '',
            };
            await updateLot(updatedLotData);
        } else {
            const newLotData: Omit<LotEntry, 'id'> = {
                productId: selectedProduct.id,
                productName: getProductFullName(selectedProduct),
                lotNumber: values.lotNumber,
                expiryDate: values.expiryDate ? values.expiryDate.toISOString() : null,
                kioskId: values.kioskId,
                quantity: values.quantity,
                imageUrl: values.imageUrl || selectedProduct.imageUrl || '',
                locationId: values.locationId || null,
                locationName: location?.name || null,
                locationCode: location?.code || null,
            };
            await addLot(newLotData, user);
        }
    
        onOpenChange(false);
    } catch (error) {
        console.error("Failed to save lot:", error);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    setIsScannerOpen(false);
    const product = products.find(p => p.barcode === decodedText && !p.isArchived);
    if (product) {
        setSelectedBaseProductId(product.baseProductId || null);
        // Timeout to allow linkedProducts to update
        setTimeout(() => {
            setSelectedProductId(product.id);
            form.setValue('imageUrl', product.imageUrl || '');
        }, 100);
    } else {
        alert("Nenhum insumo encontrado para este código de barras.");
    }
  };

  const currentImageUrl = form.watch('imageUrl');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar lote de insumo' : 'Adicionar novo lote ao estoque'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Atualize as informações do lote em estoque.' : 'Selecione o insumo e adicione os detalhes do lote.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
                <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4 py-4">
                        <div className="space-y-3 p-4 border rounded-lg bg-muted/40">
                             <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">1. Selecione o insumo</Label>
                                <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsScannerOpen(true)}>
                                    <Camera className="h-4 w-4" />
                                </Button>
                             </div>
                             <FormDescription>Selecione primeiro o insumo base e depois a variação.</FormDescription>
                            
                            <Select onValueChange={handleBaseProductChange} value={selectedBaseProductId || ''}>
                                <SelectTrigger><SelectValue placeholder="Selecione o insumo base..."/></SelectTrigger>
                                <SelectContent>
                                    {baseProducts.map(bp => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}
                                </SelectContent>
                            </Select>

                             <Select onValueChange={handleProductChange} value={selectedProductId || ''} disabled={!selectedBaseProductId || linkedProducts.length === 0}>
                                <SelectTrigger><SelectValue placeholder="Selecione a variação..."/></SelectTrigger>
                                <SelectContent>
                                    {linkedProducts.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedProduct ? (
                            <>
                                <div className="p-4 border rounded-lg space-y-4">
                                    <h4 className="text-sm font-medium text-muted-foreground">{isEditing ? 'Editar detalhes do lote' : '2. Detalhes do lote'}</h4>
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
                                                    <div className="relative">
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
                                                            <span>Indefinida</span>
                                                            )}
                                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                        {field.value && (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="absolute right-10 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-destructive"
                                                                onClick={() => field.onChange(null)}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                mode="single"
                                                selected={field.value ?? undefined}
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
                                                <div className="flex items-center gap-1.5">
                                                    <FormLabel>Quantidade</FormLabel>
                                                    {(selectedProduct.countingInstruction || selectedProduct.countingInstructionImageUrl) && (
                                                         <Popover>
                                                            <PopoverTrigger asChild>
                                                                <button type="button" onClick={(e) => e.preventDefault()} className="flex items-center">
                                                                    <Info className="h-4 w-4 text-muted-foreground" />
                                                                </button>
                                                            </PopoverTrigger>
                                                            <PopoverContent>
                                                                <div className="space-y-2">
                                                                    <p className="font-semibold">Instrução de Contagem</p>
                                                                    {selectedProduct.countingInstruction && <p className="text-sm text-muted-foreground">{selectedProduct.countingInstruction}</p>}
                                                                    {selectedProduct.countingInstructionImageUrl && (
                                                                        <div className="mt-2">
                                                                            <Image src={selectedProduct.countingInstructionImageUrl} alt="Instrução visual" width={200} height={200} className="rounded-md object-contain"/>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>
                                                    )}
                                                </div>
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
                                    <FormField
                                        control={form.control}
                                        name="locationId"
                                        render={({ field }) => (
                                            <FormItem>
                                            <FormLabel>Localização (opcional)</FormLabel>
                                            <div className="flex gap-2 items-center">
                                                <Select onValueChange={field.onChange} value={field.value || ''} disabled={!selectedKioskId}>
                                                    <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione o local" />
                                                    </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                    {availableLocations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name} {loc.code && `(${loc.code})`}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <Button type="button" variant="outline" size="icon" onClick={() => setIsLocationModalOpen(true)}>
                                                    <Settings className="h-4 w-4"/>
                                                </Button>
                                            </div>
                                            <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </>
                        ) : isEditing ? (
                             <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Insumo não encontrado!</AlertTitle>
                                <AlertDescription>
                                    O insumo original deste lote foi removido ou arquivado. Por favor, pesquise e selecione um novo insumo ativo para vincular a este lote.
                                </AlertDescription>
                            </Alert>
                        ) : (
                           null
                        )}
                    </div>
                </ScrollArea>

              <DialogFooter className="pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={form.formState.isSubmitting || !selectedProduct}>
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
       <StorageLocationManagementModal
        open={isLocationModalOpen}
        onOpenChange={setIsLocationModalOpen}
        kiosks={kiosks}
      />
    </>
  );
}
