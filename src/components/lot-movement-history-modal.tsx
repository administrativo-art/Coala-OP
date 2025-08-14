
"use client"

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Trash2 } from 'lucide-react';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { type LotEntry, type MovementRecord } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useToast } from '@/hooks/use-toast';

interface LotMovementHistoryModalProps {
  lot: LotEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function LotMovementHistoryModal({ lot, onOpenChange }: LotMovementHistoryModalProps) {
  const { history, loading, deleteMovementRecord } = useMovementHistory();
  const { permissions } = useAuth();
  const { toast } = useToast();
  const [recordToDelete, setRecordToDelete] = useState<MovementRecord | null>(null);

  const lotHistory = useMemo(() => {
    if (!lot || loading) return [];
    return history.filter(
      (record) => record.lotId === lot.id
    );
  }, [lot, history, loading]);

  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return;
    try {
        await deleteMovementRecord(recordToDelete.id);
        toast({ title: "Registro excluído com sucesso!" });
        setRecordToDelete(null);
    } catch {
        toast({ variant: 'destructive', title: "Erro ao excluir registro." });
    }
  };

  if (!lot) return null;
  
  const canDelete = permissions.lots.delete;

  return (
    <>
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
                            {canDelete && <TableHead className="text-right">Ações</TableHead>}
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                        {lotHistory.map((item) => (
                            <TableRow key={item.id}>
                            <TableCell>
                                {format(new Date(item.timestamp), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                            </TableCell>
                            <TableCell>{item.type}</TableCell>
                            <TableCell>{item.kioskName || item.fromKioskName || 'N/A'}</TableCell>
                            <TableCell className="text-right font-semibold">{item.quantityChange}</TableCell>
                            <TableCell>{item.username}</TableCell>
                            {canDelete && (
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => setRecordToDelete(item)}>
                                        <Trash2 className="h-4 w-4"/>
                                    </Button>
                                </TableCell>
                            )}
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

    <DeleteConfirmationDialog 
        open={!!recordToDelete}
        onOpenChange={() => setRecordToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName="este registro de histórico"
        description="Esta ação é permanente e não pode ser desfeita. O registro de movimentação será removido."
    />
    </>
  );
}
