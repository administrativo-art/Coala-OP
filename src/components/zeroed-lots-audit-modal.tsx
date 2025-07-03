
"use client"

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History } from 'lucide-react';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { Skeleton } from './ui/skeleton';

interface ZeroedLotsAuditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ZeroedLotsAuditModal({ open, onOpenChange }: ZeroedLotsAuditModalProps) {
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { kiosks, loading: kiosksLoading } = useKiosks();

  const zeroedLots = useMemo(() => {
    if (lotsLoading || kiosksLoading) return [];
    return lots
      .filter(lot => lot.quantity <= 0)
      .sort((a, b) => parseISO(b.expiryDate).getTime() - parseISO(a.expiryDate).getTime());
  }, [lots, lotsLoading, kiosks, kiosksLoading]);
  
  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name || 'N/A';

  const loading = lotsLoading || kiosksLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Auditoria de Lotes Zerados</DialogTitle>
          <DialogDescription>
            Consulte todos os lotes cujo estoque chegou a zero.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-grow overflow-hidden">
          <ScrollArea className="h-full pr-6">
            <div className="py-4">
              {loading ? (
                  <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                  </div>
              ) : zeroedLots.length > 0 ? (
                  <div className="rounded-md border">
                      <Table>
                          <TableHeader>
                          <TableRow>
                              <TableHead>Produto</TableHead>
                              <TableHead>Lote</TableHead>
                              <TableHead>Validade</TableHead>
                              <TableHead>Último Quiosque</TableHead>
                          </TableRow>
                          </TableHeader>
                          <TableBody>
                          {zeroedLots.map((lot) => (
                              <TableRow key={lot.id}>
                                  <TableCell className="font-medium">{lot.productName}</TableCell>
                                  <TableCell>{lot.lotNumber}</TableCell>
                                  <TableCell>
                                      {format(parseISO(lot.expiryDate), "dd/MM/yyyy", { locale: ptBR })}
                                  </TableCell>
                                  <TableCell>{getKioskName(lot.kioskId)}</TableCell>
                              </TableRow>
                          ))}
                          </TableBody>
                      </Table>
                  </div>
              ) : (
                <div className="flex h-60 flex-col items-center justify-center text-center text-muted-foreground">
                  <History className="h-12 w-12 mb-4" />
                  <p className="font-semibold">Nenhum lote zerado encontrado</p>
                  <p className="text-sm">O histórico de lotes com estoque zerado aparecerá aqui.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter className="pt-4 border-t mt-auto">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
