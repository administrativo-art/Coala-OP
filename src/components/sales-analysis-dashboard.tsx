"use client";

import { useMemo, useState, useEffect, Fragment } from 'react';
import { format, subDays, startOfMonth, endOfMonth, isWithinInterval, parseISO, subMonths, isSameDay, differenceInCalendarDays, startOfWeek } from 'date-fns';
import { useSalesReports } from '@/contexts/sales-report-context';
import { SalesReportProvider } from '@/components/sales-report-provider';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, ComposedChart, Line, LabelList } from 'recharts';
import { TrendingUp, Award, Inbox, ShoppingBag, Calendar, CalendarRange, GitCompare, PieChart as PieIcon, BarChart2, Search, ArrowUpDown, ArrowUp, ArrowDown, Clock, RefreshCw, Layers, AlertTriangle, DollarSign, Users2, LayoutDashboard, Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { syncDayClient } from '@/lib/integrations/pdv-legal-client';
import { GoalsProvider } from '@/components/goals-provider';
import { useGoals } from '@/contexts/goals-context';
import { type SalesReport } from '@/types';

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const COLORS = ['#E91E8C','#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getReportsByPreset(
  reports: SalesReport[], kioskId: string, isAdmin: boolean, user: any, preset: string
): SalesReport[] {
  const today = new Date();
  let start: Date, end: Date;
  switch (preset) {
    case 'yesterday': start = end = subDays(today, 1); break;
    case 'today': start = end = today; break;
    case 'thisMonth': start = startOfMonth(today); end = today; break;
    case 'lastMonth': { const lm = subMonths(today, 1); start = startOfMonth(lm); end = endOfMonth(lm); break; }
    default: start = end = today;
  }
  return reports.filter(r => {
    const km = kioskId === 'all' || r.kioskId === kioskId;
    const um = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
    if (!r.day) {
      if (preset === 'yesterday' || preset === 'today') return false;
      const ms = new Date(r.year, r.month - 1, 1);
      return km && um && ms <= end && endOfMonth(ms) >= start;
    }
    const d = new Date(r.year, r.month - 1, r.day);
    return km && um && (isWithinInterval(d, { start, end }) || isSameDay(d, start) || isSameDay(d, end));
  });
}

type FilterMode = 'overview' | 'compare';

export function SalesAnalysisDashboard() {
  return <SalesReportProvider><GoalsProvider><SalesAnalysisDashboardInner /></GoalsProvider></SalesReportProvider>;
}

function SalesAnalysisDashboardInner() {
  const { salesReports, loading: reportsLoading } = useSalesReports();
  const { kiosks } = useKiosks();
  const { user, permissions, users, firebaseUser } = useAuth();
  const { periods, employeeGoals, templates } = useGoals();
  const { simulations } = useProductSimulation();
  const { categories } = useProductSimulationCategories();
  const { toast } = useToast();

  const isAdmin = permissions.settings.manageUsers;
  const loading = reportsLoading;

  const availableKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter(k => user?.assignedKioskIds?.includes(k.id));
  }, [kiosks, user, isAdmin]);

  // Filtros
  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('overview');
  const [activePreset, setActivePreset] = useState<string>('thisMonth');
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  // Sort and search states
  const [rankingSearch, setRankingSearch] = useState<string>('');
  const [rankingSortDir, setRankingSortDir] = useState<'asc' | 'desc'>('desc');
  const [abcSearch, setAbcSearch] = useState<string>('');
  const [hoveredProduct, setHoveredProduct] = useState<string | null>(null);

  const [compareMonths, setCompareMonths] = useState<string[]>([
    String(new Date().getMonth() || 12),
    String(new Date().getMonth() + 1 > 12 ? 1 : new Date().getMonth() + 1),
  ]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [selectedHour, setSelectedHour] = useState<string | null>(null);

  // Painel Principal — estados remanescentes
  const [panelHourlySelectedProduct, setPanelHourlySelectedProduct] = useState('all');
  const [panelSelectedHour, setPanelSelectedHour] = useState<{ kioskId: string; hourStr: string } | null>(null);
  const [panelProductFilter, setPanelProductFilter] = useState<string[]>([]);
  const [panelColabProductOpen, setPanelColabProductOpen] = useState(false);
  const [panelProductSearch, setPanelProductSearch] = useState('');
  const [expandedProductRows, setExpandedProductRows] = useState<Set<string>>(new Set());

  // Comparativo de qtde — meses selecionáveis (inicia com últimos 3 meses + mesmo mês ano passado)
  const [kioskHistoryMonths, setKioskHistoryMonths] = useState<Array<{ month: number; year: number }>>(() => {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const result: Array<{ month: number; year: number }> = [];
    for (let i = 3; i >= 1; i--) {
      const d = subMonths(now, i);
      result.push({ month: d.getMonth() + 1, year: d.getFullYear() });
    }
    result.push({ month: curMonth, year: curYear - 1 });
    return result;
  });

  const applyPreset = (preset: string) => {
    if (preset === 'custom') {
      setActivePreset('custom');
      return;
    }

    const today = new Date();
    let start = today;
    let end = today;

    switch (preset) {
      case 'yesterday':
        start = end = subDays(today, 1);
        break;
      case 'today':
        start = end = today;
        break;
      case 'thisMonth':
        start = startOfMonth(today);
        end = today;
        break;
      case 'lastMonth':
        const lastMonth = subMonths(today, 1);
        start = startOfMonth(lastMonth);
        end = endOfMonth(lastMonth);
        break;
    }

    setDateRange({
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd')
    });
    setActivePreset(preset);
  };

  const filteredReports = useMemo(() => {
    const start = parseISO(dateRange.start);
    const end = parseISO(dateRange.end);

    // Meses com cobertura diária — relatórios mensais serão ignorados nesses casos
    const dailyCovered = new Set<string>();
    salesReports.forEach(r => {
      if (r.day) dailyCovered.add(`${r.kioskId}-${r.year}-${r.month}`);
    });

    return salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);

      let dateMatch = false;
      if (r.day) {
        const reportDate = new Date(r.year, r.month - 1, r.day);
        dateMatch = isWithinInterval(reportDate, { start, end }) || isSameDay(reportDate, start) || isSameDay(reportDate, end);
      } else {
        // Ignorar relatório mensal se já existem diários para o mesmo mês+quiosque
        if (dailyCovered.has(`${r.kioskId}-${r.year}-${r.month}`)) return false;

        const reportMonthStart = new Date(r.year, r.month - 1, 1);
        const reportMonthEnd = endOfMonth(reportMonthStart);
        dateMatch = reportMonthStart <= end && reportMonthEnd >= start;

        if ((activePreset === 'yesterday' || activePreset === 'today') && !r.day) {
          dateMatch = false;
        }
      }

      return kioskMatch && userKioskMatch && dateMatch;
    });
  }, [salesReports, selectedKioskId, dateRange, activePreset, isAdmin, user]);

  const simulationMap = useMemo(() => new Map(simulations.map(s => [s.id, s])), [simulations]);
  const categoryMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  // ── RANKING ────────────────────────────────────────────────────────────────
  const productRanking = useMemo(() => {
    const totals: Record<string, { name: string; quantity: number; simulationId: string }> = {};
    filteredReports.forEach(r => r.items.forEach(item => {
      if (!totals[item.simulationId]) totals[item.simulationId] = { name: item.productName, quantity: 0, simulationId: item.simulationId };
      totals[item.simulationId].quantity += item.quantity;
    }));
    return Object.values(totals).sort((a, b) => b.quantity - a.quantity);
  }, [filteredReports]);

  // ── CARDS DE RESUMO ────────────────────────────────────────────────────────
  const summaryCards = useMemo(() => {
    const totalUnits = productRanking.reduce((s, p) => s + p.quantity, 0);
    const topProduct = productRanking[0] || null;

    const totalCoupons = filteredReports.reduce((sum, r) => {
      if (!r.hourlySales) return sum;
      return sum + Object.values(r.hourlySales).reduce((a: any, b: any) => Number(a) + Number(b), 0);
    }, 0);

    // Cálculo do período anterior para variação
    const start = parseISO(dateRange.start);
    const end = parseISO(dateRange.end);
    const diff = differenceInCalendarDays(end, start) + 1;
    const prevStart = subDays(start, diff);
    const prevEnd = subDays(end, diff);

    const prevReports = salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      
      if (!r.day) return false;
      const reportDate = new Date(r.year, r.month - 1, r.day);
      const inRange = isWithinInterval(reportDate, { start: prevStart, end: prevEnd }) || 
                      isSameDay(reportDate, prevStart) || isSameDay(reportDate, prevEnd);
      
      return kioskMatch && userKioskMatch && inRange;
    });

    const prevTotal = prevReports.reduce((s, r) => s + r.items.reduce((ss, i) => ss + i.quantity, 0), 0);
    const variation = prevTotal > 0 ? ((totalUnits - prevTotal) / prevTotal) * 100 : null;

    return { totalUnits, topProduct, variation, uniqueProducts: productRanking.length, totalCoupons };
  }, [productRanking, selectedKioskId, salesReports, isAdmin, user, dateRange, filteredReports]);

  // ── CURVA ABC ─────────────────────────────────────────────────────────────
  const abcCurve = useMemo(() => {
    const total = productRanking.reduce((sum, p) => sum + p.quantity, 0);
    if (total === 0) return [];
    let accumulated = 0;
    return productRanking.map(p => {
      accumulated += p.quantity;
      const pct = (accumulated / total) * 100;
      const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...p, pct: (p.quantity / total * 100).toFixed(1), accumulated: pct.toFixed(1), class: cls };
    });
  }, [productRanking]);

  // ── MIX POR LINHA ──────────────────────────────────────────────────────────
  const mixByLine = useMemo(() => {
    const lines: Record<string, { name: string; quantity: number }> = {};
    let noLine = 0;

    filteredReports.forEach(r => r.items.forEach(item => {
      const sim = simulationMap.get(item.simulationId);
      if (!sim?.lineId) { noLine += item.quantity; return; }
      const line = categoryMap.get(sim.lineId);
      if (!line) { noLine += item.quantity; return; }
      if (!lines[line.id]) lines[line.id] = { name: line.name, quantity: 0 };
      lines[line.id].quantity += item.quantity;
    }));

    const result = Object.values(lines).sort((a, b) => b.quantity - a.quantity);
    if (noLine > 0) result.push({ name: 'Sem linha', quantity: noLine });
    return result;
  }, [filteredReports, simulationMap, categoryMap]);

  // ── EVOLUÇÃO MENSAL ────────────────────────────────────────────────────────
  const monthlyEvolution = useMemo(() => {
    const top5 = productRanking.slice(0, 5).map(p => p.simulationId);
    if (filterMode === 'compare') {
      return productRanking.slice(0, 5).map(prod => {
        const entry: Record<string, any> = { product: prod.name };
        compareMonths.forEach(m => {
          const mn = Number(m);
          const monthLabel = MONTHS[mn - 1];
          filteredReports.filter(r => r.month === mn).forEach(r => {
            r.items.forEach(item => {
              if (item.simulationId !== prod.simulationId) return;
              entry[monthLabel] = (entry[monthLabel] || 0) + item.quantity;
            });
          });
        });
        return entry;
      });
    }
    const byMonth: Record<number, Record<string, number>> = {};
    filteredReports.forEach(r => {
      if (!byMonth[r.month]) byMonth[r.month] = {};
      r.items.forEach(item => {
        if (!top5.includes(item.simulationId)) return;
        byMonth[r.month][item.productName] = (byMonth[r.month][item.productName] || 0) + item.quantity;
      });
    });
    return MONTH_NUMS.map(m => ({ month: MONTHS[m - 1], ...(byMonth[m] || {}) })).filter(m => Object.keys(m).length > 1);
  }, [filteredReports, productRanking, filterMode, compareMonths]);

  // ── COMPARATIVO QUIOSQUES ──────────────────────────────────────────────────
  const kioskComparison = useMemo(() => {
    const byKiosk: Record<string, { kioskName: string; total: number }> = {};
    filteredReports.filter(r => isAdmin || user?.assignedKioskIds?.includes(r.kioskId)).forEach(r => {
      if (!byKiosk[r.kioskId]) byKiosk[r.kioskId] = { kioskName: r.kioskName || r.kioskId, total: 0 };
      r.items.forEach(item => { byKiosk[r.kioskId].total += item.quantity; });
    });
    return Object.entries(byKiosk).map(([kioskId, data]) => ({ kioskId, ...data })).sort((a, b) => b.total - a.total);
  }, [filteredReports, isAdmin, user]);

  const [hourlySelectedProduct, setHourlySelectedProduct] = useState<string>('all');
  const [comboSearch, setComboSearch] = useState('');

  // ── COMBOS (CESTA DE COMPRAS) ──────────────────────────────────────────────
  const aggregatedCombos = useMemo(() => {
    const combosMap = new Map<string, number>();
    
    filteredReports.forEach(r => {
      // Ignoramos o erro de tipagem caso combos não exista no tipo antigo
      const combos = (r as any).combos || [];
      combos.forEach((c: any) => {
        combosMap.set(c.name, (combosMap.get(c.name) || 0) + c.count);
      });
    });

    let result = Array.from(combosMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    if (comboSearch) {
      result = result.filter(c => c.name.toLowerCase().includes(comboSearch.toLowerCase()));
    }

    return result;
  }, [filteredReports, comboSearch]);

  // ── VENDAS POR HORA ────────────────────────────────────────────────────────
  const hourlySalesData = useMemo(() => {
    const hours: Record<string, {
      totalUnits: number;
      totalCoupons: number;
      products: Record<string, { simulationId: string; name: string; quantity: number }>;
    }> = {};
    for (let i = 0; i < 24; i++) {
      hours[i.toString().padStart(2, '0')] = { totalUnits: 0, totalCoupons: 0, products: {} };
    }

    filteredReports.forEach(r => {
      if (r.hourlySales) {
        Object.entries(r.hourlySales).forEach(([hour, qty]) => {
          if (!hours[hour]) return;
          hours[hour].totalCoupons += Number(qty) || 0;
        });
      }

      if (r.productHourlySales) {
        Object.entries(r.productHourlySales).forEach(([simulationId, hourlyData]) => {
          const item = r.items.find(i => i.simulationId === simulationId);
          if (!item) return;
          Object.entries(hourlyData).forEach(([hour, qty]) => {
            if (!hours[hour]) return;
            hours[hour].totalUnits += qty;
            if (!hours[hour].products[simulationId]) {
              hours[hour].products[simulationId] = { simulationId, name: item.productName, quantity: 0 };
            }
            hours[hour].products[simulationId].quantity += qty;
          });
        });
      } else {
        r.items.forEach(item => {
          const hour = item.timestamp ? item.timestamp.split(':')[0] : '00';
          if (hours[hour]) {
            hours[hour].totalUnits += (item.quantity || 0);
            if (!hours[hour].products[item.simulationId]) {
              hours[hour].products[item.simulationId] = { simulationId: item.simulationId, name: item.productName, quantity: 0 };
            }
            hours[hour].products[item.simulationId].quantity += (item.quantity || 0);
          }
        });
      }
    });

    return Object.entries(hours)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, data]) => ({
        hourStr: hour,
        hour: `${hour}h`,
        total: data.totalUnits,
        coupons: data.totalCoupons,
        products: Object.values(data.products).sort((a, b) => b.quantity - a.quantity)
      }));
  }, [filteredReports]);

  const filteredHourlyData = useMemo(() => {
    return hourlySalesData.map(d => {
      let displayValue = 0;
      if (hourlySelectedProduct === 'all') {
        displayValue = d.coupons;
      } else {
        const prod = d.products.find(p => p.simulationId === hourlySelectedProduct);
        displayValue = prod ? prod.quantity : 0;
      }
      return {
        ...d,
        displayValue
      };
    });
  }, [hourlySalesData, hourlySelectedProduct]);

  // ── PAINEL: MIX — segue filteredReports ──────────────────────────────────
  // (mix por linha é reaproveitado de mixByLine que já usa filteredReports)

  // ── PAINEL: QUIOSQUES — histórico com meses selecionáveis ────────────────
  const panelKioskHistoryData = useMemo(() => {
    const now = new Date();
    const curYear = now.getFullYear();
    const periods = kioskHistoryMonths.map(({ month, year }) => ({
      label: year !== curYear ? `${MONTHS[month - 1]} ${year}` : MONTHS[month - 1],
      month,
      year,
      isLastYear: year !== curYear,
    }));

    return availableKiosks
      .filter(k => isAdmin || user?.assignedKioskIds?.includes(k.id))
      .map(kiosk => ({
        kioskId: kiosk.id,
        kioskName: kiosk.name,
        chartData: periods.map(p => ({
          label: p.label,
          qty: salesReports
            .filter(r => r.kioskId === kiosk.id && r.month === p.month && r.year === p.year)
            .reduce((s, r) => s + r.items.reduce((ss, i) => ss + i.quantity, 0), 0),
          isLastYear: p.isLastYear,
        })),
      }));
  }, [salesReports, availableKiosks, isAdmin, user, kioskHistoryMonths]);

  // ── PAINEL: HORÁRIOS — por quiosque ─────────────────────────────────────
  const buildHourlyData = (reports: SalesReport[]) => {
    const hours: Record<string, {
      totalUnits: number;
      totalCoupons: number;
      products: Record<string, { simulationId: string; name: string; quantity: number }>;
    }> = {};
    for (let i = 0; i < 24; i++) hours[i.toString().padStart(2, '0')] = { totalUnits: 0, totalCoupons: 0, products: {} };
    reports.forEach(r => {
      if (r.hourlySales) {
        Object.entries(r.hourlySales).forEach(([hour, qty]) => {
          if (!hours[hour]) return;
          hours[hour].totalCoupons += Number(qty) || 0;
        });
      }

      if (r.productHourlySales) {
        Object.entries(r.productHourlySales).forEach(([simId, hourlyData]) => {
          const item = r.items.find(i => i.simulationId === simId);
          if (!item) return;
          Object.entries(hourlyData).forEach(([hour, qty]) => {
            if (!hours[hour]) return;
            hours[hour].totalUnits += qty;
            if (!hours[hour].products[simId]) hours[hour].products[simId] = { simulationId: simId, name: item.productName, quantity: 0 };
            hours[hour].products[simId].quantity += qty;
          });
        });
      } else {
        r.items.forEach(item => {
          const hour = item.timestamp ? item.timestamp.split(':')[0] : '00';
          if (hours[hour]) {
            hours[hour].totalUnits += (item.quantity || 0);
            if (!hours[hour].products[item.simulationId]) hours[hour].products[item.simulationId] = { simulationId: item.simulationId, name: item.productName, quantity: 0 };
            hours[hour].products[item.simulationId].quantity += (item.quantity || 0);
          }
        });
      }
    });
    return Object.entries(hours)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, data]) => ({
        hourStr: hour,
        hour: `${hour}h`,
        total: data.totalUnits,
        coupons: data.totalCoupons,
        products: Object.values(data.products).sort((a, b) => b.quantity - a.quantity),
      }));
  };

  const panelHourlyByKiosk = useMemo(() => {
    return availableKiosks
      .filter(k => isAdmin || user?.assignedKioskIds?.includes(k.id))
      .map(kiosk => ({
        kioskId: kiosk.id,
        kioskName: kiosk.name,
        data: buildHourlyData(filteredReports.filter(r => r.kioskId === kiosk.id)),
      }));
  }, [filteredReports, availableKiosks, isAdmin, user]);

  // ── PAINEL: EVOLUÇÃO — usa meses presentes em filteredReports ────────────
  const panelEvolution = useMemo(() => {
    const monthNums = [...new Set(filteredReports.map(r => r.month))].sort((a, b) => a - b);
    const totals: Record<string, { name: string; quantity: number; simulationId: string }> = {};
    filteredReports.forEach(r => r.items.forEach(item => {
      if (!totals[item.simulationId]) totals[item.simulationId] = { name: item.productName, quantity: 0, simulationId: item.simulationId };
      totals[item.simulationId].quantity += item.quantity;
    }));
    const top5 = Object.values(totals).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    return top5.map(prod => {
      const entry: Record<string, any> = { product: prod.name };
      monthNums.forEach(m => {
        filteredReports.filter(r => r.month === m).forEach(r => {
          r.items.forEach(item => {
            if (item.simulationId !== prod.simulationId) return;
            entry[MONTHS[m - 1]] = (entry[MONTHS[m - 1]] || 0) + item.quantity;
          });
        });
      });
      return entry;
    });
  }, [filteredReports]);

  // ── PDV operator ID → username map ───────────────────────────────────────
  const pdvOperatorMap = useMemo(() => {
    const map = new Map<string, string>(); // pdvOperatorId (string) → username
    for (const u of users as { id: string; username: string; pdvOperatorIds?: Record<string, number> }[]) {
      if (!u.pdvOperatorIds) continue;
      for (const opId of Object.values(u.pdvOperatorIds)) {
        map.set(String(opId), u.username);
      }
    }
    return map;
  }, [users]);

  // ── PAINEL: QTDE PRODUTO POR QUIOSQUE — segue filtro do topo ────────────
  const panelProductQtyByKiosk = useMemo(() => {
    if (panelProductFilter.length === 0) return new Map<string, {
      total: Record<string, number>;
      byOperator: Record<string, Record<string, number>>; // simulationId → { username → qty }
    }>();

    const result = new Map<string, {
      total: Record<string, number>;
      byOperator: Record<string, Record<string, number>>;
    }>();

    filteredReports.filter(r => {
      return !!r.day;
    }).forEach(r => {
      if (!result.has(r.kioskId)) result.set(r.kioskId, { total: {}, byOperator: {} });
      const entry = result.get(r.kioskId)!;

      // Total per product
      r.items.forEach(item => {
        if (!panelProductFilter.includes(item.simulationId)) return;
        entry.total[item.simulationId] = (entry.total[item.simulationId] || 0) + item.quantity;
      });

      // Per operator per product (from productQtyByOperator field)
      const opData = (r as any).productQtyByOperator as Record<string, Record<string, number>> | undefined;
      if (opData) {
        for (const [pdvOpId, simQtys] of Object.entries(opData)) {
          const userName = pdvOperatorMap.get(pdvOpId) ?? pdvOpId;
          for (const [simId, qty] of Object.entries(simQtys)) {
            if (!panelProductFilter.includes(simId)) continue;
            if (!entry.byOperator[simId]) entry.byOperator[simId] = {};
            entry.byOperator[simId][userName] = (entry.byOperator[simId][userName] || 0) + qty;
          }
        }
      }
    });

    return result;
  }, [filteredReports, panelProductFilter, pdvOperatorMap]);

  // ── PAINEL: FATURAMENTO (via goalPeriods.dailyProgress) ───────────────────
  const faturamento = useMemo(() => {
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const prevMonthSameDay = format(subMonths(today, 1), 'yyyy-MM-dd');
    const prevMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');
    const prevWeekStart = format(startOfWeek(subMonths(today, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const prevWeekEnd = format(subMonths(today, 1), 'yyyy-MM-dd');

    // Deduplicate revenue: for each kiosk, only count one value per date
    const kioskDateRev: Record<string, Record<string, number>> = {};
    for (const p of periods) {
      if (selectedKioskId !== 'all' && p.kioskId !== selectedKioskId) continue;
      if (!p.dailyProgress) continue;
      if (!kioskDateRev[p.kioskId]) kioskDateRev[p.kioskId] = {};
      for (const [date, amount] of Object.entries(p.dailyProgress)) {
        if (kioskDateRev[p.kioskId][date] === undefined) kioskDateRev[p.kioskId][date] = amount;
      }
    }

    const sumRange = (from: string, to: string) => {
      let total = 0;
      for (const dateMap of Object.values(kioskDateRev))
        for (const [date, amount] of Object.entries(dateMap))
          if (date >= from && date <= to) total += amount;
      return total;
    };

    const sumKioskRange = (dateMap: Record<string, number>, from: string, to: string) =>
      Object.entries(dateMap).filter(([d]) => d >= from && d <= to).reduce((s, [, v]) => s + v, 0);

    // Revenue-type template ids
    const revTemplateIds = new Set(templates.filter(t => (t as any).type === 'revenue' || !(t as any).type).map(t => t.id));

    const byKiosk = Object.entries(kioskDateRev).map(([kioskId, dateMap]) => {
      const kioskObj = kiosks.find(k => k.id === kioskId);

      // Pick the revenue periods for this kiosk that are active in the current month
      const kioskRevPeriods = periods.filter(p =>
        p.kioskId === kioskId &&
        p.dailyProgress &&
        Object.keys(p.dailyProgress).some(d => d >= monthStart && d <= todayStr) &&
        (revTemplateIds.size === 0 || revTemplateIds.has(p.templateId))
      );
      // Deduplicate: take one period per unique targetValue to avoid double-counting
      // (multiple periods of same kiosk get the same daily revenue written to all)
      // Strategy: use the period with highest targetValue as the "main" goal
      const mainPeriod = kioskRevPeriods.sort((a, b) => (b.targetValue || 0) - (a.targetValue || 0))[0];

      return {
        kioskId,
        name: kioskObj?.name || kioskId,
        month: sumKioskRange(dateMap, monthStart, todayStr),
        prevMonth: sumKioskRange(dateMap, prevMonthStart, prevMonthSameDay),
        week: sumKioskRange(dateMap, weekStart, todayStr),
        prevWeek: sumKioskRange(dateMap, prevWeekStart, prevWeekEnd),
        day: sumKioskRange(dateMap, todayStr, todayStr),
        prevDay: sumKioskRange(dateMap, prevMonthSameDay, prevMonthSameDay),
        targetValue: mainPeriod?.targetValue ?? 0,
        upValue: mainPeriod?.upValue ?? 0,
      };
    }).filter(k => k.month > 0 || k.week > 0 || k.day > 0).sort((a, b) => b.month - a.month);

    return {
      month: sumRange(monthStart, todayStr),
      prevMonth: sumRange(prevMonthStart, prevMonthSameDay),
      week: sumRange(weekStart, todayStr),
      prevWeek: sumRange(prevWeekStart, prevWeekEnd),
      day: sumRange(todayStr, todayStr),
      prevDay: sumRange(prevMonthSameDay, prevMonthSameDay),
      rangeRevenue: sumRange(dateRange.start, dateRange.end),
      byKiosk,
      hasData: periods.length > 0,
      byDate: (() => {
        const map: Record<string, number> = {};
        for (const [kId, dateMap] of Object.entries(kioskDateRev)) {
          if (selectedKioskId !== 'all' && kId !== selectedKioskId) continue;
          for (const [date, amount] of Object.entries(dateMap)) {
            map[date] = (map[date] ?? 0) + amount;
          }
        }
        return map;
      })(),
    };
  }, [periods, templates, selectedKioskId, kiosks, dateRange]);

  // ── PAINEL: COLABORADORES (faturamento mês corrente) ─────────────────────
  const colaboradoresFaturamento = useMemo(() => {
    const today = new Date();
    const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');
    const todayStr = format(today, 'yyyy-MM-dd');

    // Map: `empId|||kioskId` → accumulated daily revenue (dedup by date)
    const byEmpKiosk = new Map<string, {
      employeeId: string; kioskId: string;
      dailyRev: Record<string, number>;
      targetValue: number; upValue: number;
    }>();

    for (const eg of employeeGoals) {
      if (selectedKioskId !== 'all' && eg.kioskId !== selectedKioskId) continue;
      if (!eg.dailyProgress) continue;

      // Compute UP proportional: period.upValue * (eg.targetValue / period.targetValue)
      const period = periods.find(p => p.id === eg.periodId);
      const upValue = period && period.targetValue > 0
        ? period.upValue * (eg.targetValue / period.targetValue)
        : 0;

      const key = `${eg.employeeId}|||${eg.kioskId}`;
      if (!byEmpKiosk.has(key)) {
        byEmpKiosk.set(key, { employeeId: eg.employeeId, kioskId: eg.kioskId, dailyRev: {}, targetValue: eg.targetValue, upValue });
      } else {
        // Accumulate targets across multiple active periods for same employee+kiosk
        const entry = byEmpKiosk.get(key)!;
        entry.targetValue += eg.targetValue;
        entry.upValue += upValue;
      }
      const entry = byEmpKiosk.get(key)!;
      for (const [date, amount] of Object.entries(eg.dailyProgress)) {
        if (date >= monthStart && date <= todayStr && entry.dailyRev[date] === undefined)
          entry.dailyRev[date] = amount;
      }
    }

    return Array.from(byEmpKiosk.values())
      .map(({ employeeId, kioskId, dailyRev, targetValue, upValue }) => {
        const monthRevenue = Object.values(dailyRev).reduce((s, v) => s + v, 0);
        const u = (users as { id: string; username: string }[]).find(u => u.id === employeeId);
        const kiosk = kiosks.find(k => k.id === kioskId);
        return { employeeId, userName: u?.username ?? employeeId, kioskId, kioskName: kiosk?.name || kioskId, monthRevenue, targetValue, upValue };
      })
      .filter(c => c.monthRevenue > 0)
      .sort((a, b) => b.monthRevenue - a.monthRevenue);
  }, [employeeGoals, periods, selectedKioskId, users, kiosks]);

  const handleSyncPDVLegal = async (retroactive = false) => {
    setIsSyncing(true);
    setSyncProgress(retroactive ? 'Iniciando sincronização retroativa (Janeiro → Hoje)...' : `Sincronizando período selecionado...`);

    const KIOSK_MAP: Record<string, string> = {
      'tirirical': '17343',
      'joao-paulo': '17344',
    };

    try {
      const days: string[] = [];
      if (retroactive) {
        // Gera lista de dias desde 1 de Janeiro de 2026 até hoje
        const start = new Date(2026, 0, 1);
        const end = new Date();
        const current = new Date(start);
        while (current <= end) {
          days.push(current.toISOString().split('T')[0]);
          current.setDate(current.getDate() + 1);
        }
      } else {
        // Sincroniza o período atualmente selecionado no filtro
        const start = parseISO(dateRange.start);
        const end = parseISO(dateRange.end);
        const current = new Date(start);
        while (current <= end) {
          days.push(format(current, 'yyyy-MM-dd'));
          current.setDate(current.getDate() + 1);
        }
      }

      const kiosksToSync = selectedKioskId === 'all' ? Object.keys(KIOSK_MAP) : [selectedKioskId];
      let processedCount = 0;
      let totalItemsCount = 0;
      const failedDays: string[] = [];
      const totalSteps = days.length * kiosksToSync.length;

      const idToken = await firebaseUser?.getIdToken();
      if (!idToken) throw new Error('Usuário não autenticado.');

      for (const day of days) {
        for (const kId of kiosksToSync) {
          if (!KIOSK_MAP[kId]) continue;

          processedCount++;
          setSyncProgress(`[${processedCount}/${totalSteps}] ${day} - ${kId}...`);

          try {
            const res = await syncDayClient(day, kId, idToken);
            totalItemsCount += (res.count || 0);
          } catch (e: any) {
            console.error(`[Sync Fail] ${day} ${kId}:`, e);
            failedDays.push(`${day} (${kId})`);
          }
        }
      }
      
      const successCount = (days.length * kiosksToSync.length) - failedDays.length;
      
      toast({
        title: 'Sincronização concluída!',
        description: `Sucesso: ${successCount} relatórios. Falhas: ${failedDays.length}. Itens processados: ${totalItemsCount}.`,
        variant: failedDays.length > 0 ? 'destructive' : 'default',
      });

      if (failedDays.length > 0) {
        console.warn('Dias que falharam:', failedDays);
      }
      
      // Recarregar com delay de 3 segundos para o usuário ver o toast
      console.log(`[Sync] Sucesso total: ${totalItemsCount} itens. Recarregando página em 3s...`);
      setTimeout(() => {
        window.location.reload();
      }, 3500);
    } catch (e: any) {
      console.error('[Fatal Sync Error]', e);
      toast({
        title: 'Erro fatal na sincronização',
        description: e.message || 'Houve um erro crítico ao sincronizar.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  const filteredRanking = useMemo(() => {
    let result = [...productRanking];
    if (rankingSearch) result = result.filter(p => p.name.toLowerCase().includes(rankingSearch.toLowerCase()));
    if (rankingSortDir === 'asc') result = result.reverse();
    
    // Debug da tabela no console
    console.log(`[Dashboard] Tabela Ranking: ${result.length} produtos exibidos.`, result);
    
    return result;
  }, [productRanking, rankingSearch, rankingSortDir]);

  const unmappedData = useMemo(() => {
    const unmapped = new Map<string, string>();
    filteredReports.forEach(r => {
      if ((r as any).unmappedList) {
        (r as any).unmappedList.forEach((item: any) => unmapped.set(item.sku, item.name));
      }
    });
    return Array.from(unmapped.entries()).map(([sku, name]) => ({ sku, name }));
  }, [filteredReports]);

  const filteredAbc = useMemo(() => {
    if (!abcSearch) return abcCurve;
    return abcCurve.filter(p => p.name.toLowerCase().includes(abcSearch.toLowerCase()));
  }, [abcCurve, abcSearch]);

  const top5Names = useMemo(() => productRanking.slice(0, 5).map(p => p.name), [productRanking]);

  // ── BREAKDOWN DIÁRIO ───────────────────────────────────────────────────────
  const dailyBreakdown = useMemo(() => {
    const byDay: Record<string, {
      date: string; label: string;
      units: number; coupons: number; revenue: number;
      productTotals: Record<string, { name: string; qty: number }>;
    }> = {};

    filteredReports.filter(r => r.day).forEach(r => {
      const dateKey = `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day!).padStart(2, '0')}`;
      if (!byDay[dateKey]) {
        const dow = new Date(r.year, r.month - 1, r.day!).getDay();
        byDay[dateKey] = {
          date: dateKey,
          label: `${String(r.day!).padStart(2, '0')}/${String(r.month).padStart(2, '0')} ${WEEKDAYS[dow]}`,
          units: 0, coupons: 0, revenue: 0, productTotals: {},
        };
      }
      const entry = byDay[dateKey];
      r.items.forEach(item => {
        entry.units += item.quantity;
        if (!entry.productTotals[item.simulationId]) entry.productTotals[item.simulationId] = { name: item.productName, qty: 0 };
        entry.productTotals[item.simulationId].qty += item.quantity;
      });
      if (r.hourlySales) {
        entry.coupons += Object.values(r.hourlySales).reduce((a: any, b: any) => Number(a) + Number(b), 0);
      }
    });

    Object.keys(byDay).forEach(dateKey => {
      byDay[dateKey].revenue = faturamento.byDate[dateKey] ?? 0;
    });

    const sorted = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) return [];

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const completedDays = sorted.filter(d => d.date !== todayStr);
    const maxUnits = completedDays.length > 0 ? Math.max(...completedDays.map(d => d.units)) : 0;
    const positiveUnits = completedDays.filter(d => d.units > 0).map(d => d.units);
    const minPositive = positiveUnits.length > 0 ? Math.min(...positiveUnits) : 0;
    const avg = Math.round(sorted.reduce((s, d) => s + d.units, 0) / sorted.length);

    return sorted.map((day, i) => {
      const isToday = day.date === todayStr;
      const top = Object.values(day.productTotals).sort((a, b) => b.qty - a.qty)[0];
      const prev = sorted[i - 1];
      const delta = prev && prev.units > 0 ? ((day.units - prev.units) / prev.units) * 100 : null;
      return {
        date: day.date,
        label: day.label,
        units: day.units,
        coupons: day.coupons,
        revenue: day.revenue,
        ticketMedio: day.coupons > 0 && day.revenue > 0 ? day.revenue / day.coupons : null,
        topProduct: top?.name ?? null,
        delta,
        avg,
        isToday,
        isBest: !isToday && day.units === maxUnits && maxUnits > 0,
        isWorst: !isToday && day.units === minPositive && completedDays.length > 1 && day.units > 0 && day.units !== maxUnits,
      };
    });
  }, [filteredReports, faturamento]);

  const periodLabel = useMemo(() => {
    if (filterMode === 'compare') return compareMonths.map(m => MONTHS[Number(m) - 1]).join(' vs ');
    if (activePreset === 'yesterday') return 'Ontem';
    if (activePreset === 'today') return 'Hoje';
    if (activePreset === 'thisMonth') return 'Este Mês';
    if (activePreset === 'lastMonth') return 'Mês Passado';
    try {
      return `${format(parseISO(dateRange.start), 'dd/MM/yy')} → ${format(parseISO(dateRange.end), 'dd/MM/yy')}`;
    } catch {
      return 'Período customizado';
    }
  }, [filterMode, activePreset, dateRange, compareMonths]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;

  if (salesReports.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Inbox className="h-12 w-12 mb-4" />
      <p className="font-semibold text-lg">Nenhum dado de vendas</p>
      <p className="text-sm">Importe um relatório de vendas ou sincronize com o PDV Legal para começar.</p>
      <Button variant="outline" className="mt-4 gap-2" onClick={() => handleSyncPDVLegal(true)} disabled={isSyncing}>
        <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
        Sincronizar PDV Legal
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end bg-card p-4 rounded-xl border shadow-sm">
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Quiosque</p>
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
            <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Período prático</p>
          <ToggleGroup type="single" value={activePreset} onValueChange={v => v && applyPreset(v)} className="bg-muted/50 p-1 rounded-lg border">
            <ToggleGroupItem value="yesterday" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Ontem</ToggleGroupItem>
            <ToggleGroupItem value="today" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Hoje</ToggleGroupItem>
            <ToggleGroupItem value="thisMonth" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Mês Atual</ToggleGroupItem>
            <ToggleGroupItem value="lastMonth" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Mês Passado</ToggleGroupItem>
            <ToggleGroupItem value="custom" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Intervalo</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {activePreset === 'custom' && (
          <div className="flex items-end gap-2 animate-in fade-in slide-in-from-left-2 grow max-w-xs">
            <div className="space-y-1.5 grow">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Início</p>
              <Input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5 grow">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Fim</p>
              <Input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-9 text-xs" />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Evolução Mensal</p>
          <ToggleGroup type="single" value={filterMode} onValueChange={v => v && setFilterMode(v as FilterMode)} className="bg-muted/50 p-1 rounded-lg border">
            <ToggleGroupItem value="overview" className="h-7 px-3 text-[11px] text-foreground data-[state=on]:bg-background data-[state=on]:shadow-sm">Período</ToggleGroupItem>
            <ToggleGroupItem value="compare" className="h-7 px-3 text-[11px] text-foreground data-[state=on]:bg-background data-[state=on]:shadow-sm">Por Mês</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {filterMode === 'compare' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Meses para comparar</p>
            <div className="flex gap-1 bg-muted/30 p-1 rounded-lg border">
              {[1, 2, 3, 10, 11, 12].map(m => (
                <Button key={m} size="sm" variant={compareMonths.includes(String(m)) ? 'default' : 'ghost'} className="h-7 w-10 text-[10px] px-0"
                  onClick={() => setCompareMonths(prev => prev.includes(String(m)) ? prev.filter(x => x !== String(m)) : [...prev, String(m)])}>
                  {MONTHS[m-1]}
                </Button>
              ))}
            </div>
          </div>
        )}


      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary">{parseISO(dateRange.start).getFullYear()}</Badge>
        <Badge variant="outline">{periodLabel}</Badge>
      </div>

      {unmappedData.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/30">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-orange-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Produtos do PDV não mapeados ({unmappedData.length})
            </CardTitle>
            <CardDescription className="text-xs text-orange-700">
              Estes SKUs foram encontrados no PDV Legal mas não estão vinculados a nenhuma Ficha Técnica. 
              Vincule-os para que apareçam na análise.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <div className="flex flex-wrap gap-2">
              {unmappedData.slice(0, 15).map((item, idx) => (
                <Badge key={idx} variant="outline" className="bg-background/80 text-[10px] border-orange-200">
                  <span className="font-bold mr-1">{item.sku}:</span> {item.name}
                </Badge>
              ))}
              {unmappedData.length > 15 && <span className="text-[10px] text-muted-foreground">...e mais {unmappedData.length - 15}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {productRanking.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total de cupons</p>
              <p className="text-2xl font-bold">{summaryCards.totalCoupons.toLocaleString('pt-BR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Produtos vendidos</p>
              <p className="text-2xl font-bold">{summaryCards.totalUnits.toLocaleString('pt-BR')}</p>
              {summaryCards.variation !== null && (
                <p className={cn("text-xs font-semibold mt-1", summaryCards.variation >= 0 ? "text-green-600" : "text-destructive")}>
                  {summaryCards.variation >= 0 ? '▲' : '▼'} {Math.abs(summaryCards.variation).toFixed(1)}% vs anterior
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Faturamento</p>
              <p className="text-2xl font-bold">
                {faturamento.rangeRevenue > 0 ? `R$ ${fmt(faturamento.rangeRevenue)}` : <span className="text-muted-foreground text-lg">—</span>}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Ticket médio</p>
              <p className="text-2xl font-bold">
                {faturamento.rangeRevenue > 0 && summaryCards.totalCoupons > 0
                  ? `R$ ${fmt(faturamento.rangeRevenue / summaryCards.totalCoupons)}`
                  : <span className="text-muted-foreground text-lg">—</span>}
              </p>
              {faturamento.rangeRevenue > 0 && summaryCards.totalCoupons > 0 && <p className="text-xs text-muted-foreground mt-1">por cupom</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Top Produto</p>
              <p className="text-lg font-bold truncate">{summaryCards.topProduct?.name || '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">{summaryCards.topProduct?.quantity.toLocaleString('pt-BR')} un</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="painel">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
          <TabsTrigger value="painel"><LayoutDashboard className="mr-1 h-3 w-3" /> Painel</TabsTrigger>
          <TabsTrigger value="ranking"><Award className="mr-1 h-3 w-3" /> Ranking</TabsTrigger>
          <TabsTrigger value="combos"><Layers className="mr-1 h-3 w-3" /> Combos</TabsTrigger>
          <TabsTrigger value="abc"><BarChart2 className="mr-1 h-3 w-3" /> Curva ABC</TabsTrigger>
        </TabsList>

        <TabsContent value="combos" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>Cesta de Compras (Combos)</CardTitle>
                  <CardDescription>Descubra os produtos mais comprados juntos no mesmo cupom.</CardDescription>
                </div>
                <div className="relative w-full sm:w-[280px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar produtos no combo..." value={comboSearch} onChange={e => setComboSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {aggregatedCombos.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  Nenhum dado de combos encontrado. Tente ressincronizar os relatórios para calcular as cestas de compras.
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                      <tr>
                        <th className="px-4 py-3 w-16">#</th>
                        <th className="px-4 py-3">Itens no mesmo cupom</th>
                        <th className="px-4 py-3 text-right">Qtd. de cupons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedCombos.map((combo, idx) => (
                        <tr key={idx} className="border-t hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {combo.name.split(' + ').map((item, i) => {
                                const [qtd, nome] = item.split('x ');
                                return (
                                  <Badge key={i} variant="secondary" className="font-normal border">
                                    <span className="font-bold mr-1">{qtd}x</span> {nome}
                                  </Badge>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold">{combo.count.toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ranking" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>Ranking de Vendas</CardTitle>
                <div className="relative w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={rankingSearch} onChange={e => setRankingSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                    <tr>
                      <th className="px-4 py-3 w-10">#</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3 text-right cursor-pointer" onClick={() => setRankingSortDir(d => d === 'desc' ? 'asc' : 'desc')}>
                        Qtd {rankingSortDir === 'desc' ? '↓' : '↑'}
                      </th>
                      <th className="px-4 py-3 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRanking.map((item, i) => (
                      <tr key={`${item.simulationId}-${i}`} className="border-t hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{item.name || 'Sem nome'}</td>
                        <td className="px-4 py-3 text-right font-bold text-foreground">{item.quantity?.toLocaleString('pt-BR') || '0'}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {summaryCards.totalUnits > 0 ? ((item.quantity / summaryCards.totalUnits) * 100).toFixed(1) : '0'}%
                        </td>
                      </tr>
                    ))}
                    {filteredRanking.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                          Nenhum produto exibido para este filtro. (Total de {salesReports.length} relatórios carregados)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abc" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>Curva ABC</CardTitle>
                <div className="relative w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={abcSearch} onChange={e => setAbcSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Acum.</TableHead>
                    <TableHead className="text-right">Classe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAbc.map((item) => (
                    <TableRow key={item.simulationId}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right">{item.pct}%</TableCell>
                      <TableCell className="text-right">{item.accumulated}%</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={item.class === 'A' ? 'default' : item.class === 'B' ? 'secondary' : 'outline'}>{item.class}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PAINEL PRINCIPAL ─────────────────────────────────────────── */}
        <TabsContent value="painel" className="mt-4 space-y-10">

          {/* FATURAMENTO */}
          <section>
            <div className="flex items-center gap-2 border-b pb-2 mb-4">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Faturamento do mês</h3>
              {!faturamento.hasData && (
                <Badge variant="outline" className="ml-2 text-[10px]">Configure metas para ver faturamento</Badge>
              )}
            </div>

            {/* Helper inline para renderizar um bloco Mês/Semana/Dia */}
            {(() => {
              const Var = ({ pct }: { pct: number | null }) => pct === null ? null : (
                <span className={cn("text-[10px] font-semibold", pct >= 0 ? "text-green-500" : "text-destructive")}>
                  {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
                </span>
              );

              const FatBlock = ({ label, month, prevMonth, week, prevWeek, day, prevDay, targetValue, upValue }: {
                label: string;
                month: number; prevMonth: number;
                week: number; prevWeek: number;
                day: number; prevDay: number;
                targetValue?: number; upValue?: number;
              }) => {
                const pctMonth = prevMonth > 0 ? ((month - prevMonth) / prevMonth) * 100 : null;
                const pctWeek  = prevWeek  > 0 ? ((week  - prevWeek)  / prevWeek)  * 100 : null;
                const pctDay   = prevDay   > 0 ? ((day   - prevDay)   / prevDay)   * 100 : null;
                const pctAlvo  = targetValue && targetValue > 0 ? (month / targetValue) * 100 : null;
                const pctUp    = upValue    && upValue    > 0 ? (month / upValue)    * 100 : null;
                return (
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs font-semibold text-muted-foreground mb-3">{label}</p>
                      <div className="grid grid-cols-3 gap-3 divide-x divide-border mb-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Mês corrente</p>
                          <p className="text-base font-bold leading-tight">R$ {fmt(month)}</p>
                          {pctMonth === null && prevMonth === 0 && month > 0
                            ? <p className="text-[10px] text-muted-foreground">sem dado ant.</p>
                            : <Var pct={pctMonth} />}
                        </div>
                        <div className="pl-3">
                          <p className="text-[10px] text-muted-foreground">Semana</p>
                          <p className="text-base font-bold leading-tight">R$ {fmt(week)}</p>
                          <Var pct={pctWeek} />
                        </div>
                        <div className="pl-3">
                          <p className="text-[10px] text-muted-foreground">Hoje</p>
                          <p className="text-base font-bold leading-tight">R$ {fmt(day)}</p>
                          <Var pct={pctDay} />
                        </div>
                      </div>
                      {(targetValue || upValue) ? (
                        <div className="grid grid-cols-2 gap-3 pt-3 border-t divide-x divide-border">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Meta alvo</p>
                            <p className="text-sm font-semibold leading-tight">R$ {fmt(targetValue ?? 0)}</p>
                            {pctAlvo !== null && (
                              <span className={cn("text-[10px] font-bold", pctAlvo >= 100 ? "text-green-500" : pctAlvo >= 70 ? "text-yellow-500" : "text-destructive")}>
                                {pctAlvo.toFixed(1)}% atingido
                              </span>
                            )}
                          </div>
                          <div className="pl-3">
                            <p className="text-[10px] text-muted-foreground">Meta UP</p>
                            <p className="text-sm font-semibold leading-tight">R$ {fmt(upValue ?? 0)}</p>
                            {pctUp !== null && (
                              <span className={cn("text-[10px] font-bold", pctUp >= 100 ? "text-green-500" : pctUp >= 70 ? "text-yellow-500" : "text-destructive")}>
                                {pctUp.toFixed(1)}% atingido
                              </span>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              };

              return (
                <div className="space-y-3">
                  {/* Geral */}
                  <FatBlock
                    label="Geral"
                    month={faturamento.month} prevMonth={faturamento.prevMonth}
                    week={faturamento.week}   prevWeek={faturamento.prevWeek}
                    day={faturamento.day}     prevDay={faturamento.prevDay}
                  />
                  {/* Por quiosque */}
                  {faturamento.byKiosk.map(k => (
                    <FatBlock key={k.kioskId}
                      label={k.name}
                      month={k.month}         prevMonth={k.prevMonth}
                      week={k.week}           prevWeek={k.prevWeek}
                      day={k.day}             prevDay={k.prevDay}
                      targetValue={k.targetValue}
                      upValue={k.upValue}
                    />
                  ))}
                </div>
              );
            })()}
          </section>

          {/* COLABORADORES */}
          <section>
            <div className="flex items-center gap-2 border-b pb-2 mb-4">
              <Users2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Faturamento do mês por colaborador</h3>
            </div>
            {colaboradoresFaturamento.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum dado de colaborador disponível para o período.</p>
            ) : (
              <div className="space-y-6">
                {Object.entries(
                  colaboradoresFaturamento.reduce((acc, c) => {
                    if (!acc[c.kioskId]) acc[c.kioskId] = { kioskName: c.kioskName, collaborators: [] as typeof colaboradoresFaturamento };
                    acc[c.kioskId].collaborators.push(c);
                    return acc;
                  }, {} as Record<string, { kioskName: string; collaborators: typeof colaboradoresFaturamento }>)
                ).map(([kioskId, { kioskName, collaborators }]) => (
                  <div key={kioskId} className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">{kioskName}</p>
                    <div className="overflow-x-auto border rounded-xl">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                          <tr>
                            <th className="px-4 py-2.5">Colaborador</th>
                            <th className="px-4 py-2.5 text-right">Faturamento (mês)</th>
                            <th className="px-4 py-2.5 text-right">Meta alvo</th>
                            <th className="px-4 py-2.5 text-right">% Alvo</th>
                            <th className="px-4 py-2.5 text-right">Meta UP</th>
                            <th className="px-4 py-2.5 text-right">% UP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {collaborators.map((c, i) => {
                            const pctAlvo = c.targetValue > 0 ? (c.monthRevenue / c.targetValue) * 100 : null;
                            const pctUp   = c.upValue    > 0 ? (c.monthRevenue / c.upValue)    * 100 : null;
                            const colorAlvo = pctAlvo === null ? '' : pctAlvo >= 100 ? 'text-green-600' : pctAlvo >= 70 ? 'text-yellow-600' : 'text-destructive';
                            const colorUp   = pctUp   === null ? '' : pctUp   >= 100 ? 'text-green-600' : pctUp   >= 70 ? 'text-yellow-600' : 'text-destructive';
                            return (
                              <tr key={i} className="border-t hover:bg-muted/50 transition-colors">
                                <td className="px-4 py-2.5 font-medium">{c.userName}</td>
                                <td className="px-4 py-2.5 text-right font-bold tabular-nums">R$ {fmt(c.monthRevenue)}</td>
                                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                                  {c.targetValue > 0 ? `R$ ${fmt(c.targetValue)}` : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums">
                                  {pctAlvo !== null
                                    ? <span className={cn('font-bold', colorAlvo)}>{pctAlvo.toFixed(1)}%</span>
                                    : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                                  {c.upValue > 0 ? `R$ ${fmt(c.upValue)}` : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums">
                                  {pctUp !== null
                                    ? <span className={cn('font-bold', colorUp)}>{pctUp.toFixed(1)}%</span>
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* COMPARATIVO DIÁRIO */}
          {dailyBreakdown.length > 1 && (
            <section>
              <div className="flex items-center gap-2 border-b pb-2 mb-4">
                <CalendarRange className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Comparativo Diário</h3>
                <span className="text-xs text-muted-foreground ml-1">· {dailyBreakdown.length} dias · melhor e pior destacados</span>
              </div>
              <Card>
                <CardContent className="pt-4 space-y-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={dailyBreakdown} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ fontSize: 11 }}
                        formatter={(value: any, name: string) => [
                          typeof value === 'number' ? value.toLocaleString('pt-BR') : value,
                          name === 'units' ? 'Unidades' : 'Média',
                        ]}
                      />
                      <Bar dataKey="units" radius={[3, 3, 0, 0]}>
                        {dailyBreakdown.map((d, i) => (
                          <Cell key={i} fill={d.isToday ? '#6366F1' : d.isBest ? '#10B981' : d.isWorst ? '#EF4444' : '#E91E8C'} />
                        ))}
                      </Bar>
                      <Line dataKey="avg" stroke="#6366F1" dot={false} strokeDasharray="5 3" strokeWidth={1.5} />
                    </ComposedChart>
                  </ResponsiveContainer>

                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                        <tr>
                          <th className="px-3 py-2">Data</th>
                          <th className="px-3 py-2 text-right">Unidades</th>
                          <th className="px-3 py-2 text-right">Cupons</th>
                          <th className="px-3 py-2 text-right">Faturamento</th>
                          <th className="px-3 py-2 text-right">Ticket Médio</th>
                          <th className="px-3 py-2 text-right">Variação</th>
                          <th className="px-3 py-2">Top Produto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyBreakdown.map(day => (
                          <tr key={day.date} className={cn('border-t transition-colors', day.isToday ? 'bg-blue-50/40 dark:bg-blue-950/20' : day.isBest ? 'bg-green-50/50 dark:bg-green-950/20' : day.isWorst ? 'bg-red-50/50 dark:bg-red-950/20' : 'hover:bg-muted/50')}>
                            <td className="px-3 py-2 font-medium text-xs whitespace-nowrap">
                              {day.label}
                              {day.isToday && <Badge variant="outline" className="ml-2 text-[9px] bg-blue-100 text-blue-700 border-blue-200 py-0">em andamento</Badge>}
                              {day.isBest && <Badge variant="outline" className="ml-2 text-[9px] bg-green-100 text-green-700 border-green-200 py-0">melhor</Badge>}
                              {day.isWorst && <Badge variant="outline" className="ml-2 text-[9px] bg-red-100 text-red-700 border-red-200 py-0">pior</Badge>}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-xs">{day.units.toLocaleString('pt-BR')}</td>
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground">{day.coupons.toLocaleString('pt-BR')}</td>
                            <td className="px-3 py-2 text-right text-xs">
                              {day.revenue > 0 ? `R$ ${fmt(day.revenue)}` : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold">
                              {day.ticketMedio !== null ? `R$ ${fmt(day.ticketMedio)}` : <span className="text-muted-foreground font-normal">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-xs">
                              {day.delta === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span className={cn('font-semibold', day.delta >= 0 ? 'text-green-600' : 'text-destructive')}>
                                  {day.delta >= 0 ? '▲' : '▼'} {Math.abs(day.delta).toFixed(1)}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[140px]">{day.topProduct || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t bg-muted/30">
                        <tr>
                          <td className="px-3 py-2 text-xs font-bold">Média</td>
                          <td className="px-3 py-2 text-right text-xs font-bold">
                            {Math.round(dailyBreakdown.reduce((s, d) => s + d.units, 0) / dailyBreakdown.length).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {Math.round(dailyBreakdown.reduce((s, d) => s + d.coupons, 0) / dailyBreakdown.length).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            {dailyBreakdown.some(d => d.revenue > 0)
                              ? `R$ ${fmt(dailyBreakdown.reduce((s, d) => s + d.revenue, 0) / dailyBreakdown.length)}`
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-bold">
                            {(() => {
                              const totalRev = dailyBreakdown.reduce((s, d) => s + d.revenue, 0);
                              const totalCoup = dailyBreakdown.reduce((s, d) => s + d.coupons, 0);
                              return totalCoup > 0 && totalRev > 0 ? `R$ ${fmt(totalRev / totalCoup)}` : <span className="text-muted-foreground font-normal">—</span>;
                            })()}
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* PRODUTOS POR QUIOSQUE */}
          <section>
            <div className="flex items-center justify-between border-b pb-2 mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Qtde por Produto por mês - Quiosque</h3>
              </div>
              <div className="flex items-center gap-2">
                {panelProductFilter.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground px-2"
                    onClick={() => setPanelProductFilter([])}>
                    Limpar ({panelProductFilter.length})
                  </Button>
                )}
                <Popover open={panelColabProductOpen} onOpenChange={open => { setPanelColabProductOpen(open); if (!open) setPanelProductSearch(''); }}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                      <Search className="h-3 w-3" />
                      {panelProductFilter.length === 0
                        ? 'Selecionar produtos'
                        : `${panelProductFilter.length} produto${panelProductFilter.length > 1 ? 's' : ''} selecionado${panelProductFilter.length > 1 ? 's' : ''}`}
                      <ChevronsUpDown className="h-3 w-3 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-2" align="end">
                    <Input
                      placeholder="Buscar produto..."
                      value={panelProductSearch}
                      onChange={e => setPanelProductSearch(e.target.value)}
                      className="h-8 text-xs mb-2"
                      autoFocus
                    />
                    {panelProductFilter.length >= 10 && (
                      <p className="text-[10px] text-muted-foreground px-1 mb-1">Limite de 10 produtos atingido</p>
                    )}
                    <div className="max-h-[260px] overflow-y-auto space-y-0.5">
                      {productRanking
                        .filter(p => !panelProductSearch || p.name.toLowerCase().includes(panelProductSearch.toLowerCase()))
                        .map(p => {
                          const selected = panelProductFilter.includes(p.simulationId);
                          const atMax = panelProductFilter.length >= 10 && !selected;
                          return (
                            <button key={p.simulationId} type="button"
                              disabled={atMax}
                              className={cn(
                                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors',
                                selected ? 'bg-primary/10' : 'hover:bg-muted',
                                atMax && 'opacity-40 cursor-not-allowed'
                              )}
                              onClick={() => {
                                setPanelProductFilter(prev =>
                                  selected ? prev.filter(id => id !== p.simulationId) : [...prev, p.simulationId]
                                );
                              }}>
                              <div className={cn(
                                'h-4 w-4 shrink-0 rounded border flex items-center justify-center',
                                selected ? 'bg-primary border-primary' : 'border-input'
                              )}>
                                {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                              </div>
                              <span className="flex-1 truncate">{p.name}</span>
                              <span className="text-[10px] text-muted-foreground tabular-nums">{p.quantity.toLocaleString('pt-BR')}</span>
                            </button>
                          );
                        })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {panelProductFilter.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Selecione até 10 produtos para ver a quantidade vendida por quiosque no período selecionado.</p>
            ) : (
              <div className="space-y-4">
                {Array.from(panelProductQtyByKiosk.entries()).map(([kioskId, { total, byOperator }]) => {
                  const kioskObj = kiosks.find(k => k.id === kioskId);
                  const rows = panelProductFilter.map(simId => ({
                    simId,
                    name: productRanking.find(p => p.simulationId === simId)?.name || simId,
                    qty: total[simId] || 0,
                    operators: Object.entries(byOperator[simId] || {}).sort((a, b) => b[1] - a[1]),
                  }));
                  return (
                    <div key={kioskId} className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                        {kioskObj?.name || kioskId}
                      </p>
                      <div className="border rounded-xl overflow-hidden">
                        <table className="w-full text-sm text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                            <tr>
                              <th className="px-4 py-2.5 w-6" />
                              <th className="px-4 py-2.5">Produto</th>
                              <th className="px-4 py-2.5 text-right">Qtde vendida — período selecionado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(({ simId, name, qty, operators }) => {
                              const rowKey = `${kioskId}|||${simId}`;
                              const isExpanded = expandedProductRows.has(rowKey);
                              const hasOperatorData = operators.length > 0;
                              return (
                                <Fragment key={simId}>
                                  <tr
                                    className={cn('border-t transition-colors', hasOperatorData ? 'cursor-pointer hover:bg-muted/50' : '')}
                                    onClick={() => {
                                      if (!hasOperatorData) return;
                                      setExpandedProductRows(prev => {
                                        const next = new Set(prev);
                                        next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey);
                                        return next;
                                      });
                                    }}>
                                    <td className="px-4 py-2.5 text-muted-foreground">
                                      {hasOperatorData && (
                                        <span className="text-xs">{isExpanded ? '▾' : '▸'}</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5 font-medium">{name}</td>
                                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                                      {qty > 0
                                        ? `${qty.toLocaleString('pt-BR')} un`
                                        : <span className="text-muted-foreground font-normal">—</span>}
                                    </td>
                                  </tr>
                                  {isExpanded && operators.map(([opName, opQty]) => (
                                    <tr key={`${simId}-${opName}`} className="border-t bg-muted/30">
                                      <td className="px-4 py-1.5" />
                                      <td className="px-4 py-1.5 text-xs text-muted-foreground pl-8">↳ {opName}</td>
                                      <td className="px-4 py-1.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                                        {opQty.toLocaleString('pt-BR')} un
                                      </td>
                                    </tr>
                                  ))}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* MIX POR LINHA */}
          <section>
            <div className="flex items-center gap-2 border-b pb-2 mb-4">
              <PieIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Mix por Linha de Produto</h3>
            </div>
            <Card>
              <CardContent className="pt-4 grid md:grid-cols-2 gap-8 items-center">
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={mixByLine} dataKey="quantity" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {mixByLine.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead className="text-right">Qtd</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {mixByLine.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[i % COLORS.length]}} />{line.name}
                        </TableCell>
                        <TableCell className="text-right">{line.quantity.toLocaleString('pt-BR')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* EVOLUÇÃO DE VENDAS */}
          <section>
            <div className="flex items-center gap-2 border-b pb-2 mb-4">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Evolução de vendas — Top 5</h3>
            </div>
            <Card>
              <CardContent className="pt-4">
                {panelEvolution.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nenhum dado para o período selecionado.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={panelEvolution}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="product" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {[...new Set(filteredReports.map(r => r.month))].sort((a, b) => a - b).map((m, i) => (
                        <Bar key={m} dataKey={MONTHS[m - 1]} fill={COLORS[i % COLORS.length]} radius={[4,4,0,0]} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </section>

          {/* FLUXO POR HORÁRIO */}
          <section>
            <div className="flex items-center justify-between border-b pb-2 mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Fluxo por Horário</h3>
              </div>
              <Select value={panelHourlySelectedProduct} onValueChange={v => { setPanelHourlySelectedProduct(v); setPanelSelectedHour(null); }}>
                <SelectTrigger className="h-7 w-[200px] text-xs"><SelectValue placeholder="Todos os produtos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os produtos</SelectItem>
                  {productRanking.map(p => (
                    <SelectItem key={p.simulationId} value={p.simulationId}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-4">
              {panelHourlyByKiosk.map(({ kioskId, kioskName, data }) => {
                const showingCoupons = panelHourlySelectedProduct === 'all';
                const filteredData = data.map(d => ({
                  ...d,
                  displayValue: showingCoupons ? d.coupons : (d.products.find(p => p.simulationId === panelHourlySelectedProduct)?.quantity || 0),
                }));
                const selectedHourData = panelSelectedHour?.kioskId === kioskId
                  ? filteredData.find(d => d.hourStr === panelSelectedHour.hourStr) ?? null
                  : null;
                return (
                  <Card key={kioskId}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">{kioskName}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={filteredData}
                            onClick={d => {
                              if (d?.activePayload?.length) {
                                const hourStr = d.activePayload[0].payload.hourStr as string;
                                setPanelSelectedHour(prev =>
                                  prev?.kioskId === kioskId && prev.hourStr === hourStr ? null : { kioskId, hourStr }
                                );
                              }
                            }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="hour" axisLine={false} tickLine={false} fontSize={11} />
                            <YAxis axisLine={false} tickLine={false} fontSize={11} />
                            <Tooltip cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
                              content={({ active, payload }) => active && payload?.length ? (
                                <div className="bg-popover border p-3 rounded-lg shadow-xl">
                                  <p className="font-bold text-sm mb-1">{payload[0].payload.hour}</p>
                                  <p className="text-pink-600 font-bold">
                                    {payload[0].value} {showingCoupons ? 'cupons' : 'un'}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-1 underline">Clique para detalhar</p>
                                </div>
                              ) : null}
                            />
                            <Bar dataKey="displayValue" fill="hsl(var(--primary))" radius={[4,4,0,0]} className="cursor-pointer" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      {selectedHourData && (
                        <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-4 duration-300 border-t pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-bold text-sm">Produtos — {panelSelectedHour!.hourStr}h</h4>
                              <p className="text-xs text-muted-foreground">
                                {showingCoupons
                                  ? `${selectedHourData.coupons} cupons · ${selectedHourData.total} unidades`
                                  : `${selectedHourData.total} unidades`}
                              </p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setPanelSelectedHour(null)}>Fechar</Button>
                          </div>
                          {selectedHourData.products.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma venda neste horário.</p>
                          ) : (
                            <div className="border rounded-xl overflow-x-auto">
                              <table className="w-full text-sm border-collapse">
                                <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                                  <tr>
                                    <th className="px-4 py-2 text-left">Produto</th>
                                    <th className="px-4 py-2 text-right">Qtd</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedHourData.products.map((p, idx) => (
                                    <tr key={idx} className={cn("border-t hover:bg-muted/50", panelHourlySelectedProduct === p.simulationId ? "bg-primary/10 font-semibold" : "")}>
                                      <td className="px-4 py-2">{p.name}</td>
                                      <td className="px-4 py-2 text-right">{p.quantity} un</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* QTDE VENDIDA POR QUIOSQUE */}
          <section>
            <div className="flex items-center justify-between border-b pb-2 mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Comparativo de quantidade de produtos vendidos</h3>
              </div>
              <div className="flex flex-wrap gap-0.5 bg-muted/30 p-0.5 rounded-lg border">
                {(() => {
                  const now = new Date();
                  const options: Array<{ month: number; year: number; label: string }> = [];
                  for (let i = 11; i >= 0; i--) {
                    const d = subMonths(now, i);
                    options.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: `${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` });
                  }
                  return options.map(opt => {
                    const active = kioskHistoryMonths.some(m => m.month === opt.month && m.year === opt.year);
                    return (
                      <Button key={`${opt.year}-${opt.month}`} size="sm"
                        variant={active ? 'default' : 'ghost'}
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setKioskHistoryMonths(prev =>
                          active
                            ? prev.filter(m => !(m.month === opt.month && m.year === opt.year))
                            : [...prev, { month: opt.month, year: opt.year }]
                        )}>
                        {opt.label}
                      </Button>
                    );
                  });
                })()}
              </div>
            </div>
            {panelKioskHistoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhum quiosque disponível.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {panelKioskHistoryData.map(({ kioskId, kioskName, chartData }) => (
                  <Card key={kioskId}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">{kioskName}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={chartData} barCategoryGap="25%" margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={36} domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.15)]} />
                          <Tooltip
                            cursor={{ fill: 'hsl(var(--muted)/0.4)' }}
                            content={({ active, payload }) => active && payload?.length ? (
                              <div className="bg-popover border p-2 rounded-lg shadow-xl text-xs">
                                <p className="font-semibold mb-0.5">{payload[0].payload.label}</p>
                                <p style={{ color: payload[0].payload.isLastYear ? '#6366F1' : '#E91E8C' }} className="font-bold">
                                  {(payload[0].value as number).toLocaleString('pt-BR')} unidades
                                </p>
                              </div>
                            ) : null}
                          />
                          <Bar dataKey="qty" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.isLastYear ? '#6366F1' : '#E91E8C'} />
                            ))}
                            <LabelList dataKey="qty" position="top" style={{ fontSize: 10, fontWeight: 600, fill: 'hsl(var(--foreground))' }}
                              formatter={(v: number) => v > 0 ? v.toLocaleString('pt-BR') : ''} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-3 mt-2 justify-end">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#E91E8C' }} />
                          3 meses anteriores
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#6366F1' }} />
                          Mesmo mês ano passado
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

        </TabsContent>
      </Tabs>
    </div>
  );
}
