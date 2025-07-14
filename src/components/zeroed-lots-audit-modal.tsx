
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
import { useProducts } from '@/hooks/use-products';

interface ZeroedLotsAuditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ZeroedLotsAuditModal({ open, onOpenChange }: ZeroedLotsAuditModalProps) {
  const { history, loading } = useMovementHistory();
  const { products, getProductFullName } = useProducts();

  const historyWithProducts = useMemo(() => {
    if (loading || !products.length) return [];
    return history.map(record => {
      // The productName in the record is the full name, we need to find the base product
      const product = products.find(p => record.productName.startsWith(p.baseName));
      return {
        ...record,
        // The record's productName is already formatted, we can use it directly
        // but it might be stale. Let's re-format if we find the product.
        displayName: product ? getProductFullName(product) : record.productName,
      };
    });
  }, [history, products, loading, getProductFullName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Auditoria de movimentações</DialogTitle>
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
              ) : historyWithProducts.length > 0 ? (
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
                          {historyWithProducts.map((item) => (
                              <TableRow key={item.id}>
                                  <TableCell className="text-sm">
                                      {format(parseISO(item.movedAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                                  </TableCell>
                                  <TableCell className="font-medium">{item.displayName}</TableCell>
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
