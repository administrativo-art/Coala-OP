"use client"

import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Pencil, Trash2, Move, MapPin } from 'lucide-react';
import { type Location } from '@/types';

export type GroupedLot = {
  productName: string;
  lotNumber: string;
  barcode: string;
  expiryDate: string;
  totalQuantity: number;
  locations: {
    id: string; // This is the unique LotEntry ID
    locationId: string;
    quantity: number;
  }[];
};

type LotCardProps = {
  groupedLot: GroupedLot;
  locations: Location[];
  onEdit: (lotId: string) => void;
  onMove: (lotId: string) => void;
  onDelete: (lotId: string) => void;
};

export function LotCard({ groupedLot, locations, onEdit, onMove, onDelete }: LotCardProps) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = parseISO(groupedLot.expiryDate);
  const daysUntilExpiry = differenceInDays(expiry, now);

  let status: { color: string, text: string };
  if (daysUntilExpiry < 0) {
    status = { color: 'bg-red-600 hover:bg-red-700', text: `Vencido há ${Math.abs(daysUntilExpiry)} dias` };
  } else if (daysUntilExpiry === 0) {
    status = { color: 'bg-red-600 hover:bg-red-700', text: 'Vence hoje' };
  } else if (daysUntilExpiry <= 30) {
    status = { color: 'bg-yellow-500 hover:bg-yellow-600', text: `Vence em ${daysUntilExpiry} dia(s)` };
  } else {
    status = { color: 'bg-green-600 hover:bg-green-700', text: `Vence em ${daysUntilExpiry} dias` };
  }

  const getLocationName = (id: string) => {
    return locations.find(l => l.id === id)?.name || 'Local desconhecido';
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-4">
        <div className="flex-grow">
          <CardTitle className="text-xl">{groupedLot.productName}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <span>Lote: <strong>{groupedLot.lotNumber}</strong></span>
            {groupedLot.barcode && <span>Cód. Barras: <strong>{groupedLot.barcode}</strong></span>}
            <span>Total: <strong>{groupedLot.totalQuantity} un.</strong></span>
          </CardDescription>
        </div>
        <Badge className={`text-white text-sm ${status.color}`}>{status.text}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 pb-2 text-sm text-muted-foreground">
          Validade: {format(expiry, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </div>
        <Separator />
        <div className="p-4 space-y-2">
            {groupedLot.locations.map(loc => (
                <div key={loc.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                    <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{getLocationName(loc.locationId)}:</span>
                        <span>{loc.quantity} un.</span>
                    </div>
                    <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => onMove(loc.id)}>
                            <Move className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => onEdit(loc.id)}>
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onDelete(loc.id)}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
