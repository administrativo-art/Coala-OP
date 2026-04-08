
"use client"

import Image from 'next/image';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Pencil, Trash2, Truck, History, QrCode, MinusCircle, Eye, LineChart, Shield, Database, Copy } from 'lucide-react';
import { type Kiosk, type LotEntry, type Product, type Location, type BaseProduct, type RepositionActivity, type MovementType, type RepositionItem, type RepositionSuggestedLot } from '@/types';
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
import { formatQuantity } from '@/lib/conversion';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useRouter } from 'next/navigation';
import { QuickProjectionModal } from './quick-projection-modal';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useReposition } from '@/hooks/use-reposition';

const DEFAULT_URGENT_THRESHOLD = 7;
const DEFAULT_ALERT_THRESHOLD = 30;

export type GroupedProduct = {
  product: Product;
  lots: LotEntry[];
};

const getStatus = (lot: LotEntry, product?: Product) => {
    if (!lot.expiryDate) {
        return { variant: "secondary", text: 'Validade indefinida' };
    }
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
  onConfirm: (params: { lotId: string; quantityToConsume: number; type: MovementType; notes?: string }) => void;
};

function ConsumeLotModal({ lot, onClose, onConfirm }: ConsumeLotModalProps) {
  const formSchema = z.object({
    quantity: z.coerce.number().min(0.01, "A quantidade deve ser positiva.").max(lot.quantity, `Máximo: ${lot.quantity}`),
    type: z.custom<MovementType>(val => typeof val === 'string', 'Selecione um tipo válido'),
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
            Registrando baixa para {lot.productName} (lote: {lot.lotNumber}). Disponível: {lot.quantity.toLocaleString('pt-BR')}.
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
                            <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="SAIDA_DESCARTE_AVARIA" /></FormControl><Label className="font-normal">Descarte / Perda</Label></FormItem>
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
}: LotCardProps) {
  const { permissions } = useAuth();
  const canEdit = permissions.stock.inventoryControl.editLot;
  const canMove = permissions.stock.inventoryControl.transfer;
  const canDelete = permissions.stock.inventoryControl.writeDown;
  
  const { labelSizeId } = useCompanySettings();
  const { consumeFromLot } = useExpiryProducts();
  const { activities } = useReposition();
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [lotToConsume, setLotToConsume] = useState<LotEntry | null>(null);

  const handleConsumeClick = (lot: LotEntry) => {
    setLotToConsume(lot);
  };

  const handleConfirmConsumption = (params: { lotId: string; quantityToConsume: number; type: MovementType; notes?: string }) => {
    if (!user) {
        toast({ variant: 'destructive', title: 'Erro de autenticação', description: 'Usuário não encontrado para registrar a baixa.' });
        return;
    }
    consumeFromLot(params, user);
    setLotToConsume(null);
  };
  
  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name || 'Quiosque desconhecido';
  const getLocationName = (id: string | null | undefined) => id ? locations.find(l => l.id === id)?.name : null;

  const { product } = productGroup;
  
  const handlePrintLabel = async (lot: LotEntry, product: Product) => {
    toast({ title: "Função de etiqueta em manutenção." });
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast({ title: "ID do Lote Copiado!" });
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
  
  const getReservationDetails = (lot: LotEntry) => {
      const reservationDetails: { [kioskName: string]: number } = {};
      let totalCalculated = 0;

      const relevantActivities = activities.filter(act => 
        (act.status === 'Aguardando despacho' || act.status === 'Aguardando recebimento') &&
        act.items.some(item => 
          item.suggestedLots.some(sl => sl.lotId === lot.id)
        )
      );

      relevantActivities.forEach(act => {
        act.items.forEach(item => {
          item.suggestedLots.forEach(sl => {
            if (sl.lotId === lot.id) {
              const destName = act.kioskDestinationName.split(' ')[1] || act.kioskDestinationName;
              reservationDetails[destName] = (reservationDetails[destName] || 0) + sl.quantityToMove;
              totalCalculated += sl.quantityToMove;
            }
          });
        });
      });

      const detailText = Object.entries(reservationDetails)
        .map(([name, qty]) => `${name}: ${qty}`)
        .join(', ');

      return {
        text: detailText || (totalCalculated > 0 ? 'em processamento' : null),
        totalQty: totalCalculated
      };
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
                    <h3 className="font-semibold text-lg">{getProductFullName(product)}</h3>
                    {product.isArchived && (
                      <Badge variant="secondary" className="text-xs text-muted-foreground">Desativado</Badge>
                    )}
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
                                            <div className="font-semibold flex justify-between">
                                                <span>Lote: {lot.lotNumber}</span>
                                                <Badge variant={getStatus(lot, product).variant as any} className={getStatus(lot, product).className}>{getStatus(lot, product).text}</Badge>
                                            </div>
                                            <p className="text-muted-foreground">Qtd: {lot.quantity.toLocaleString('pt-BR')} | Val: {lot.expiryDate ? format(parseISO(lot.expiryDate), 'dd/MM/yyyy') : 'N/A'}</p>
                                            <p className="text-xs text-muted-foreground">{getKioskName(lot.kioskId)}</p>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p><strong>Unidade de medida:</strong> {product.unit}</p>
                    <p><strong>Embalagem de conteúdo:</strong> {product.packageType} com {product.packageSize}{product.unit}</p>
                    {product.multiplo_caixa && product.rotulo_caixa && (
                        <p><strong>Embalagem de agrupamento:</strong> 1 {product.rotulo_caixa} = {product.multiplo_caixa} {product.packageType ? `${product.packageType}(s)` : 'unidades'}</p>
                    )}
                </div>
            </div>
        </div>

        {/* Lots Details */}
        <div className="px-4 pb-4 space-y-2">
            {productGroup.lots.map(lot => {
                const locationName = getLocationName(lot.locationId);
                const status = getStatus(lot, product);
                const { text: reservationInfo, totalQty: derivedReservedQty } = getReservationDetails(lot);
                const displayReservedQty = Math.max(lot.reservedQuantity || 0, derivedReservedQty);
                
                let totalUnits: number;
                let totalUnitsLabel: string;
                let isRedundant = false;

                totalUnits = lot.quantity * product.packageSize;
                totalUnitsLabel = product.unit;
                
                if (totalUnits === lot.quantity && (totalUnitsLabel.toLowerCase() === 'un' || totalUnitsLabel.toLowerCase() === 'unidade')) {
                  isRedundant = true;
                }

                let totalBoxes = null;
                let boxLabel = '';
                if (product.multiplo_caixa && product.multiplo_caixa > 0 && product.rotulo_caixa) {
                    totalBoxes = lot.quantity / product.multiplo_caixa;
                    boxLabel = product.rotulo_caixa;
                }

                return (
                    <div key={lot.id} id={`lot-instance-${lot.id}`} className="grid grid-cols-1 items-center gap-4 p-3 border rounded-md bg-muted/50">
                        <div className="flex justify-between items-start">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="font-semibold flex items-center gap-1">
                                        Lote: {lot.lotNumber}
                                    {user?.username === 'Tiago Brasil' && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger>
                                                    <div className="flex items-center gap-1 cursor-pointer" onClick={() => handleCopyId(lot.id)}>
                                                        <Database className="h-3 w-3 text-muted-foreground" />
                                                        <Copy className="h-3 w-3 text-muted-foreground" />
                                                    </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="flex items-center gap-2">
                                                        <p className="font-mono text-xs">{lot.id}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}
                                    </div>
                                    <Badge variant={status.variant as any} className={status.className}>
                                        {status.text}
                                    </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                                    <p><strong>Local:</strong> {getKioskName(lot.kioskId)}{locationName && ` / ${locationName}`}</p>
                                    {lot.expiryDate && <p><strong>Validade:</strong> {format(parseISO(lot.expiryDate), 'dd/MM/yyyy')}</p>}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {isRedundant ? (
                                    <div className="text-center p-2 rounded-md bg-background w-28">
                                        <div className="text-2xl font-bold">{lot.quantity.toLocaleString('pt-BR')}</div>
                                        <div className="text-xs text-muted-foreground">unidades</div>
                                    </div>
                                ) : (
                                    <>
                                    <div className="text-center p-2 rounded-md bg-background w-28">
                                        <div className="text-2xl font-bold">{formatQuantity(totalUnits, totalUnitsLabel)}</div>
                                        <div className="text-xs text-muted-foreground">{totalUnitsLabel}</div>
                                    </div>
                                    <div className="text-center p-2 rounded-md bg-background w-24">
                                        <div className="text-2xl font-bold">{lot.quantity.toLocaleString('pt-BR')}</div>
                                        <div className="text-xs text-muted-foreground">{product.packageType || 'pct'}</div>
                                    </div>
                                    </>
                                )}
                                {totalBoxes !== null && (
                                    <div className="text-center p-2 rounded-md bg-background w-24">
                                        <div className="text-2xl font-bold">{totalBoxes.toLocaleString('pt-BR', {maximumFractionDigits: 1})}</div>
                                        <div className="text-xs text-muted-foreground">{boxLabel}</div>
                                    </div>
                                )}
                                <div className="flex flex-col gap-0.5 border-l pl-1 h-full justify-around">
                                    {renderActionButton(lot, Pencil, "Editar", () => onEdit(lot.id), canEdit)}
                                    {renderActionButton(lot, QrCode, "Imprimir Etiqueta", () => handlePrintLabel(lot, product), true)}
                                    {renderActionButton(lot, Trash2, "Excluir", () => onDelete(lot.id), canDelete, true)}
                                </div>
                            </div>
                        </div>

                         {displayReservedQty > 0 && (
                            <div className="mt-2 pt-2 border-t border-dashed">
                               <div className="text-blue-600 font-bold flex items-center gap-1">
                                    <Shield className="h-3 w-3"/>
                                    Reserva Ativa: {displayReservedQty} 
                                    {reservationInfo && (
                                    <span className="text-xs font-normal text-muted-foreground">({reservationInfo})</span>
                                    )}
                                </div>
                            </div>
                        )}
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
