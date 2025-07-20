

"use client"

import Image from 'next/image';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Pencil, Trash2, Truck, History, QrCode, MinusCircle, Eye } from 'lucide-react';
import { type Kiosk, type LotEntry, type Product, type Location } from '@/types';
import { useMemo, useState } from 'react';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { labelSizes } from '@/lib/label-sizes';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ScrollArea } from './ui/scroll-area';

const DEFAULT_URGENT_THRESHOLD = 7;
const DEFAULT_ALERT_THRESHOLD = 30;

export type GroupedProduct = {
  product: Product;
  lots: LotEntry[];
};

const getStatus = (lot: LotEntry, product?: Product) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expiry = parseISO(lot.expiryDate);
    const daysUntilExpiry = differenceInDays(expiry, now);
    
    const urgentThreshold = product?.urgentThreshold ?? DEFAULT_URGENT_THRESHOLD;
    const alertThreshold = product?.alertThreshold ?? DEFAULT_ALERT_THRESHOLD;

    if (daysUntilExpiry < 0) {
        return { variant: "destructive", text: `Vencido há ${Math.abs(daysUntilExpiry)} dias` };
    }
    if (daysUntilExpiry === 0) {
        return { variant: "destructive", text: 'Vence hoje' };
    }
    if (daysUntilExpiry <= urgentThreshold) {
        return { variant: "destructive", className: 'bg-orange-500 hover:bg-orange-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
    }
    if (daysUntilExpiry <= alertThreshold) {
        return { variant: "secondary", className: 'bg-yellow-500 text-yellow-900 hover:bg-yellow-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
    }
    return { variant: "secondary", className: 'bg-green-100 text-green-800', text: `Vence em ${daysUntilExpiry} dias` };
};

type ConsumeLotModalProps = {
  lot: LotEntry;
  onClose: () => void;
  onConfirm: (params: { lotId: string; quantityToConsume: number; type: 'SAIDA_CONSUMO' | 'SAIDA_DESCARTE' | 'SAIDA_CORRECAO'; notes?: string }) => void;
};

function ConsumeLotModal({ lot, onClose, onConfirm }: ConsumeLotModalProps) {
  const formSchema = z.object({
    quantity: z.coerce.number().min(0.01, "A quantidade deve ser positiva.").max(lot.quantity, `Máximo: ${lot.quantity}`),
    type: z.enum(['SAIDA_CONSUMO', 'SAIDA_DESCARTE'], { required_error: 'Selecione o tipo de baixa.'}),
    notes: z.string().optional(),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { quantity: 1, type: 'SAIDA_CONSUMO', notes: '' },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    onConfirm({ lotId: lot.id, quantityToConsume: values.quantity, type: values.type, notes: values.notes });
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar baixa do lote</DialogTitle>
          <DialogDescription>
            Registrando baixa para {lot.productName} (lote: {lot.lotNumber}). Disponível: {lot.quantity}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem className="space-y-3">
                    <FormLabel>Tipo de baixa</FormLabel>
                     <FormControl>
                        <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-4">
                            <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="SAIDA_CONSUMO" /></FormControl><Label className="font-normal">Consumo / Venda</Label></FormItem>
                            <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="SAIDA_DESCARTE" /></FormControl><Label className="font-normal">Descarte / Perda</Label></FormItem>
                        </RadioGroup>
                     </FormControl>
                </FormItem>
            )}/>
            <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantidade a ser baixada</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações (opcional)</FormLabel>
                  <FormControl><Textarea placeholder="Ex: Baixa por quebra, etc." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit">Confirmar baixa</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}


type LotCardProps = {
  productGroup: GroupedProduct;
  getProductFullName: (product: Product) => string;
  kiosks: Kiosk[];
  locations: Location[];
  onEdit: (lotId: string) => void;
  onMove: (lotId: string) => void;
  onDelete: (lotId: string) => void;
  onViewHistory: (lot: LotEntry) => void;
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canViewHistory: boolean;
};

export function LotCard({
    productGroup,
    getProductFullName,
    kiosks,
    locations,
    onEdit,
    onMove,
    onDelete,
    onViewHistory,
    canEdit,
    canMove,
    canDelete,
    canViewHistory,
}: LotCardProps) {
  const { labelSizeId } = useCompanySettings();
  const { consumeFromLot } = useExpiryProducts();
  const [lotToConsume, setLotToConsume] = useState<LotEntry | null>(null);

  const handleConsumeClick = (lot: LotEntry) => {
    setLotToConsume(lot);
  };

  const handleConfirmConsumption = (params: { lotId: string; quantityToConsume: number; type: 'SAIDA_CONSUMO' | 'SAIDA_DESCARTE' | 'SAIDA_CORRECAO'; notes?: string }) => {
    consumeFromLot(params);
    setLotToConsume(null);
  };
  
  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name || 'Quiosque desconhecido';
  const getLocationName = (id: string | null | undefined) => id ? locations.find(l => l.id === id)?.name : null;

  const { product } = productGroup;
  
  const handlePrintLabel = async (lot: LotEntry, product: Product) => {
    const selectedSize = labelSizes.find(s => s.id === labelSizeId) || labelSizes.find(s => s.id === '6080') || labelSizes[0];
    
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [selectedSize.width, selectedSize.height]
    });

    const margin = 2;
    const availableWidth = selectedSize.width - 2 * margin;
    const availableHeight = selectedSize.height - 2 * margin;
    const qrCodeSize = Math.min(availableHeight, availableWidth * 0.3);
    const qrCodeX = selectedSize.width - qrCodeSize - margin;
    const qrCodeY = (selectedSize.height - qrCodeSize) / 2;

    try {
      const url = `${window.location.origin}/dashboard/stock/inventory-control?lotId=${lot.id}`;
      const qrCodeDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 1, width: 256 });
      doc.addImage(qrCodeDataUrl, 'PNG', qrCodeX, qrCodeY, qrCodeSize, qrCodeSize);
    } catch (err) {
      console.error("Failed to generate QR Code", err);
    }

    const textBlockWidth = availableWidth - qrCodeSize - margin;
    const separatorX = qrCodeX - margin / 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(separatorX, margin, separatorX, selectedSize.height - margin);

    let currentY = margin + 4;
    
    const productName = getProductFullName(product);
    const lotNumber = lot.lotNumber;
    const expiryDate = format(parseISO(lot.expiryDate), "dd/MM/yyyy");
    const kioskName = getKioskName(lot.kioskId);
    const locationName = getLocationName(lot.locationId);

    const locationText = locationName ? `${kioskName} / ${locationName}` : kioskName;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(productName, margin, currentY, { maxWidth: textBlockWidth - margin });
    currentY += doc.getTextDimensions(productName, { maxWidth: textBlockWidth - margin }).h + 3;

    doc.setFont('helvetica', 'normal');
    doc.text(`Lote: ${lotNumber}`, margin, currentY);
    currentY += 4;
    
    const locationDimensions = doc.getTextDimensions(locationText, { maxWidth: textBlockWidth - margin });
    doc.text(locationText, margin, currentY, { maxWidth: textBlockWidth - margin });
    currentY += locationDimensions.h + 4; 
    
    doc.text(`Validade: ${expiryDate}`, margin, currentY, { maxWidth: textBlockWidth - margin });

    doc.save(`etiqueta_${productName.replace(/ /g,"_")}_${lotNumber}.pdf`);
  };

  const renderActionButton = (lot: LotEntry, Icon: React.ElementType, tooltip: string, action: () => void, permission: boolean, destructive = false) => {
    if (!permission) return null;
    return (
        <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-7 w-7 ${destructive ? 'text-destructive hover:text-destructive' : ''}`} onClick={action}>
                <Icon className="h-4 w-4" />
            </Button>
        </TooltipTrigger><TooltipContent><p>{tooltip}</p></TooltipContent></Tooltip></TooltipProvider>
    );
  };

  return (
    <>
    <div className="w-full border rounded-lg bg-card shadow-sm">
        {/* Card Header */}
        <div className="p-4 flex items-start gap-4">
            {product.imageUrl && (
                <div className="w-16 h-16 rounded-md bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                    <Image src={product.imageUrl} alt={`Foto de ${product.baseName}`} width={64} height={64} className="object-cover" />
                </div>
            )}
            <div className="flex-grow">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg">{product.baseName}</h3>
                     <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                <Eye className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                            <h4 className="font-medium text-center mb-2">Próximos Lotes</h4>
                            <ScrollArea className="h-48">
                                <div className="space-y-2">
                                    {productGroup.lots.slice(0, 4).map(lot => (
                                        <div key={lot.id} className="p-2 border rounded-md text-sm">
                                            <p className="font-semibold">Lote: {lot.lotNumber}</p>
                                            <p className="text-muted-foreground">Qtd: {lot.quantity} | Val: {format(parseISO(lot.expiryDate), 'dd/MM/yyyy')}</p>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </PopoverContent>
                    </Popover>
                </div>
                <p className="text-sm text-muted-foreground">{product.brand || 'Sem marca'} - {product.packageSize}{product.unit}</p>
            </div>
        </div>

        {/* Lots Details */}
        <div className="px-4 pb-4 space-y-2">
            {productGroup.lots.map(lot => {
                const locationName = getLocationName(lot.locationId);
                const status = getStatus(lot, product);
                return (
                    <div key={lot.id} id={`lot-instance-${lot.id}`} className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 border rounded-md bg-muted/50">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold">Lote: {lot.lotNumber}</p>
                                <Badge variant={status.variant as any} className={status.className}>
                                    {status.text}
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{getKioskName(lot.kioskId)}{locationName && ` / ${locationName}`}</p>
                            <p className="text-xs text-muted-foreground">Val: {format(parseISO(lot.expiryDate), 'dd/MM/yyyy')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="text-center p-2 rounded-md bg-background w-24">
                                <div className="text-2xl font-bold">{lot.quantity}</div>
                                <div className="text-xs text-muted-foreground">unidades</div>
                            </div>
                            <div className="flex flex-col gap-0.5 border-l pl-1">
                                {renderActionButton(lot, Pencil, "Editar", () => onEdit(lot.id), canEdit)}
                                {renderActionButton(lot, MinusCircle, "Baixa/Consumo", () => handleConsumeClick(lot), canEdit)}
                                {renderActionButton(lot, Truck, "Mover", () => onMove(lot.id), canMove && lot.quantity > 0)}
                                {renderActionButton(lot, History, "Histórico", () => onViewHistory(lot), canViewHistory)}
                                {renderActionButton(lot, QrCode, "Imprimir Etiqueta", () => handlePrintLabel(lot, product), true)}
                                {renderActionButton(lot, Trash2, "Excluir", () => onDelete(lot.id), canDelete, true)}
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    </div>
    {lotToConsume && (
      <ConsumeLotModal
        lot={lotToConsume}
        onClose={() => setLotToConsume(null)}
        onConfirm={handleConfirmConsumption}
      />
    )}
    </>
  );
}
