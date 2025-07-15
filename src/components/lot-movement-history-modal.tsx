

"use client"

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History } from 'lucide-react';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { type LotEntry } from '@/types';

interface LotMovementHistoryModalProps {
  lot: LotEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function LotMovementHistoryModal({ lot, onOpenChange }: LotMovementHistoryModalProps) {
  const { history, loading } = useMovementHistory();

  const lotHistory = useMemo(() => {
    if (!lot || loading) return [];
    return history.filter(
      (record) => record.lotId === lot.id
    );
  }, [lot, history, loading]);

  if (!lot) return null;

  return (
    <Dialog open={!!lot} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Histórico de movimentação</DialogTitle>
          <DialogDescription>
            Exibindo histórico para {lot.productName} (lote: {lot.lotNumber})
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 pr-4">
          <div className="py-4">
            {lotHistory.length > 0 ? (
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Quiosque</TableHead>
                            <TableHead className="text-right">Qtd.</TableHead>
                            <TableHead>Usuário</TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                        {lotHistory.map((item) => (
                            <TableRow key={item.id}>
                            <TableCell>
                                {format(new Date(item.timestamp), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                            </TableCell>
                            <TableCell>{item.type}</TableCell>
                            <TableCell>{item.kioskName}</TableCell>
                            <TableCell className="text-right font-semibold">{item.quantityChange}</TableCell>
                            <TableCell>{item.username}</TableCell>
                            </TableRow>
                        ))}
                        </TableBody>
                    </Table>
                </div>
            ) : (
              <div className="flex h-60 flex-col items-center justify-center text-center text-muted-foreground">
                <History className="h-12 w-12 mb-4" />
                <p className="font-semibold">Nenhuma movimentação encontrada</p>
                <p className="text-sm">Este lote ainda não foi movimentado.</p>
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
