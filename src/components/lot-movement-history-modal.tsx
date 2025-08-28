
"use client"

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Trash2, ArrowRight } from 'lucide-react';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { type LotEntry, type MovementRecord } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import { useKiosks } from '@/hooks/use-kiosks';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';


const getMovementTypeStyle = (type: MovementRecord['type']) => {
    if (type?.includes('ENTRADA')) return 'text-green-600';
    if (type?.includes('SAIDA')) return 'text-destructive';
    if (type?.includes('TRANSFERENCIA')) return 'text-blue-600';
    return '';
}

interface LotMovementHistoryModalProps {
  lot: LotEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function LotMovementHistoryModal({ lot, onOpenChange }: LotMovementHistoryModalProps) {
  const { history, loading, deleteMovementRecord } = useMovementHistory();
  const { permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [recordToDelete, setRecordToDelete] = useState<MovementRecord | null>(null);

  const movementHistory = useMemo(() => {
    if (loading) return [];
    const sourceHistory = lot 
      ? history.filter((record) => record.lotId === lot.id)
      : history;
      
    return sourceHistory.map(record => {
      let kioskName = 'N/A';
      if (record.fromKioskId) {
        kioskName = kiosks.find(k => k.id === record.fromKioskId)?.name || 'Quiosque Desconhecido';
      } else if (record.toKioskId) {
        kioskName = kiosks.find(k => k.id === record.toKioskId)?.name || 'Quiosque Desconhecido';
      }
      return { ...record, kioskName };
    })
  }, [lot, history, loading, kiosks]);

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
  
  const canDelete = permissions.lots.delete;

  return (
    <>
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Histórico de movimentação</DialogTitle>
          <DialogDescription>
            {lot 
              ? `Exibindo histórico para ${lot.productName} (lote: ${lot.lotNumber})`
              : 'Exibindo histórico completo de todas as movimentações.'
            }
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto pr-2">
            <ScrollArea className="h-full">
            <div className="py-4 pr-2">
                {movementHistory.length > 0 ? (
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow>
                                <TableHead>Data</TableHead>
                                {lot === null && <TableHead>Produto</TableHead>}
                                {lot === null && <TableHead>Lote</TableHead>}
                                <TableHead>Tipo</TableHead>
                                <TableHead>Quiosque</TableHead>
                                <TableHead className="text-right">Qtd.</TableHead>
                                <TableHead>Usuário</TableHead>
                                {canDelete && <TableHead className="text-right">Ações</TableHead>}
                            </TableRow>
                            </TableHeader>
                            <TableBody>
                            {movementHistory.map((item) => (
                                <TableRow key={item.id}>
                                <TableCell>
                                    {format(new Date(item.timestamp), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                                </TableCell>
                                {lot === null && <TableCell className="font-medium">{item.productName}</TableCell>}
                                {lot === null && <TableCell>{item.lotNumber}</TableCell>}
                                <TableCell>
                                    <Badge variant="outline" className={cn(getMovementTypeStyle(item.type))}>
                                        {item.type}
                                    </Badge>
                                </TableCell>
                                <TableCell>{item.kioskName}
                                  {item.toKioskName && <><ArrowRight className="inline mx-1 h-3 w-3"/>{item.toKioskName}</>}
                                </TableCell>
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
        </div>
        <DialogFooter className="pt-4 border-t">
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
