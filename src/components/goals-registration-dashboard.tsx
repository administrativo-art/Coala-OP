"use client";

import { useState, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriodDoc } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoalTemplateFormModal } from '@/components/goal-template-form-modal';
import { AddEmployeeGoalModal } from '@/components/add-employee-goal-modal';
import { CloseGoalModal } from '@/components/close-goal-modal';
import { Plus, Users, XCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function formatMonth(ts: any): string {
  if (!ts) return '-';
  try { return format(ts.toDate(), 'MMMM yyyy', { locale: ptBR }); } catch { return '-'; }
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function GoalsRegistrationDashboard() {
  const { templates, periods, loading } = useGoals();
  const { kiosks } = useKiosks();
  const { user, permissions } = useAuth();
  const { toast } = useToast();

  const isAdmin = permissions.settings?.manageUsers ?? false;
  const userKioskIds = user?.assignedKioskIds ?? [];
  const availableKiosks = isAdmin ? kiosks : kiosks.filter(k => userKioskIds.includes(k.id));

  const [filterKioskId, setFilterKioskId] = useState<string>('all');
  const [newMetaOpen, setNewMetaOpen] = useState(false);
  const [employeeGoalOpen, setEmployeeGoalOpen] = useState(false);
  const [employeeGoalPeriod, setEmployeeGoalPeriod] = useState<GoalPeriodDoc | null>(null);
  const [closeGoalOpen, setCloseGoalOpen] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState<GoalPeriodDoc | null>(null);

  // Sync manual
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncKioskId, setSyncKioskId] = useState('');
  const [syncFilialId, setSyncFilialId] = useState('');
  const [syncStart, setSyncStart] = useState('');
  const [syncEnd, setSyncEnd] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<{ date: string; revenue?: number; error?: string }[] | null>(null);

  async function handleSyncGoals() {
    if (!syncKioskId || !syncStart || !syncEnd) return;
    setSyncLoading(true);
    setSyncResults(null);
    try {
      const fn = httpsCallable(functions, 'syncGoalsForRange');
      const payload: Record<string, string> = { kioskId: syncKioskId, startDate: syncStart, endDate: syncEnd };
      if (syncFilialId.trim()) payload.pdvFilialId = syncFilialId.trim();
      const result = await fn(payload) as any;
      setSyncResults(result.data.results);
      toast({ title: 'Sync concluído', description: `${result.data.results.length} dias processados.` });
    } catch (e: any) {
      toast({ title: 'Erro no sync', description: e.message, variant: 'destructive' });
    }
    setSyncLoading(false);
  }

  const filteredPeriods = useMemo(() => {
    const base = isAdmin ? periods : periods.filter(p => userKioskIds.includes(p.kioskId));
    return filterKioskId === 'all' ? base : base.filter(p => p.kioskId === filterKioskId);
  }, [periods, filterKioskId, isAdmin, userKioskIds]);

  const activePeriods = useMemo(() =>
    filteredPeriods.filter(p => p.status === 'active'),
    [filteredPeriods]
  );

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const getTemplateType = (templateId: string) => templates.find(t => t.id === templateId)?.type ?? 'revenue';

  const typeLabels: Record<string, string> = {
    revenue: 'Faturamento', ticket: 'Ticket Médio', product_line: 'Linha de Produto', product_specific: 'Produto Específico',
  };

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3">
          <Select value={filterKioskId} onValueChange={setFilterKioskId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todos os quiosques" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => { setSyncOpen(true); setSyncResults(null); }}>
              <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar Metas
            </Button>
          )}
        </div>
        <Button onClick={() => setNewMetaOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova Meta
        </Button>
      </div>

      {activePeriods.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhuma meta ativa.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quiosque</TableHead>
                  <TableHead>Mês</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Turnos</TableHead>
                  <TableHead>Meta Alvo</TableHead>
                  <TableHead>Meta UP</TableHead>
                  <TableHead>Atual</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activePeriods.map(p => {
                  const pct = p.targetValue > 0 ? (p.currentValue / p.targetValue) * 100 : 0;
                  const type = getTemplateType(p.templateId);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{getKioskName(p.kioskId)}</TableCell>
                      <TableCell className="capitalize">{formatMonth(p.startDate)}</TableCell>
                      <TableCell>{typeLabels[type] ?? type}</TableCell>
                      <TableCell>
                        {p.shifts?.length
                          ? <Badge variant="outline">{p.shifts.length} turno{p.shifts.length > 1 ? 's' : ''}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>R$ {fmt(p.targetValue)}</TableCell>
                      <TableCell>R$ {fmt(p.upValue ?? 0)}</TableCell>
                      <TableCell>R$ {fmt(p.currentValue)}</TableCell>
                      <TableCell>
                        <Badge variant={pct >= 100 ? 'default' : pct >= 70 ? 'secondary' : 'outline'}>
                          {pct.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEmployeeGoalPeriod(p); setEmployeeGoalOpen(true); }}>
                          <Users className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => { setClosingPeriod(p); setCloseGoalOpen(true); }}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <GoalTemplateFormModal open={newMetaOpen} onOpenChange={setNewMetaOpen} />
      <AddEmployeeGoalModal open={employeeGoalOpen} onOpenChange={setEmployeeGoalOpen} period={employeeGoalPeriod} />
      <CloseGoalModal open={closeGoalOpen} onOpenChange={setCloseGoalOpen} period={closingPeriod} />

      {/* Sync manual */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sincronizar Metas</DialogTitle>
            <DialogDescription>Busca os dados de faturamento do PDV Legal e atualiza as metas ativas no intervalo informado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Quiosque</Label>
              <Select value={syncKioskId} onValueChange={setSyncKioskId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>ID Filial PDV Legal</Label>
              <Input className="mt-1" placeholder="Ex: 12345 (opcional se já configurado)" value={syncFilialId} onChange={e => setSyncFilialId(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data início</Label>
                <Input type="date" className="mt-1" value={syncStart} onChange={e => setSyncStart(e.target.value)} />
              </div>
              <div>
                <Label>Data fim</Label>
                <Input type="date" className="mt-1" value={syncEnd} onChange={e => setSyncEnd(e.target.value)} />
              </div>
            </div>
            {syncResults && (
              <div className="rounded-md border p-3 max-h-48 overflow-y-auto space-y-1">
                {syncResults.map(r => (
                  <div key={r.date} className="flex justify-between text-xs">
                    <span className="font-mono">{r.date}</span>
                    {r.error
                      ? <span className="text-destructive">{r.error}</span>
                      : <span className="text-muted-foreground">R$ {(r.revenue ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)}>Fechar</Button>
            <Button onClick={handleSyncGoals} disabled={!syncKioskId || !syncStart || !syncEnd || syncLoading}>
              {syncLoading ? 'Sincronizando...' : 'Executar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
