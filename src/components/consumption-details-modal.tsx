"use client"

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type ConsumptionReport, type BaseProduct } from '@/types';
import { Button } from './ui/button';

interface ConsumptionDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseProduct: BaseProduct | null;
  reports: ConsumptionReport[];
}

export function ConsumptionDetailsModal({ open, onOpenChange, baseProduct, reports }: ConsumptionDetailsModalProps) {
  if (!baseProduct) return null;

  const filteredReports = reports.filter(report => 
    report.results.some(item => item.baseProductId === baseProduct.id)
  ).map(report => {
    const item = report.results.find(it => it.baseProductId === baseProduct.id);
    return {
      id: report.id,
      month: report.month,
      year: report.year,
      kioskName: report.kioskName || 'N/A',
      consumedQuantity: item?.consumedQuantity || 0,
      createdAt: report.createdAt
    };
  }).sort((a, b) => b.year - a.year || b.month - a.month);

  const total = filteredReports.reduce((sum, r) => sum + r.consumedQuantity, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Detalhamento de Vendas (API)</DialogTitle>
          <DialogDescription>
            Origem das vendas teóricas para <strong>{baseProduct.name}</strong> a partir dos relatórios de consumo validados.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-hidden border rounded-lg flex flex-col mt-4">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="sticky top-0 bg-muted z-10">
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Unidade/Quiosque</TableHead>
                  <TableHead className="text-right">Quantidade Vendida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.length > 0 ? filteredReports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">
                      {format(new Date(report.year, report.month - 1), "MMMM 'de' yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>{report.kioskName}</TableCell>
                    <TableCell className="text-right font-bold text-blue-600">
                      {report.consumedQuantity.toLocaleString('pt-BR')} {baseProduct.unit}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">Nenhum relatório encontrado para este período.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>

        <DialogFooter className="pt-4 border-t shrink-0 flex justify-between items-center w-full">
            <div className="text-sm font-medium"> Total no Período: <span className="text-lg font-bold text-blue-600">{total.toLocaleString('pt-BR')} {baseProduct.unit}</span></div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
