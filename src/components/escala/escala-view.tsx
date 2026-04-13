"use client";

import React, { useState, useMemo } from 'react';
import { addMonths, subMonths, format, getDaysInMonth, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Download, Plus,
  AlertTriangle, Users, DollarSign, TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Turno, DiaEscala, ColunaEscala } from '@/types/escala';

// ─── Design Tokens ────────────────────────────────────────────────────────────
// Primary
const CLR_GREEN       = '#1a6b45';
const CLR_GREEN_LIGHT = '#e8f4ee';
// Badges
const BADGE = {
  OP:  { bg: '#e8f4ee', text: '#1a6b45' },
  ADM: { bg: '#e6f1fb', text: '#185fa5' },
  CXA: { bg: '#faeeda', text: '#854f0b' },
} as const;
// Days
const CLR_SAT_NUM = '#b45309';
const CLR_SUN_NUM = '#c2410c';
const CLR_SUN_BG  = '#fff7ed';
// Alerts
const CLR_ALERT_BORDER = '#f97316';
const CLR_ALERT_BG     = '#fff7ed';
const CLR_ALERT_TEXT   = '#c2410c';
// Holidays
const CLR_HOLIDAY_BG     = '#ede9fe'; // violet-100
const CLR_HOLIDAY_BORDER = '#c4b5fd'; // violet-300
const CLR_HOLIDAY_TEXT   = '#6d28d9'; // violet-700

// ─── Constants ────────────────────────────────────────────────────────────────

const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const COLUNAS: ColunaEscala[] = [
  { id: 'adm',     nome: 'Adm / CTA',          iniciais: 'AD', tipo: 'ADM', cor: 'blue'  },
  { id: 'jp',      nome: 'Quisque João Paulo',  iniciais: 'JP', tipo: 'OP',  cor: 'green' },
  { id: 'tirimai', nome: 'Quisque Tirimai',     iniciais: 'TM', tipo: 'OP',  cor: 'green' },
];

// Employee color palette — TODO: load from user profile (cadastro) in Firestore
const EMP = {
  heu: { nome: 'Heucilene Oliveira',  iniciais: 'HO', cor: '#7c3aed' },
  mjo: { nome: 'Maria Joana Barbosa', iniciais: 'MJ', cor: '#0891b2' },
  jos: { nome: 'Josiane da Silva',    iniciais: 'JS', cor: '#059669' },
  med: { nome: 'Maria Edna Gois',     iniciais: 'ME', cor: '#d97706' },
  car: { nome: 'Carliane Sousa',      iniciais: 'CS', cor: '#dc2626' },
} as const;

type EmpId = keyof typeof EMP;

// ─── Mock Data ────────────────────────────────────────────────────────────────

function mkTurno(
  id: string,
  empId: EmpId | 'ausente',
  horario: string,
  tipo: Turno['tipo'],
  alerta?: boolean,
  alertaMsg?: string,
): Turno {
  if (empId === 'ausente') {
    return { id, funcionarioId: 'ausente', nome: '—', iniciais: '!', horario, tipo, alerta: true, alertaMsg: alertaMsg ?? 'Sem cobertura' };
  }
  const { nome, iniciais, cor } = EMP[empId];
  return { id, funcionarioId: empId, nome, iniciais, cor, horario, tipo, alerta, alertaMsg };
}

// ─── Holidays ─────────────────────────────────────────────────────────────────
// TODO: Replace with useDPHolidays(calendarId) — Firestore: dp_calendars/{id}/holidays
const MOCK_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-03-04', name: 'Quarta-feira de Cinzas' },
  { date: '2026-03-08', name: 'Dia Internacional da Mulher' },
  { date: '2026-03-19', name: 'São José (municipal)' },
];

function buildHolidayMap(holidays: { date: string; name: string }[]): Map<string, string> {
  return new Map(holidays.map(h => [h.date, h.name]));
}

