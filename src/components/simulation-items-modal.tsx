
"use client";

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
import { type ProductSimulation } from '@/types';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';


interface SimulationItemsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: ProductSimulation[];
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function SimulationItemsModal({ open, onOpenChange, title, items }: SimulationItemsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Lista de mercadorias que atendem a este critério.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto pr-2">
          <ScrollArea className="h-full">
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead>Mercadoria</TableHead>
                        <TableHead className="text-right">Preço de Venda</TableHead>
                        <TableHead className="text-right">Meta de Lucro</TableHead>
                        <TableHead className="text-right">Lucro Atual</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.length > 0 ? items.map(item => {
                            const meetsGoal = item.profitGoal !== undefined && item.profitGoal !== null && item.profitPercentage >= item.profitGoal;
                            return (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(item.salePrice)}</TableCell>
                                    <TableCell className="text-right">{item.profitGoal ? `${item.profitGoal.toFixed(2)}%` : 'N/A'}</TableCell>
                                    <TableCell className="text-right font-bold">{item.profitPercentage.toFixed(2)}%</TableCell>
                                    <TableCell className="text-center">
                                         {item.profitGoal !== undefined && item.profitGoal !== null ? (
                                            meetsGoal ? (
                                                <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle2 className="mr-1 h-3 w-3" /> Na meta</Badge>
                                            ) : (
                                                 <Badge variant="destructive" className="bg-orange-100 text-orange-800"><AlertTriangle className="mr-1 h-3 w-3" /> Abaixo</Badge>
                                            )
                                        ) : <Badge variant="outline">Sem meta</Badge>}
                                    </TableCell>
                                </TableRow>
                            )
                        }) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">Nenhum item encontrado.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
          </ScrollArea>
        </div>
        <DialogFooter className="pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

