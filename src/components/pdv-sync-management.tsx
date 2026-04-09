"use client";

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle2, AlertCircle, Calendar as CalendarIcon, Loader2, PlayCircle } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, startOfYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type SyncLog = {
  date: string;
  kioskName: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  revenue?: number;
  errorMessage?: string;
};

export function PdvSyncManagement() {
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  
  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [progress, setProgress] = useState(0);

  // Atalhos
  const handleSetPreset = (type: 'week' | 'month' | 'year' | '90days') => {
    const now = new Date();
    if (type === 'week') {
      setStartDate(format(subDays(now, 7), 'yyyy-MM-dd'));
      setEndDate(format(now, 'yyyy-MM-dd'));
    } else if (type === 'month') {
      setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
    } else if (type === 'year') {
      setStartDate(format(startOfYear(now), 'yyyy-MM-dd'));
      setEndDate(format(now, 'yyyy-MM-dd'));
    } else if (type === '90days') {
      setStartDate(format(subDays(now, 90), 'yyyy-MM-dd'));
      setEndDate(format(now, 'yyyy-MM-dd'));
    }
  };

  const FALLBACK_PDV_IDS: Record<string, string> = {
    'tirirical': '17343',
    'joao-paulo': '17344',
  };

  const resolvedKiosks = kiosks.map(k => ({
    ...k,
    pdvFilialId: k.pdvFilialId || FALLBACK_PDV_IDS[k.id] || undefined,
  }));

  async function startSync() {
    if (!startDate || !endDate) return;

    const start = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');

    if (start > end) {
      toast({ title: 'Erro', description: 'Data de início não pode ser maior que o fim.', variant: 'destructive' });
      return;
    }

    const targetKiosks = selectedKioskId === 'all'
      ? resolvedKiosks.filter(k => !!k.pdvFilialId)
      : resolvedKiosks.filter(k => k.id === selectedKioskId && !!k.pdvFilialId);

    if (targetKiosks.length === 0) {
      toast({ title: 'Atenção', description: 'Nenhum quiosque configurado com ID PDV Legal.' });
      return;
    }

    const days = eachDayOfInterval({ start, end });
    const totalOperations = targetKiosks.length * days.length;
    
    setIsSyncing(true);
    setProgress(0);
    setLogs([]);

    const newLogs: SyncLog[] = [];
    targetKiosks.forEach(k => {
      days.forEach(d => {
        newLogs.push({
          date: format(d, 'yyyy-MM-dd'),
          kioskName: k.name,
          status: 'pending'
        });
      });
    });
    setLogs(newLogs);

    const syncFn = httpsCallable(functions, 'syncGoalsForRange');
    let completed = 0;

    // Processamento sequencial por quiosque para não estourar a API do PDV Legal
    for (const kiosk of targetKiosks) {
      // Processamos em pequenos blocos de 7 dias para evitar timeouts longos na Cloud Function
      const chunks = [];
      for (let i = 0; i < days.length; i += 7) {
        chunks.push(days.slice(i, i + 7));
      }

      for (const chunk of chunks) {
        const chunkStart = format(chunk[0], 'yyyy-MM-dd');
        const chunkEnd = format(chunk[chunk.length - 1], 'yyyy-MM-dd');

        try {
          // Atualiza status local para 'loading'
          setLogs(prev => prev.map(l => 
            l.kioskName === kiosk.name && chunk.some(d => format(d, 'yyyy-MM-dd') === l.date)
              ? { ...l, status: 'loading' } : l
          ));

          const result = await syncFn({
            kioskId: kiosk.id,
            startDate: chunkStart,
            endDate: chunkEnd,
          }) as any;

          const resultsData = result.data.results || [];

          // Atualiza status local com resultados reais
          setLogs(prev => prev.map(l => {
            const resMatch = resultsData.find((r: any) => r.date === l.date && l.kioskName === kiosk.name);
            if (resMatch) {
              return { 
                ...l, 
                status: resMatch.error ? 'error' : 'success',
                revenue: resMatch.revenue,
                errorMessage: resMatch.error
              };
            }
            return l;
          }));

          completed += chunk.length;
          setProgress(Math.round((completed / totalOperations) * 100));

        } catch (e: any) {
          console.error(`Erro no chunk ${chunkStart}-${chunkEnd}:`, e);
          setLogs(prev => prev.map(l => 
            l.kioskName === kiosk.name && chunk.some(d => format(d, 'yyyy-MM-dd') === l.date)
              ? { ...l, status: 'error', errorMessage: e.message } : l
          ));
          completed += chunk.length;
          setProgress(Math.round((completed / totalOperations) * 100));
        }
      }
    }

    setIsSyncing(false);
    toast({ title: 'Sincronização Finalizada', description: `${completed} operações concluídas.` });
  }

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <RefreshCw className={`h-5 w-5 text-blue-500 ${isSyncing ? 'animate-spin' : ''}`} />
          <CardTitle>Central de Sincronização PDV</CardTitle>
        </div>
        <CardDescription>
          Reprocesse dados históricos do PDV Legal para atualizar faturamento, metas e estoque.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Quiosque</Label>
              <Select value={selectedKioskId} onValueChange={setSelectedKioskId} disabled={isSyncing}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o quiosque" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Quiosques</SelectItem>
                  {resolvedKiosks.filter(k => !!k.pdvFilialId).map(k => (
                    <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Intervalo de Datas</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={isSyncing} />
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={isSyncing} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Label>Atalhos de Período</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => handleSetPreset('week')} disabled={isSyncing}>
                Últimos 7 dias
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleSetPreset('month')} disabled={isSyncing}>
                Mês Atual
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleSetPreset('90days')} disabled={isSyncing}>
                Últimos 90 dias
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleSetPreset('year')} disabled={isSyncing}>
                Desde Jan/2026
              </Button>
            </div>
            
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={startSync} disabled={isSyncing}>
              {isSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sincronizando... {progress}%
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Iniciar sincronização
                </>
              )}
            </Button>
          </div>
        </div>

        {isSyncing || logs.length > 0 ? (
          <div className="space-y-3 pt-4 border-t border-border/40">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Progresso total</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            
            <ScrollArea className="h-48 rounded-md border border-border/40 bg-muted/20 p-2">
              <div className="space-y-1.5">
                {logs.slice().reverse().map((log, i) => (
                  <div key={`${log.kioskName}-${log.date}-${i}`} className="flex items-center justify-between text-[11px] py-1 border-b border-border/10 last:border-0">
                    <div className="flex items-center gap-2">
                      {log.status === 'success' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                      {log.status === 'error' && <AlertCircle className="h-3 w-3 text-destructive" />}
                      {log.status === 'loading' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                      {log.status === 'pending' && <CalendarIcon className="h-3 w-3 text-muted-foreground" />}
                      <span className="font-mono text-muted-foreground">{format(new Date(log.date + 'T12:00:00Z'), 'dd/MM')}</span>
                      <span className="font-medium">{log.kioskName}</span>
                    </div>
                    <div>
                      {log.status === 'success' && <span className="text-green-600 font-bold">R$ {log.revenue?.toFixed(2)}</span>}
                      {log.status === 'error' && <span className="text-destructive font-bold" title={log.errorMessage}>Falha</span>}
                      {log.status === 'loading' && <span className="text-blue-500 animate-pulse">Processando...</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
