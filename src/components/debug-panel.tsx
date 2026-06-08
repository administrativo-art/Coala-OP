
"use client";

import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Timer, Server, Smartphone } from 'lucide-react';

interface DebugPanelProps {
  dataLoadTime: number | null;
}

export function DebugPanel({ dataLoadTime }: DebugPanelProps) {
  const [pageLoadTime, setPageLoadTime] = useState<number | null>(null);

  useEffect(() => {
    const perf = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    if (perf) {
      const loadTime = perf.loadEventEnd - perf.startTime;
      setPageLoadTime(loadTime);
    }
  }, []);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
          size="icon"
        >
          <Timer className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-auto">
        <SheetHeader>
          <SheetTitle>Painel de Depuração de Performance</SheetTitle>
        </SheetHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-muted-foreground" />
              <p className="font-medium">Tempo de Carregamento da Página (Frontend)</p>
            </div>
            <p className="font-mono text-lg font-bold">
              {pageLoadTime !== null ? `${pageLoadTime.toFixed(0)} ms` : 'Calculando...'}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-muted-foreground" />
              <p className="font-medium">Tempo de Carregamento dos Dados (Layout)</p>
            </div>
            <p className="font-mono text-lg font-bold">
              {dataLoadTime !== null ? `${dataLoadTime.toFixed(0)} ms` : 'Calculando...'}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
