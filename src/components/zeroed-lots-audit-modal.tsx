
"use client"

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Truck } from 'lucide-react';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { Skeleton } from './ui/skeleton';

interface ZeroedLotsAuditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ZeroedLotsAuditModal({ open, onOpenChange }: ZeroedLotsAuditModalProps) {
  const { history, loading } = useMovementHistory();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Auditoria de Movimentações</DialogTitle>
          <DialogDescription>
            Consulte todo o histórico de transferências de estoque entre os quiosques.
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
              ) : history.length > 0 ? (
                  <div className="rounded-md border">
                      <Table>
                          <TableHeader>
                          <TableRow>
                              <TableHead>Data</TableHead>
                              <TableHead>Produto</TableHead>
                              <TableHead>Lote</TableHead>
                              <TableHead>Origem</TableHead>
                              <TableHead>Destino</TableHead>
                              <TableHead className="text-right">Qtd.</TableHead>
                              <TableHead>Usuário</TableHead>
                          </TableRow>
                          </TableHeader>
                          <TableBody>
                          {history.map((item) => (
                              <TableRow key={item.id}>
                                  <TableCell className="text-sm">
                                      {format(parseISO(item.movedAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                                  </TableCell>
                                  <TableCell className="font-medium">{item.productName}</TableCell>
                                  <TableCell>{item.lotNumber}</TableCell>
                                  <TableCell>{item.fromKioskName}</TableCell>
                                  <TableCell>{item.toKioskName}</TableCell>
                                  <TableCell className="text-right font-semibold">{item.quantityMoved}</TableCell>
                                  <TableCell>{item.movedByUsername}</TableCell>
                              </TableRow>
                          ))}
                          </TableBody>
                      </Table>
                  </div>
              ) : (
                <div className="flex h-60 flex-col items-center justify-center text-center text-muted-foreground">
                  <Truck className="h-12 w-12 mb-4" />
                  <p className="font-semibold">Nenhuma movimentação encontrada</p>
                  <p className="text-sm">O histórico de transferências de estoque aparecerá aqui.</p>
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
