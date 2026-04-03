"use client";
import Link from 'next/link';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { PermissionGuard } from '@/components/permission-guard';
import { CloseGoalModal } from '@/components/close-goal-modal';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, RotateCcw, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type GoalPeriodDoc } from '@/types';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTs(ts: any): string {
  if (!ts) return '-';
  try { return format(ts.toDate(), 'MMM/yyyy', { locale: ptBR }); } catch { return '-'; }
}

const statusLabels: Record<string, string> = {
  closed: 'Encerrada', cancelled: 'Cancelada', active: 'Ativa',
};

const statusVariants: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  closed: 'default', cancelled: 'destructive', active: 'secondary',
};

function GoalsHistoryPage() {
  const { periods, employeeGoals, loading, reopenPeriod } = useGoals();
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  const { toast } = useToast();
  const [filterKiosk, setFilterKiosk] = useState('all');
  const [reopening, setReopening] = useState<string | null>(null);
  const [closingPeriod, setClosingPeriod] = useState<GoalPeriodDoc | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const isManager = (permissions.goals?.manage ?? false) || (permissions.settings?.manageUsers ?? false);

  async function handleReopen(periodId: string) {
    setReopening(periodId);
    await reopenPeriod(periodId);
    toast({ title: 'Meta reaberta com sucesso.' });
    setReopening(null);
  }

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;

  const filteredPeriods = useMemo(() => {
    const sorted = [...periods].sort((a, b) => {
      const aDate = a.startDate?.toDate?.()?.getTime() ?? 0;
      const bDate = b.startDate?.toDate?.()?.getTime() ?? 0;
      return bDate - aDate;
    });
    if (filterKiosk === 'all') return sorted;
    return sorted.filter(p => p.kioskId === filterKiosk);
  }, [periods, filterKiosk]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/goals/analysis">
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Histórico de Metas</h1>
            <p className="text-sm text-muted-foreground">Todos os períodos de metas — ativos e encerrados.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select value={filterKiosk} onValueChange={setFilterKiosk}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todos os quiosques" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{filteredPeriods.length} período{filteredPeriods.length !== 1 ? 's' : ''}</span>
        </div>

        {filteredPeriods.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">Nenhum período encontrado.</CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quiosque</TableHead>
                    <TableHead>Mês</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Meta Alvo</TableHead>
                    <TableHead className="text-right">Meta UP</TableHead>
                    <TableHead className="text-right">Realizado</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Colaboradores</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPeriods.map(p => {
                    const pct = p.targetValue > 0 ? (p.currentValue / p.targetValue) * 100 : 0;
                    const collaborators = employeeGoals.filter(eg => eg.periodId === p.id).length;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{getKioskName(p.kioskId)}</TableCell>
                        <TableCell className="capitalize">{formatTs(p.startDate)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariants[p.status] ?? 'outline'}>
                            {statusLabels[p.status] ?? p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">R$ {fmt(p.targetValue)}</TableCell>
                        <TableCell className="text-right">R$ {fmt(p.upValue ?? 0)}</TableCell>
                        <TableCell className="text-right">R$ {fmt(p.currentValue)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={pct >= 100 ? 'default' : pct >= 70 ? 'secondary' : 'outline'}>
                            {pct.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{collaborators}</TableCell>
                        <TableCell className="text-right">
                          {isManager && p.status === 'active' && (
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => { setClosingPeriod(p); setCloseOpen(true); }}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Encerrar
                            </Button>
                          )}
                          {isManager && (p.status === 'closed' || p.status === 'cancelled') && (
                            <Button
                              variant="ghost" size="sm"
                              disabled={reopening === p.id}
                              onClick={() => handleReopen(p.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              {reopening === p.id ? 'Reabrindo...' : 'Reabrir'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <CloseGoalModal open={closeOpen} onOpenChange={setCloseOpen} period={closingPeriod} />
    </PermissionGuard>
  );
}

export default GoalsHistoryPage;
