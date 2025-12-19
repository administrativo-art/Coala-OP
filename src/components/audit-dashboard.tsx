
"use client";

import { useState, useMemo } from 'react';
import { DateRange } from 'react-day-picker';
import { format, parseISO, isValid, differenceInDays } from 'date-fns';
import { useStockAudit } from '@/hooks/use-stock-audit';
import { useKiosks } from '@/hooks/use-kiosks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { CalendarIcon, AlertTriangle, Inbox, Percent, Target, FileSearch, PieChart as PieChartIcon, BarChart2, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AuditDashboard() {
  const { auditSessions, loading: loadingAudits } = useStockAudit();
  const { kiosks, loading: loadingKiosks } = useKiosks();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [kioskId, setKioskId] = useState<string>('all');
  const [status, setStatus] = useState<'all' | 'pending_review' | 'completed'>('all');

  const loading = loadingAudits || loadingKiosks;

  const filteredData = useMemo(() => {
    return auditSessions.filter(session => {
      if (kioskId !== 'all' && session.kioskId !== kioskId) return false;
      if (status !== 'all' && session.status !== status) return false;
      if (dateRange?.from && parseISO(session.startedAt) < dateRange.from) return false;
      if (dateRange?.to) {
        const toDate = new Date(dateRange.to);
        toDate.setHours(23, 59, 59, 999);
        if (parseISO(session.startedAt) > toDate) return false;
      }
      return true;
    });
  }, [auditSessions, kioskId, status, dateRange]);

  const kpis = useMemo(() => {
    if (filteredData.length === 0) {
      return { totalItems: 0, itemsWithDivergence: 0, accuracy: 100, expiringLots: 0 };
    }

    let totalSystemQty = 0;
    let totalCountedQty = 0;
    let itemsWithDivergence = 0;
    let expiringLots = 0;

    const allItems = filteredData.flatMap(s => s.items);

    allItems.forEach(item => {
      totalSystemQty += item.systemQuantity;
      totalCountedQty += item.countedQuantity;
      if (item.systemQuantity !== item.countedQuantity) {
        itemsWithDivergence++;
      }
      const daysUntilExpiry = differenceInDays(parseISO(item.expiryDate), new Date());
      if (daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
        expiringLots++;
      }
    });

    const accuracy = totalSystemQty > 0 ? (totalCountedQty / totalSystemQty) * 100 : 100;

    return {
      totalItems: allItems.length,
      itemsWithDivergence,
      accuracy,
      expiringLots
    };
  }, [filteredData]);

  const divergenceByProduct = useMemo(() => {
      const divergenceMap = new Map<string, { name: string; divergence: number }>();
      filteredData.flatMap(s => s.items).forEach(item => {
          const diff = item.countedQuantity - item.systemQuantity;
          if(diff !== 0) {
              const current = divergenceMap.get(item.productId) || { name: item.productName, divergence: 0 };
              current.divergence += Math.abs(diff);
              divergenceMap.set(item.productId, current);
          }
      });
      return Array.from(divergenceMap.values()).sort((a,b) => b.divergence - a.divergence).slice(0, 5);
  }, [filteredData]);

  const statusDistribution = useMemo(() => {
      const counts = { completed: 0, pending_review: 0 };
      filteredData.forEach(s => {
          if (s.status === 'completed') counts.completed++;
          if (s.status === 'pending_review') counts.pending_review++;
      });
      return [
          { name: 'Concluídas', value: counts.completed, fill: 'hsl(var(--chart-2))' },
          { name: 'Pendentes', value: counts.pending_review, fill: 'hsl(var(--chart-4))' },
      ];
  }, [filteredData]);


  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-lg border p-4">
        <Select value={kioskId} onValueChange={setKioskId}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as unidades</SelectItem>
            {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button id="date" variant="outline" className={cn("w-full sm:w-[260px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (dateRange.to ? <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</> : format(dateRange.from, "LLL dd, y")) : <span>Período</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
          </PopoverContent>
        </Popover>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending_review">Pendente</SelectItem>
            <SelectItem value="completed">Concluída</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Lotes auditados</CardTitle><FileSearch className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.totalItems}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Acurácia geral</CardTitle><Percent className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.accuracy.toFixed(1)}%</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Lotes vencendo (≤30d)</CardTitle><AlertTriangle className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.expiringLots}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Lotes com divergência</CardTitle><Target className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.itemsWithDivergence}</div></CardContent></Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart2 /> Divergência por produto</CardTitle></CardHeader>
            <CardContent>
                {divergenceByProduct.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={divergenceByProduct} layout="vertical" margin={{ left: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={80} interval={0} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="divergence" name="Divergência (un.)" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
                ) : <div className="h-[300px] flex items-center justify-center text-muted-foreground"><Inbox/> Sem divergências no período.</div> }
            </CardContent>
        </Card>
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><PieChartIcon /> Status das auditorias</CardTitle></CardHeader>
            <CardContent>
            {filteredData.length > 0 ? (
                 <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                        <Pie data={statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                             {statusDistribution.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                        </Pie>
                        <Tooltip />
                        <Legend />
                    </PieChart>
                 </ResponsiveContainer>
             ) : <div className="h-[300px] flex items-center justify-center text-muted-foreground"><Inbox/> Sem auditorias no período.</div> }
            </CardContent>
        </Card>
      </div>
       <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileSearch /> Auditorias detalhadas</CardTitle></CardHeader>
        <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Quiosque</TableHead>
                        <TableHead>Auditor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Data</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                     {filteredData.length > 0 ? filteredData.slice(0, 5).map(session => (
                        <TableRow key={session.id}>
                            <TableCell>{session.kioskName}</TableCell>
                            <TableCell>{session.auditedBy.username}</TableCell>
                            <TableCell><Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>{session.status === 'completed' ? 'Concluída' : 'Pendente'}</Badge></TableCell>
                            <TableCell>{format(parseISO(session.startedAt), 'dd/MM/yyyy HH:mm')}</TableCell>
                        </TableRow>
                     )) : (
                        <TableRow><TableCell colSpan={4} className="text-center h-24">Nenhuma auditoria encontrada com os filtros atuais.</TableCell></TableRow>
                     )}
                </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}

    