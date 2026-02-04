
"use client";

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useKiosks } from '@/hooks/use-kiosks';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';

interface AiAnalysisSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (params: { kioskId: string; startPeriod: string; endPeriod: string }) => void;
  isLoading: boolean;
}

export function AiAnalysisSetupModal({ open, onOpenChange, onConfirm, isLoading }: AiAnalysisSetupModalProps) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { reports: consumptionReports, isLoading: consumptionLoading } = useValidatedConsumptionData();
  
  const [kioskId, setKioskId] = useState('all');
  const [startPeriod, setStartPeriod] = useState<string | null>(null);
  const [endPeriod, setEndPeriod] = useState<string | null>(null);

  const loadingData = kiosksLoading || consumptionLoading;

  const availablePeriods = useMemo(() => {
    if (loadingData) return [];
    const periods = new Set<string>();
    consumptionReports.forEach(report => {
        if (report && report.year && report.month) {
         periods.add(`${report.year}-${String(report.month).padStart(2, '0')}`);
        }
    });
    return Array.from(periods).sort((a,b) => b.localeCompare(a));
  }, [consumptionReports, loadingData]);

  useEffect(() => {
    if (!loadingData && availablePeriods.length > 0) {
        if (!endPeriod) setEndPeriod(availablePeriods[0]);
        if (!startPeriod) {
            const defaultStartIndex = Math.min(2, availablePeriods.length - 1);
            setStartPeriod(availablePeriods[defaultStartIndex]);
        }
    }
  }, [availablePeriods, loadingData, startPeriod, endPeriod]);

  const handleStartPeriodChange = (value: string) => {
    setStartPeriod(value);
    if (endPeriod && value > endPeriod) {
        setEndPeriod(value);
    }
  };

  const handleEndPeriodChange = (value: string) => {
    setEndPeriod(value);
    if (startPeriod && value < startPeriod) {
        setStartPeriod(value);
    }
  };

  const handleConfirmClick = () => {
    if (kioskId && startPeriod && endPeriod) {
      onConfirm({ kioskId, startPeriod, endPeriod });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Parâmetros para Análise com IA</DialogTitle>
          <DialogDescription>
            Selecione a unidade e o período que você deseja analisar. A análise considerará todos os insumos.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select value={kioskId} onValueChange={setKioskId} disabled={loadingData}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Unidades</SelectItem>
                {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Período</Label>
            <div className="flex items-center gap-2">
              <Select value={startPeriod || ""} onValueChange={handleStartPeriodChange} disabled={loadingData || availablePeriods.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Início" />
                </SelectTrigger>
                <SelectContent>
                  {availablePeriods.map(p => (
                      <SelectItem key={`start-${p}`} value={p}>
                          {format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR })}
                      </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">-</span>
              <Select value={endPeriod || ""} onValueChange={handleEndPeriodChange} disabled={loadingData || availablePeriods.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Fim" />
                </SelectTrigger>
                <SelectContent>
                  {availablePeriods.map(p => (
                      <SelectItem key={`end-${p}`} value={p} disabled={!!startPeriod && p < startPeriod}>
                          {format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR })}
                      </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirmClick} disabled={isLoading || !kioskId || !startPeriod || !endPeriod}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Analisar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