// TODO: Replace with Firestore query to collection 'escalas' in project 'coalafinan'
function gerarMockDias(year: number, month: number): DiaEscala[] {
  const count = getDaysInMonth(new Date(year, month - 1));
  const dias: DiaEscala[] = [];

  for (let d = 1; d <= count; d++) {
    const data = new Date(year, month - 1, d);
    const dow = data.getDay();
    const isSun = dow === 0;
    const isSat = dow === 6;
    const isAlertDay = year === 2026 && month === 3 && d === 6;

    if (isSun) { dias.push({ data, turnos: {} }); continue; }

    const turnos: Record<string, Turno[]> = {};

    if (!isSat) turnos['adm'] = [mkTurno(`adm-${d}`, 'car', '08:00–17:00', 'ADM')];

    turnos['jp'] = [
      mkTurno(`jp-am-${d}`, 'heu', '08:00–14:15', 'OP'),
      mkTurno(`jp-pm-${d}`, 'mjo', '14:00–22:00', 'OP'),
    ];

    turnos['tirimai'] = isAlertDay
      ? [
          mkTurno(`tir-am-${d}`, 'ausente', '08:00–14:15', 'OP', true, 'Josiane ausente – turno manhã descoberto'),
          mkTurno(`tir-pm-${d}`, 'med', '14:00–22:00', 'OP'),
        ]
      : [
          mkTurno(`tir-am-${d}`, 'jos', '08:00–14:15', 'OP'),
          mkTurno(`tir-pm-${d}`, 'med', '14:00–22:00', 'OP'),
        ];

    dias.push({ data, turnos });
  }

  return dias;
}

// ─── TipoBadge ────────────────────────────────────────────────────────────────

function TipoBadge({ tipo }: { tipo: Turno['tipo'] }) {
  const { bg, text } = BADGE[tipo];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] font-medium leading-none shrink-0"
      style={{ backgroundColor: bg, color: text }}
    >
      {tipo}
    </span>
  );
}

// ─── ShiftCard ────────────────────────────────────────────────────────────────

function ShiftCard({ turno }: { turno: Turno }) {
  const accentColor = turno.cor ?? '#64748b';
  return (
    <div
      className="flex items-center gap-1.5 rounded-[6px] bg-muted/50 px-2 py-1 border border-transparent border-l-[3px] select-none"
      style={{ borderLeftColor: accentColor }}
    >
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0"
        style={{ backgroundColor: accentColor }}
      >
        {turno.iniciais}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium truncate leading-tight text-foreground">
          {turno.nome.split(' ')[0]}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight">{turno.horario}</p>
      </div>
      <TipoBadge tipo={turno.tipo} />
    </div>
  );
}

// ─── AlertCard ────────────────────────────────────────────────────────────────

function AlertCard({ turno }: { turno: Turno }) {
  return (
    <div
      className="flex items-start gap-1.5 rounded-[6px] border-l-2 px-2 py-1 text-xs"
      style={{ borderLeftColor: CLR_ALERT_BORDER, backgroundColor: CLR_ALERT_BG }}
    >
      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" style={{ color: CLR_ALERT_BORDER }} />
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-tight" style={{ color: CLR_ALERT_TEXT }}>
          {turno.alertaMsg}
        </p>
        <p className="text-[10px] leading-tight" style={{ color: `${CLR_ALERT_TEXT}99` }}>
          {turno.horario}
        </p>
      </div>
    </div>
  );
}

// ─── DayLabel ─────────────────────────────────────────────────────────────────

