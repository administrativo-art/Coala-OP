"use client";

import { useMemo, useState } from 'react';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type GoalPeriodDoc, type GoalType, type GoalPeriod } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// TODO: aplicar permissão de acesso específica para análise

const typeLabels: Record<string, string> = {
  revenue: 'Faturamento', ticket: 'Ticket Médio', product_line: 'Linha de Produto', product_specific: 'Produto Específico',
};
const periodLabels: Record<string, string> = {
  daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal',
};
const statusLabels: Record<string, string> = {
  closed: 'Encerrada', cancelled: 'Cancelada',
};

function formatTs(ts: any): string {
  if (!ts) return '-';
  try { return format(ts.toDate(), 'dd/MM/yyyy', { locale: ptBR }); } catch { return '-'; }
}

export function GoalsAnalysisDashboard() {
  const { periods, templates, loading } = useGoals();
  const { kiosks } = useKiosks();

  const [filterKioskId, setFilterKioskId] = useState('all');
  const [filterType, setFilterType] = useState<GoalType | 'all'>('all');
  const [filterPeriod, setFilterPeriod] = useState<GoalPeriod | 'all'>('all');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const getTemplate = (id: string) => templates.find(t => t.id === id);

  const historicPeriods = useMemo(() => {
    return periods.filter(p => p.status !== 'active').filter(p => {
      if (filterKioskId !== 'all' && p.kioskId !== filterKioskId) return false;
      const template = getTemplate(p.templateId);
      if (filterType !== 'all' && template?.type !== filterType) return false;
      if (filterPeriod !== 'all' && template?.period !== filterPeriod) return false;
      if (filterDateStart) {
        try { if (p.startDate.toDate() < new Date(filterDateStart + 'T00:00:00')) return false; } catch {}
      }
      if (filterDateEnd) {
        try { if (p.endDate.toDate() > new Date(filterDateEnd + 'T23:59:59')) return false; } catch {}
      }
      return true;
    });
  }, [periods, templates, filterKioskId, filterType, filterPeriod, filterDateStart, filterDateEnd]);

  // Comparativo entre quiosques: agrupa por templateId
  const comparativo = useMemo(() => {
    const byTemplate: Record<string, GoalPeriodDoc[]> = {};
    historicPeriods.forEach(p => {
      if (!byTemplate[p.templateId]) byTemplate[p.templateId] = [];
      byTemplate[p.templateId].push(p);
    });
    return Object.entries(byTemplate).filter(([, ps]) => ps.length > 1);
  }, [historicPeriods]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Quiosque</Label>
            <Select value={filterKioskId} onValueChange={setFilterKioskId}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={filterType} onValueChange={v => setFilterType(v as any)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(typeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Período</Label>
            <Select value={filterPeriod} onValueChange={v => setFilterPeriod(v as any)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(periodLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Data início (de)</Label>
            <Input type="date" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Data fim (até)</Label>
            <Input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card>
        <CardHeader><CardTitle>Histórico de Períodos</CardTitle></CardHeader>
        <CardContent className="p-0">
          {historicPeriods.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">Nenhum período encerrado encontrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quiosque</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Fim</TableHead>
                  <TableHead>Alvo</TableHead>
                  <TableHead>Realizado</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historicPeriods.map(p => {
                  const pct = p.targetValue > 0 ? (p.currentValue / p.targetValue) * 100 : 0;
                  const template = getTemplate(p.templateId);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{getKioskName(p.kioskId)}</TableCell>
                      <TableCell>{template ? typeLabels[template.type] : '-'}</TableCell>
                      <TableCell>{formatTs(p.startDate)}</TableCell>
                      <TableCell>{formatTs(p.endDate)}</TableCell>
                      <TableCell>{p.targetValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{p.currentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        <Badge variant={pct >= 100 ? 'default' : pct >= 70 ? 'secondary' : 'outline'}>{pct.toFixed(1)}%</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === 'closed' ? 'secondary' : 'destructive'}>{statusLabels[p.status] ?? p.status}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">{p.closureNote ?? '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Comparativo entre quiosques */}
      {comparativo.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Comparativo entre Quiosques</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {comparativo.map(([templateId, ps]) => {
              const template = getTemplate(templateId);
              return (
                <div key={templateId} className="space-y-2">
                  <p className="text-sm font-medium">{template ? `${typeLabels[template.type]} · ${periodLabels[template.period ?? '']}` : templateId}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quiosque</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead>Alvo</TableHead>
                        <TableHead>Realizado</TableHead>
                        <TableHead>%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ps.sort((a, b) => (b.currentValue / b.targetValue) - (a.currentValue / a.targetValue)).map(p => {
                        const pct = p.targetValue > 0 ? (p.currentValue / p.targetValue) * 100 : 0;
                        return (
                          <TableRow key={p.id}>
                            <TableCell>{getKioskName(p.kioskId)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatTs(p.startDate)} – {formatTs(p.endDate)}</TableCell>
                            <TableCell>{p.targetValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell>{p.currentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell><Badge variant={pct >= 100 ? 'default' : pct >= 70 ? 'secondary' : 'outline'}>{pct.toFixed(1)}%</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
