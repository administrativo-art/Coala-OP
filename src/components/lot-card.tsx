
"use client"

import Image from 'next/image';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Pencil, Trash2, Truck, History, Eraser, Info, Package, Barcode, Warehouse, MapPin, Calendar, Hash } from 'lucide-react';
import { type Kiosk, type LotEntry, type Product, type Location } from '@/types';

const DEFAULT_URGENT_THRESHOLD = 7;
const DEFAULT_ALERT_THRESHOLD = 30;

export type GroupedProduct = {
  productBaseName: string;
  lots: LotEntry[];
};

type LotCardProps = {
  groupedProduct: GroupedProduct;
  products: Product[];
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
    groupedProduct,
    products,
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

  const getProductForTitle = () => {
      const firstLot = groupedProduct.lots[0];
      if (!firstLot) return null;
      return products.find(p => p.id === firstLot.productId);
  };

  const productForTitle = getProductForTitle();

  return (
    <Card className="w-full">
      <CardHeader className="p-4">
        <CardTitle className="text-xl">
            {productForTitle ? getProductFullName(productForTitle) : groupedProduct.productBaseName}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {groupedProduct.lots.map(lot => {
          const product = products.find(p => p.id === lot.productId);
          if (!product) return null;

          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const expiry = parseISO(lot.expiryDate);
          const daysUntilExpiry = differenceInDays(expiry, now);
          
          const urgentThreshold = product.urgentThreshold ?? DEFAULT_URGENT_THRESHOLD;
          const alertThreshold = product.alertThreshold ?? DEFAULT_ALERT_THRESHOLD;

          let status: { color: string, text: string };
            if (daysUntilExpiry < 0) {
                status = { color: 'bg-red-600 hover:bg-red-700', text: `Vencido há ${Math.abs(daysUntilExpiry)} dias` };
            } else if (daysUntilExpiry === 0) {
                status = { color: 'bg-red-600 hover:bg-red-700', text: 'Vence hoje' };
            } else if (daysUntilExpiry <= urgentThreshold) {
                status = { color: 'bg-orange-500 hover:bg-orange-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
            } else if (daysUntilExpiry <= alertThreshold) {
                status = { color: 'bg-yellow-500 hover:bg-yellow-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
            } else {
                status = { color: 'bg-green-600 hover:bg-green-700', text: `Vence em ${daysUntilExpiry} dias` };
            }
          
          const locationName = getLocationName(lot.locationId);
          
          return (
            <Card key={lot.id} className="bg-muted/50 overflow-hidden">
                <div className="flex flex-col md:flex-row">
                    <div className="flex-grow p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                        <div className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary"/> <div><span className="font-semibold">Loja:</span> {getKioskName(lot.kioskId)}</div></div>
                        <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary"/> <div><span className="font-semibold">Local:</span> {locationName || 'N/A'}</div></div>
                        <div className="flex items-center gap-2"><Barcode className="h-4 w-4 text-primary"/> <div><span className="font-semibold">Cód. Barras:</span> {product.barcode || 'N/A'}</div></div>
                        <div className="flex items-center gap-2"><Package className="h-4 w-4 text-primary"/> <div><span className="font-semibold">Lote:</span> {lot.lotNumber}</div></div>
                        <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-primary"/> <div><span className="font-semibold">Validade:</span> {format(expiry, "dd/MM/yyyy")}</div></div>
                        <div className="flex items-center gap-2"><Hash className="h-4 w-4 text-primary"/> <div><span className="font-semibold">Medida:</span> {`${product.packageSize}${product.unit}`}</div></div>
                    </div>
                     <div className="flex flex-col items-center justify-center p-4 bg-muted md:w-48 text-center border-t md:border-t-0 md:border-l">
                        <div className="text-4xl font-bold">{lot.quantity}</div>
                        <div className="text-muted-foreground">unidades</div>
                        <Badge className={`mt-2 text-white ${status.color}`}>{status.text}</Badge>
                    </div>
                </div>
                 <div className="p-2 bg-background/50 border-t flex justify-end gap-1">
                    {canViewHistory && (
                        <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => onViewHistory(lot)}><History className="h-4 w-4" /></Button>
                        </TooltipTrigger><TooltipContent><p>Histórico</p></TooltipContent></Tooltip></TooltipProvider>
                    )}
                    {canEdit && (
                         <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => onZeroOut(lot)}><Eraser className="h-4 w-4" /></Button>
                        </TooltipTrigger><TooltipContent><p>Zerar Estoque</p></TooltipContent></Tooltip></TooltipProvider>
                    )}
                     {canMove && lot.quantity > 0 && (
                        <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMove(lot.id)}><Truck className="h-4 w-4" /></Button>
                        </TooltipTrigger><TooltipContent><p>Mover</p></TooltipContent></Tooltip></TooltipProvider>
                    )}
                    {canEdit && (
                        <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(lot.id)}><Pencil className="h-4 w-4" /></Button>
                        </TooltipTrigger><TooltipContent><p>Editar</p></TooltipContent></Tooltip></TooltipProvider>
                    )}
                    {canDelete && (
                        <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive h-8 w-8" onClick={() => onDelete(lot.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TooltipTrigger><TooltipContent><p>Excluir</p></TooltipContent></Tooltip></TooltipProvider>
                    )}
                </div>
            </Card>
          )
        })}
      </CardContent>
    </Card>
  );
}