function DayLabel({ data, isHoliday, holidayName }: { data: Date; isHoliday?: boolean; holidayName?: string }) {
  const dow = data.getDay();
  const isSun = dow === 0;
  const isSat = dow === 6;
  const isNow = isToday(data);

  const dowColor = isHoliday
    ? CLR_HOLIDAY_TEXT
    : isSun ? CLR_SUN_NUM : isSat ? CLR_SAT_NUM : 'var(--muted-foreground)';
  const numColor = isHoliday
    ? CLR_HOLIDAY_TEXT
    : isSun ? CLR_SUN_NUM : isSat ? CLR_SAT_NUM : undefined;

  const containerStyle: React.CSSProperties = isHoliday
    ? { backgroundColor: CLR_HOLIDAY_BG }
    : isSun
    ? { backgroundColor: CLR_SUN_BG }
    : {};

  return (
    <div
      className={cn(
        'sticky left-0 z-20 flex flex-col items-center justify-center gap-0.5 py-3 rounded-md',
        !isHoliday && isSat ? 'bg-muted/40' : '',
      )}
      style={containerStyle}
      title={isHoliday ? holidayName : undefined}
    >
      {/* Day of week */}
      <span
        className="text-[10px] uppercase tracking-wide font-medium"
        style={{ color: dowColor }}
      >
        {DOW_SHORT[dow]}
      </span>

      {/* Day number */}
      {isNow ? (
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium text-white"
          style={{ backgroundColor: CLR_GREEN }}
        >
          {data.getDate()}
        </span>
      ) : (
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-base font-medium"
          style={{ color: numColor ?? 'inherit' }}
        >
          {data.getDate()}
        </span>
      )}

      {/* Holiday indicator */}
      {isHoliday && (
        <span
          className="text-[8px] font-semibold uppercase tracking-wide leading-none"
          style={{ color: CLR_HOLIDAY_TEXT }}
        >
          Fer.
        </span>
      )}
    </div>
  );
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

interface DayCellProps {
  turnos: Turno[];
  isSunday: boolean;
  isSaturday: boolean;
  isCurrentDay: boolean;
  isHoliday?: boolean;
}

function DayCell({ turnos, isSunday, isSaturday, isCurrentDay, isHoliday }: DayCellProps) {
  if (isSunday) {
    return (
      <div
        className="rounded-md border min-h-[60px]"
        style={{
          backgroundColor: isHoliday ? CLR_HOLIDAY_BG : CLR_SUN_BG,
          borderColor: isHoliday ? CLR_HOLIDAY_BORDER : '#fed7aa', // orange-200
        }}
      />
    );
  }

  const isEmpty = turnos.length === 0;

  const cellStyle: React.CSSProperties = isHoliday
    ? { backgroundColor: CLR_HOLIDAY_BG, borderColor: CLR_HOLIDAY_BORDER }
    : isCurrentDay
    ? { borderColor: `${CLR_GREEN}80` }
    : {};

  return (
    <div
      className={cn(
        'rounded-md border p-2 min-h-[60px] flex flex-col gap-1',
        isEmpty && !isHoliday ? 'border-dashed' : 'border-solid',
        !isHoliday && isSaturday ? 'bg-muted/40' : '',
      )}
      style={cellStyle}
    >
      {turnos.map(t =>
        t.alerta
          ? <AlertCard key={t.id} turno={t} />
          : <ShiftCard key={t.id} turno={t} />
      )}
      {/* Add button */}
      <button className="mt-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted rounded px-1 py-0.5 cursor-pointer transition-colors">
        <Plus className="h-3 w-3 shrink-0" />
        {isEmpty && <span>Adicionar</span>}
      </button>
    </div>
  );
}

// ─── EscalaGrid ───────────────────────────────────────────────────────────────

interface EscalaGridProps {
  dias: DiaEscala[];
  visibleCols: ColunaEscala[];
  holidayMap: Map<string, string>;
}

function EscalaGrid({ dias, visibleCols, holidayMap }: EscalaGridProps) {
  const gridTemplate = `64px repeat(${visibleCols.length}, 224px)`;

  return (
    <div
      className="grid gap-2 p-3"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {/* ── Header row ── */}

      {/* Corner */}
      <div className="sticky top-0 left-0 z-40 h-12 flex items-center justify-center rounded-md border bg-muted/60">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Dia
        </span>
      </div>

      {/* Column headers */}
      {visibleCols.map(col => {
        const avatar = col.tipo === 'OP'
          ? { bg: BADGE.OP.bg, text: BADGE.OP.text }
          : { bg: BADGE.ADM.bg, text: BADGE.ADM.text };
        return (
          <div
            key={col.id}
            className="sticky top-0 z-30 h-12 flex items-center gap-2 px-3 rounded-md border bg-muted/50"
          >
            <div
              className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
              style={{ backgroundColor: avatar.bg, color: avatar.text }}
            >
              {col.iniciais}
            </div>
            <span className="font-semibold text-sm text-foreground truncate">{col.nome}</span>
          </div>
        );
      })}

      {/* ── Day rows ── */}
      {dias.map(dia => {
        const dow = dia.data.getDay();
        const isSun = dow === 0;
        const isSat = dow === 6;
        const isNow = isToday(dia.data);
        const dateKey = format(dia.data, 'yyyy-MM-dd');
        const holidayName = holidayMap.get(dateKey);
        const isHoliday = holidayName !== undefined;

        return (
          <React.Fragment key={dia.data.toISOString()}>
            <DayLabel data={dia.data} isHoliday={isHoliday} holidayName={holidayName} />
            {visibleCols.map(col => (
              <DayCell
                key={col.id}
                turnos={dia.turnos[col.id] ?? []}
                isSunday={isSun}
                isSaturday={isSat}
                isCurrentDay={isNow}
                isHoliday={isHoliday}
              />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── EscalaTopbar ─────────────────────────────────────────────────────────────

function EscalaTopbar({ onExport }: { onExport: () => void }) {
  return (
    <header className="sticky top-0 z-50 h-14 flex items-center gap-3 border-b bg-background/95 backdrop-blur-sm px-6 shrink-0">
      <span
        className="rounded-full px-3 py-1 text-[13px] font-semibold text-white tracking-tight select-none"
        style={{ backgroundColor: CLR_GREEN }}
      >
        Coala
      </span>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">RH</span>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold text-foreground">Escala</span>
      </div>
      <div className="flex-1" />
      <Button size="sm" variant="outline" onClick={onExport}>
        <Download className="mr-2 h-4 w-4" />
        Exportar
      </Button>
    </header>
  );
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'default' | 'destructive';
}

function SummaryCard({ icon, label, value, sub, accent = 'default' }: SummaryCardProps) {
  return (
    <div className={cn(
      'rounded-xl border px-4 py-3 flex items-center gap-3 min-w-[148px] shrink-0',
      accent === 'destructive' ? 'bg-destructive/5 border-destructive/20' : 'bg-card',
    )}>
      <div className={cn(
        'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
        accent === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
      )}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground leading-none mb-1">{label}</p>
        <p className={cn('text-lg font-bold leading-tight', accent === 'destructive' ? 'text-destructive' : '')}>
          {value}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── EscalaFilterBar ─────────────────────────────────────────────────────────

interface FilterBarProps {
  colunas: ColunaEscala[];
  unitFilter: string;
  onUnitFilter: (id: string) => void;
  showAlerts: boolean;
  onToggleAlerts: () => void;
}

function EscalaFilterBar({ colunas, unitFilter, onUnitFilter, showAlerts, onToggleAlerts }: FilterBarProps) {
  const chipBase = 'shrink-0 rounded-full px-3 py-1 text-xs transition-colors';
  const chipInactive = 'border border-border text-muted-foreground bg-background hover:bg-muted';
  const chipActive = 'border font-medium';

  return (
    <div className="flex items-center gap-2 px-6 py-2.5 border-b shrink-0 overflow-x-auto">
      {/* "All units" chip */}
      <button
        onClick={() => onUnitFilter('all')}
        className={cn(chipBase, unitFilter === 'all' ? chipActive : chipInactive)}
        style={unitFilter === 'all'
          ? { borderColor: CLR_GREEN, backgroundColor: CLR_GREEN_LIGHT, color: CLR_GREEN }
          : undefined}
      >
        Todas as unidades
      </button>

      {/* Per-unit chips */}
      {colunas.map(col => {
        const isActive = unitFilter === col.id;
        return (
          <button
            key={col.id}
            onClick={() => onUnitFilter(col.id)}
            className={cn(chipBase, isActive ? chipActive : chipInactive)}
            style={isActive
              ? { borderColor: CLR_GREEN, backgroundColor: CLR_GREEN_LIGHT, color: CLR_GREEN }
              : undefined}
          >
            {col.nome}
          </button>
        );
      })}

      {/* Separator */}
      <div className="h-5 w-px bg-border mx-1 shrink-0" />

      {/* Alert chip */}
      <button
        onClick={onToggleAlerts}
        className={cn(
          chipBase,
          'flex items-center gap-1.5',
          showAlerts
            ? 'border border-orange-400 bg-orange-50 text-orange-700 font-medium'
            : chipInactive,
        )}
      >
        <AlertTriangle className="h-3 w-3" />
        Ver alertas
      </button>
    </div>
  );
}

// ─── EscalaView (main export) ─────────────────────────────────────────────────

export function EscalaView() {
  const [currentDate, setCurrentDate] = useState(() => new Date(2026, 2, 1));
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [showAlerts, setShowAlerts] = useState(false);

  // TODO: Replace with Firestore query to 'escalas' collection in 'coalafinan'
  const dias = useMemo(
    () => gerarMockDias(currentDate.getFullYear(), currentDate.getMonth() + 1),
    [currentDate],
  );

  // TODO: Replace MOCK_HOLIDAYS with useDPHolidays(calendarId) once calendar is wired up
  const holidayMap = useMemo(() => buildHolidayMap(MOCK_HOLIDAYS), []);

  const visibleCols = useMemo(
    () => unitFilter === 'all' ? COLUNAS : COLUNAS.filter(c => c.id === unitFilter),
    [unitFilter],
  );

  const diasFiltrados = useMemo(() => {
    if (!showAlerts) return dias;
    return dias.filter(dia =>
      visibleCols.some(col => (dia.turnos[col.id] ?? []).some(t => t.alerta))
    );
  }, [dias, showAlerts, visibleCols]);

  const stats = useMemo(() => {
    const allTurnos = diasFiltrados.flatMap(d => visibleCols.flatMap(c => d.turnos[c.id] ?? []));
    const uniquePeople = new Set(
      allTurnos.filter(t => t.funcionarioId !== 'ausente').map(t => t.funcionarioId)
    ).size;
    const conflicts = allTurnos.filter(t => t.alerta).length;

    // TODO: Compute from actual VT values on user profiles (Firestore)
    const VT_PER_DAY = 15;
    const workedKeys = new Set<string>();
    let custoMes = 0;
    diasFiltrados.forEach(dia => {
      const dateKey = `${dia.data.getFullYear()}-${dia.data.getMonth()}-${dia.data.getDate()}`;
      visibleCols.forEach(col => {
        (dia.turnos[col.id] ?? []).forEach(t => {
          if (t.funcionarioId === 'ausente') return;
          const k = `${t.funcionarioId}_${dateKey}`;
          if (!workedKeys.has(k)) { workedKeys.add(k); custoMes += VT_PER_DAY; }
        });
      });
    });

    return { uniquePeople, conflicts, custoMes };
  }, [diasFiltrados, visibleCols]);

  const monthLabel = (() => {
    const raw = format(currentDate, "MMMM 'de' yyyy", { locale: ptBR });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();

  async function handleExport() {
    // TODO: Export real Firestore data once integrated
    const XLSX = await import('xlsx');
    const rows = diasFiltrados.flatMap(dia => {
      const dateStr = format(dia.data, 'yyyy-MM-dd');
      return visibleCols.flatMap(col =>
        (dia.turnos[col.id] ?? []).map(t => ({
          data: dateStr, unidade: col.nome, funcionario: t.nome,
          horario: t.horario, tipo: t.tipo,
          alerta: t.alerta ? 'Sim' : 'Não', mensagem_alerta: t.alertaMsg ?? '',
        }))
      );
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Escala');
    XLSX.writeFile(wb, `escala_${format(currentDate, 'yyyy-MM')}.xlsx`);
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <EscalaTopbar onExport={handleExport} />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Month nav + summary cards */}
        <div className="shrink-0 px-6 py-4 border-b space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentDate(d => subMonths(d, 1))}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted/50 transition-colors"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-base font-semibold min-w-[180px] text-center select-none">
              {monthLabel}
            </span>
            <button
              onClick={() => setCurrentDate(d => addMonths(d, 1))}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted/50 transition-colors"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SummaryCard icon={<Users className="h-4 w-4" />} label="Pessoas" value={stats.uniquePeople} />
            <SummaryCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Conflitos"
              value={stats.conflicts}
              accent={stats.conflicts > 0 ? 'destructive' : 'default'}
            />
            <SummaryCard
              icon={<DollarSign className="h-4 w-4" />}
              label="Custo / mês"
              value={stats.custoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              sub="Vale transporte"
            />
            {/* TODO: Pull last month's cost from Firestore for comparison */}
            <SummaryCard icon={<TrendingUp className="h-4 w-4" />} label="Último mês" value="R$ 1.380" sub="Fevereiro / 2026" />
          </div>
        </div>

        {/* Filter chips */}
        <EscalaFilterBar
          colunas={COLUNAS}
          unitFilter={unitFilter}
          onUnitFilter={setUnitFilter}
          showAlerts={showAlerts}
          onToggleAlerts={() => setShowAlerts(v => !v)}
        />

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          {diasFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <AlertTriangle className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum dia com alerta neste mês.</p>
            </div>
          ) : (
            <EscalaGrid dias={diasFiltrados} visibleCols={visibleCols} holidayMap={holidayMap} />
          )}
        </div>
      </div>
    </div>
  );
}
