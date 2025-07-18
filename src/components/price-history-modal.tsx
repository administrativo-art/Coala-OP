
"use client"

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type SimulationPriceHistory, type ProductSimulation } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';

interface PriceHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: SimulationPriceHistory[];
  simulations: ProductSimulation[];
}

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function PriceHistoryModal({ open, onOpenChange, history, simulations }: PriceHistoryModalProps) {
  const { users } = useAuth();

  const simulationMap = React.useMemo(() => {
    return new Map(simulations.map(s => [s.id, s.name]));
  }, [simulations]);

  const userMap = React.useMemo(() => {
    return new Map(users.map(u => [u.id, u.username]));
  }, [users]);

  const filteredHistory = React.useMemo(() => {
    return history.filter(h => simulationMap.has(h.simulationId));
  }, [history, simulationMap]);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Histórico de Ajustes de Preço</DialogTitle>
          <DialogDescription>
            Veja todas as alterações de preço de venda realizadas nas análises de custo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto pr-2">
            <ScrollArea className="h-full">
                <div className="rounded-md border">
                    <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow>
                                <TableHead>Mercadoria</TableHead>
                                <TableHead>Data da Alteração</TableHead>
                                <TableHead>Alterado por</TableHead>
                                <TableHead className="text-right">Preço Anterior</TableHead>
                                <TableHead className="text-right">Preço Novo</TableHead>
                                <TableHead className="text-right">Variação</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredHistory.length > 0 ? filteredHistory.map(entry => {
                                const priceIncreased = entry.newPrice > entry.oldPrice;
                                const variation = entry.newPrice - entry.oldPrice;

                                return (
                                <TableRow key={entry.id}>
                                    <TableCell className="font-medium">{simulationMap.get(entry.simulationId) || 'Mercadoria removida'}</TableCell>
                                    <TableCell>{format(parseISO(entry.changedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</TableCell>
                                    <TableCell>{entry.changedBy.username || 'Usuário desconhecido'}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">{formatCurrency(entry.oldPrice)}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(entry.newPrice)}</TableCell>
                                    <TableCell className={cn("text-right font-bold flex items-center justify-end gap-1", priceIncreased ? "text-green-600" : "text-destructive")}>
                                        {priceIncreased ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                                        {formatCurrency(variation)}
                                    </TableCell>
                                </TableRow>
                                )
                            }) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center">Nenhum histórico de ajuste de preço encontrado.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </ScrollArea>
        </div>
        <DialogFooter className="pt-4 border-t">
          <Button type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

