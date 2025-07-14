
"use client"

import Image from 'next/image';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Pencil, Trash2, Truck, History, Eraser, Package, Barcode, Warehouse, MapPin, Calendar, Hash, Tag } from 'lucide-react';
import { type Kiosk, type LotEntry, type Product, type Location } from '@/types';
import { useMemo } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';

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
        return { color: 'bg-red-600 hover:bg-red-700', text: `Vencido há ${Math.abs(daysUntilExpiry)} dias` };
    }
    if (daysUntilExpiry === 0) {
        return { color: 'bg-red-600 hover:bg-red-700', text: 'Vence hoje' };
    }
    if (daysUntilExpiry <= urgentThreshold) {
        return { color: 'bg-orange-500 hover:bg-orange-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
    }
    if (daysUntilExpiry <= alertThreshold) {
        return { color: 'bg-yellow-500 hover:bg-yellow-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
    }
    return { color: 'bg-green-600 hover:bg-green-700', text: `Vence em ${daysUntilExpiry} dias` };
};

type LotCardProps = {
  productGroup: GroupedProduct;
  getProductFullName: (product: Product) => string;
  kiosks: Kiosk[];
  locations: Location[];
  onEdit: (lotId: string) => void;
  onMove: (lotId: string) => void;
  onDelete: (lotId: string) => void;
  onViewHistory: (lot: LotEntry) => void;
  onZeroOut: (lot: LotEntry) => void;
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
    onZeroOut,
    canEdit,
    canMove,
    canDelete,
    canViewHistory,
}: LotCardProps) {
  
  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name || 'Quiosque desconhecido';
  const getLocationName = (id: string | null | undefined) => id ? locations.find(l => l.id === id)?.name : null;

  const totalQuantity = useMemo(() => {
    return productGroup.lots.reduce((acc, lot) => acc + lot.quantity, 0);
  }, [productGroup.lots]);

  const lotsGroupedByNumber = useMemo(() => {
    const groups: { [lotNumber: string]: LotEntry[] } = {};
    productGroup.lots.forEach(lot => {
        if (!groups[lot.lotNumber]) {
            groups[lot.lotNumber] = [];
        }
        groups[lot.lotNumber].push(lot);
    });
    return Object.values(groups);
  }, [productGroup.lots]);

  const { product } = productGroup;

  return (
    <Card className="w-full">
      <CardHeader className="p-4 flex flex-row items-center gap-4">
        {product.imageUrl && (
            <div className="w-20 h-20 rounded-md bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                <Image src={product.imageUrl} alt={`Foto de ${product.baseName}`} width={80} height={80} className="object-cover" />
            </div>
        )}
        <div className="flex-grow">
            <CardTitle className="text-xl">
                {getProductFullName(product)}
            </CardTitle>
            <CardDescription className="mt-1">
                Quantidade Total em Estoque: <span className="font-bold text-foreground">{totalQuantity}</span>
            </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {lotsGroupedByNumber.length > 0 ? (
            <Accordion type="multiple" defaultValue={lotsGroupedByNumber.map(group => group[0].lotNumber)} className="w-full space-y-3">
                {lotsGroupedByNumber.map((lotGroup, index) => {
                    const representativeLot = lotGroup[0];
                    const status = getStatus(representativeLot, product);
                    const sortedLotGroup = [...lotGroup].sort((a, b) => {
                        if (a.kioskId === 'matriz' && b.kioskId !== 'matriz') return -1;
                        if (a.kioskId !== 'matriz' && b.kioskId === 'matriz') return 1;
                        return getKioskName(a.kioskId).localeCompare(getKioskName(b.kioskId));
                    });

                    return (
                        <AccordionItem value={representativeLot.lotNumber} key={`${representativeLot.lotNumber}-${index}`} className="border-none">
                            <Card className="bg-muted/30 overflow-hidden">
                                <AccordionTrigger className="p-4 hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-x-4 gap-y-2 text-sm w-full text-left">
                                            <div className="flex items-center gap-2 font-semibold"><Tag className="h-4 w-4 text-primary"/> Lote: {representativeLot.lotNumber}</div>
                                            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-primary"/> Validade: {format(parseISO(representativeLot.expiryDate), "dd/MM/yyyy")}</div>
                                            <div className="flex items-center gap-2"><Hash className="h-4 w-4 text-primary"/> Medida: {product ? `${product.packageSize}${product.unit}` : 'N/A'}</div>
                                        </div>
                                        <Badge className={`ml-4 text-white text-xs ${status.color}`}>{status.text}</Badge>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-0">
                                   <div className="px-4 pb-4 space-y-2">
                                    {sortedLotGroup.map(lotInstance => {
                                        const locationName = getLocationName(lotInstance.locationId);
                                        return (
                                            <div key={lotInstance.id} className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 border rounded-md bg-background">
                                                <div className="grid grid-cols-2 gap-x-4 text-sm">
                                                    <div className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary"/> {getKioskName(lotInstance.kioskId)}</div>
                                                    <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary"/> {locationName || 'N/A'}</div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex flex-col items-center justify-center p-2 bg-muted rounded-md w-32 text-center">
                                                        <div className="text-3xl font-bold">{lotInstance.quantity}</div>
                                                        <div className="text-muted-foreground text-xs">unidades</div>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        {canViewHistory && (
                                                            <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => onViewHistory(lotInstance)}><History className="h-4 w-4" /></Button>
                                                            </TooltipTrigger><TooltipContent><p>Histórico</p></TooltipContent></Tooltip></TooltipProvider>
                                                        )}
                                                        {canMove && lotInstance.quantity > 0 && (
                                                            <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMove(lotInstance.id)}><Truck className="h-4 w-4" /></Button>
                                                            </TooltipTrigger><TooltipContent><p>Mover</p></TooltipContent></Tooltip></TooltipProvider>
                                                        )}
                                                        {canEdit && (
                                                            <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(lotInstance.id)}><Pencil className="h-4 w-4" /></Button>
                                                            </TooltipTrigger><TooltipContent><p>Editar</p></TooltipContent></Tooltip></TooltipProvider>
                                                        )}
                                                        {canDelete && (
                                                            <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive h-7 w-7" onClick={() => onDelete(lotInstance.id)}><Trash2 className="h-4 w-4" /></Button>
                                                            </TooltipTrigger><TooltipContent><p>Excluir</p></TooltipContent></Tooltip></TooltipProvider>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                   </div>
                                </AccordionContent>
                            </Card>
                        </AccordionItem>
                    )
                })}
            </Accordion>
        ) : <p className="text-sm text-center text-muted-foreground">Nenhum lote para este insumo.</p>
        }
      </CardContent>
    </Card>
  );
}

    