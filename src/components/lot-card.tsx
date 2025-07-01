
"use client"

import Image from 'next/image';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Pencil, Trash2, Move, MapPin, Camera } from 'lucide-react';
import { type Kiosk } from '@/types';

const DEFAULT_URGENT_THRESHOLD = 7;
const DEFAULT_ALERT_THRESHOLD = 30;

export type GroupedLot = {
  productName: string;
  lotNumber: string;
  barcode: string;
  expiryDate: string;
  totalQuantity: number;
  imageUrl?: string;
  alertThreshold?: number;
  urgentThreshold?: number;
  kiosks: {
    id: string; // This is the unique LotEntry ID
    kioskId: string;
    quantity: number;
  }[];
};

type LotCardProps = {
  groupedLot: GroupedLot;
  kiosks: Kiosk[];
  onEdit: (lotId: string) => void;
  onMove: (lotId: string) => void;
  onDelete: (lotId: string) => void;
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
};

export function LotCard({ groupedLot, kiosks, onEdit, onMove, onDelete, canEdit, canMove, canDelete }: LotCardProps) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = parseISO(groupedLot.expiryDate);
  const daysUntilExpiry = differenceInDays(expiry, now);
  
  const urgentThreshold = groupedLot.urgentThreshold ?? DEFAULT_URGENT_THRESHOLD;
  const alertThreshold = groupedLot.alertThreshold ?? DEFAULT_ALERT_THRESHOLD;

  let status: { color: string, text: string };
  if (daysUntilExpiry < 0) {
    status = { color: 'bg-red-600 hover:bg-red-700', text: `Vencido há ${Math.abs(daysUntilExpiry)} dias` };
  } else if (daysUntilExpiry === 0) {
    status = { color: 'bg-red-600 hover:bg-red-700', text: 'Vence hoje' };
  } else if (daysUntilExpiry <= urgentThreshold) {
    status = { color: 'bg-yellow-500 hover:bg-yellow-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
  } else if (daysUntilExpiry <= alertThreshold) {
    status = { color: 'bg-orange-500 hover:bg-orange-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
  } else {
    status = { color: 'bg-green-600 hover:bg-green-700', text: `Vence em ${daysUntilExpiry} dias` };
  }

  const getKioskName = (id: string) => {
    return kiosks.find(k => k.id === id)?.name || 'Quiosque desconhecido';
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-4">
        <div className="flex flex-grow items-start gap-4">
          {groupedLot.imageUrl ? (
            <Image src={groupedLot.imageUrl} alt={groupedLot.productName} width={64} height={64} className="rounded-md object-cover aspect-square" />
          ) : (
            <div className="h-16 w-16 flex-shrink-0 flex items-center justify-center bg-secondary rounded-md">
              <Camera className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <div className="flex-grow">
            <CardTitle className="text-xl">{groupedLot.productName}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
              <span>Lote: <strong>{groupedLot.lotNumber}</strong></span>
              {groupedLot.barcode && <span>Cód. Barras: <strong>{groupedLot.barcode}</strong></span>}
              <span>Total: <strong>{groupedLot.totalQuantity} un.</strong></span>
            </CardDescription>
          </div>
        </div>
        <Badge className={`text-white text-sm ${status.color} self-start`}>{status.text}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 pb-2 text-sm text-muted-foreground">
          Validade: {format(expiry, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </div>
        <Separator />
        <div className="p-4 space-y-2">
            {groupedLot.kiosks.map(kioskEntry => (
                <div key={kioskEntry.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                    <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{getKioskName(kioskEntry.kioskId)}:</span>
                        <span>{kioskEntry.quantity} un.</span>
                    </div>
                    {(canMove || canEdit || canDelete) && (
                      <div className="flex gap-1">
                          {canMove && (
                            <Button variant="ghost" size="icon" onClick={() => onMove(kioskEntry.id)}>
                                <Move className="h-4 w-4" />
                            </Button>
                          )}
                          {canEdit && (
                            <Button variant="ghost" size="icon" onClick={() => onEdit(kioskEntry.id)}>
                                <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onDelete(kioskEntry.id)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                      </div>
                    )}
                </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
