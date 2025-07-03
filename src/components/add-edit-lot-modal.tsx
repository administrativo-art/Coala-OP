
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
import { Calendar as CalendarIcon, Camera, Search, Settings, AlertCircle } from 'lucide-react';
import { type LotEntry, type Kiosk, type Product } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StorageLocationManagementModal } from './storage-location-management-modal';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';


const BarcodeScannerModal = dynamic(
  () => import('./barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const lotFormSchema = z.object({
  lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
  expiryDate: z.date({ required_error: 'A data de validade é obrigatória.' }),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
  locationId: z.string().optional(),
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
  lots: LotEntry[];
};

export function AddEditLotModal({ open, onOpenChange, lotToEdit, kiosks, addLot, updateLot }: AddEditLotModalProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const { products, getProductFullName, updateProduct } = useProducts();
  const { locations } = useLocations();
  const { toast } = useToast();
  const isEditing = !!lotToEdit;
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState('');

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
  
  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);
  const selectedKioskId = form.watch('kioskId');
  
  const availableLocations = useMemo(() => {
    if (!selectedKioskId) return [];
    return locations.filter(loc => loc.kioskId === selectedKioskId);
  }, [locations, selectedKioskId]);

  useEffect(() => {
    if (open) {
      if (lotToEdit) {
        const product = products.find(p => p.id === lotToEdit.productId);
        setSelectedProduct(product || null);
        form.reset({
          ...lotToEdit,
          expiryDate: new Date(lotToEdit.expiryDate),
          locationId: lotToEdit.locationId || '',
          imageUrl: lotToEdit.imageUrl || product?.imageUrl || '',
        });
        setProductSearchTerm('');
      } else {
        form.reset({
            lotNumber: '',
            expiryDate: undefined,
            kioskId: '',
            locationId: '',
            quantity: 1,
            imageUrl: '',
        });
        setSelectedProduct(null);
        setProductSearchTerm('');
      }
    }
  }, [lotToEdit, open, form, products]);
  
  const onSubmit = async (values: LotFormValues) => {
    if (!selectedProduct) {
        toast({ variant: "destructive", title: "Nenhum insumo selecionado", description: "Selecione um insumo para poder salvar." });
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
                expiryDate: values.expiryDate.toISOString(),
                locationId: values.locationId || null,
                locationName: location?.name || null,
                locationCode: location?.code || null,
                imageUrl: values.imageUrl || selectedProduct.imageUrl || '',
            };
            await updateLot(updatedLotData);
            toast({ title: "Lote atualizado", description: "As informações do lote foram salvas." });
        } else {
            const newLotData: Omit<LotEntry, 'id'> = {
                productId: selectedProduct.id,
                productName: getProductFullName(selectedProduct),
                lotNumber: values.lotNumber,
                expiryDate: values.expiryDate.toISOString(),
                kioskId: values.kioskId,
                quantity: values.quantity,
                imageUrl: values.imageUrl || selectedProduct.imageUrl || '',
                locationId: values.locationId || null,
                locationName: location?.name || null,
                locationCode: location?.code || null,
            };
            await addLot(newLotData);
            toast({ title: "Lote adicionado", description: "O novo lote foi adicionado ao estoque." });
        }
    
        onOpenChange(false);
    } catch (error) {
        console.error("Failed to save lot:", error);
        toast({
            variant: "destructive",
            title: "Erro ao salvar",
            description: "Não foi possível salvar as informações do lote. Tente novamente."
        });
    }
  };
  
  const handleProductSearch = (term: string) => {
    if (!term.trim()) return;
    const normalizedTerm = term.trim().toLowerCase();
    
    let product = activeProducts.find(p => p.barcode?.toLowerCase() === normalizedTerm);
    
    if (!product) {
      product = activeProducts.find(p => p.baseName.toLowerCase().includes(normalizedTerm));
    }

    if (product) {
        setSelectedProduct(product);
        form.setValue('imageUrl', product.imageUrl || '');
        toast({ title: "Insumo encontrado!", description: `Insumo "${getProductFullName(product)}" selecionado. Preencha os dados do lote.` });
    } else {
        toast({ variant: "destructive", title: "Insumo não encontrado", description: "Nenhum insumo ativo cadastrado com este nome ou código de barras." });
        setSelectedProduct(null);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    setProductSearchTerm(decodedText);
    handleProductSearch(decodedText);
    setIsScannerOpen(false);
  };

  const currentImageUrl = form.watch('imageUrl');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar lote de insumo' : 'Adicionar novo lote ao estoque'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Atualize as informações do lote em estoque.' : 'Primeiro, encontre o insumo e depois adicione os detalhes do lote.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
                <ScrollArea className="h-[60vh] pr-4">
                    <div className="space-y-4 py-4">
                        <div className="space-y-3 p-4 border rounded-lg bg-muted/40">
                            <Label className="text-sm font-medium">{isEditing ? 'Insumo Vinculado' : '1. Encontre o insumo'}</Label>
                            <FormDescription>{isEditing ? 'Para alterar o insumo, use a busca abaixo.' : 'Use a busca para encontrar o insumo pelo nome ou código de barras.'}</FormDescription>
                            <div className="flex gap-2">
                                <div className="relative flex-grow">
                                    <Input
                                        placeholder="Digite o nome ou código de barras"
                                        value={productSearchTerm}
                                        onChange={(e) => setProductSearchTerm(e.target.value)}
                                        onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); handleProductSearch(productSearchTerm) }}}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                                        onClick={() => handleProductSearch(productSearchTerm)}
                                    >
                                        <Search className="h-4 w-4" />
                                    </Button>
                                </div>
                                <Button type="button" variant="outline" onClick={() => setIsScannerOpen(true)}>
                                    <Camera className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {selectedProduct ? (
                            <>
                                <div className="p-4 border rounded-lg space-y-4">
                                    <h4 className="text-sm font-medium text-muted-foreground">Detalhes do Insumo</h4>
                                     <div className="flex items-start gap-4">
                                          {(currentImageUrl || selectedProduct.imageUrl) && (
                                            <Image src={currentImageUrl || selectedProduct.imageUrl || ''} alt="Foto do insumo" width={64} height={64} className="rounded-md object-cover aspect-square" />
                                          )}
                                          <div className="flex-grow">
                                            <p className="font-semibold text-lg">{getProductFullName(selectedProduct)}</p>
                                            <p className="text-sm text-muted-foreground">Código: {selectedProduct.barcode || 'N/A'}</p>
                                            {isEditing && lotToEdit.productId !== selectedProduct.id && (
                                                <p className="text-sm text-primary mt-1">O insumo deste lote será alterado ao salvar.</p>
                                            )}
                                          </div>
                                      </div>
                                </div>
                                <div className="p-4 border rounded-lg space-y-4">
                                    <h4 className="text-sm font-medium text-muted-foreground">{isEditing ? 'Editar detalhes do Lote' : '2. Detalhes do Lote'}</h4>
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
                                                    format(field.value, "dd/MM/yyyy", { locale: ptBR })
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
                                    <FormField
                                        control={form.control}
                                        name="locationId"
                                        render={({ field }) => (
                                            <FormItem>
                                            <FormLabel>Localização (Opcional)</FormLabel>
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
                            <div className="text-center text-muted-foreground py-8">
                                <Search className="h-10 w-10 mx-auto mb-2" />
                                <p>Use a busca acima para encontrar um insumo.</p>
                            </div>
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

    