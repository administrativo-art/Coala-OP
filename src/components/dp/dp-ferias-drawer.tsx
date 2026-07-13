"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  format, parseISO, differenceInCalendarDays, isAfter, startOfDay,
} from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/components/dp-context';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { useToast } from '@/hooks/use-toast';
import type { DPVacationRecord, DPVacationStatus } from '@/types';
import {
  Sheet, SheetContent,
} from '@/components/ui/sheet';
import { ExternalLink } from 'lucide-react';
import {
  getVacationCycleHistory,
  getCycleRisk,
  getCycleProgress,
  RISK_HEX,
  VACATION_STATUS_HEX,
  type VacationCycle,
} from '@/lib/utils/vacation-logic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function toDate(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof ts === 'string') return new Date(ts);
  return undefined;
}

function fmt(d?: string | Date) {
  if (!d) return '—';
  try {
    const dt = typeof d === 'string' ? parseISO(d) : d;
    return format(dt, 'dd/MM/yyyy');
  } catch { return String(d); }
}

const DONE = { fg: '#15803D', bg: 'rgba(34,197,94,0.14)', label: 'Concluído' };

interface Props {
  userId: string | null;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DPFeriasDrawer({ userId, canEdit, onOpenChange }: Props) {
  const { users } = useAuth();
  const { vacations, units } = useDPBootstrap();

  const user = userId ? users.find(u => u.id === userId) : undefined;
  const unitName = user?.unitIds?.[0]
    ? units.find(u => u.id === user.unitIds![0])?.name ?? ''
    : '';

  return (
    <Sheet open={!!userId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[560px] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-[560px]"
      >
        {user && (
          <DrawerBody
            key={user.id}
            user={user}
            unitName={unitName}
            vacations={vacations.filter(v => v.userId === user.id)}
            canEdit={canEdit}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Drawer body ──────────────────────────────────────────────────────────────

interface DrawerBodyProps {
  user: ReturnType<typeof useAuth>['users'][number];
  unitName: string;
  vacations: DPVacationRecord[];
  canEdit: boolean;
}

function DrawerBody({ user, unitName, vacations, canEdit }: DrawerBodyProps) {
  const router = useRouter();
  const today = startOfDay(new Date());
  const admDate = toDate(user.admissionDate);

  const cycles = useMemo(
    () => (admDate ? getVacationCycleHistory(admDate, vacations) : []),
    [admDate, vacations],
  );

  // Concessive cycles only (exclude the still-accumulating aquisitivo one).
  const concessive = useMemo(
    () => cycles.filter(c => c.status !== 'AQUISITIVO'),
    [cycles],
  );
  const openCycles = useMemo(
    () => concessive
      .filter(c => c.status !== 'GOZADO')
      .sort((a, b) => a.concessivePeriod.end.getTime() - b.concessivePeriod.end.getTime()),
    [concessive],
  );

  const multiOpen = openCycles.length > 1;
  const noCycles = concessive.length === 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-[22px] py-5">
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
          style={{ background: user.color || '#8B5CF6' }}
        >
          {initials(user.username)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold">{user.username}</h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[user.jobRoleName, unitName].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-[22px] py-[18px]">
        {multiOpen && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-3">
            <span className="flex-shrink-0 text-sm text-amber-600 dark:text-amber-400">⚠</span>
            <p className="text-xs leading-relaxed">
              {openCycles.length} ciclos concessivos em aberto ao mesmo tempo. O mais urgente é o{' '}
              <b>Ciclo {openCycles[0].id}</b>, vencido/vencendo em {fmt(openCycles[0].concessivePeriod.end)}.
            </p>
          </div>
        )}

        {noCycles && (
          <p className="text-xs text-muted-foreground">
            Ainda em período aquisitivo — nenhum ciclo concessivo aberto.
          </p>
        )}

        {concessive.map(cycle => (
          <CycleBlock
            key={cycle.id}
            cycle={cycle}
            userId={user.id}
            canEdit={canEdit}
            today={today}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t px-[22px] py-3">
        <button
          onClick={() => router.push(`/dashboard/dp/ferias/${user.id}`)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          Ver perfil completo <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
}

// ─── One cycle ────────────────────────────────────────────────────────────────

function CycleBlock({
  cycle, userId, canEdit, today,
}: {
  cycle: VacationCycle;
  userId: string;
  canEdit: boolean;
  today: Date;
}) {
  const open = cycle.status !== 'GOZADO';
  const done = cycle.status === 'GOZADO';
  const risk = getCycleRisk(cycle, today);
  const progress = Math.round(getCycleProgress(cycle, today));
  const rc = open ? RISK_HEX[risk] : DONE;

  const active = cycle.records.filter(r => r.status !== 'REJECTED');
  const gozoDays = active.filter(r => r.recordType === 'gozo').reduce((t, r) => t + r.days, 0);
  const sold = active.filter(r => r.recordType === 'venda').reduce((t, r) => t + r.days, 0);
  const taken = active.reduce((t, r) => t + r.days, 0);
  const balance = Math.max(0, 30 - taken);

  const summaryLine = `${gozoDays}d gozados`
    + (sold ? ` · ${sold}d vendidos` : '')
    + (balance ? ` · ${balance}d em aberto` : ' · completo');

  return (
    <div
      className="rounded-xl border border-l-[3px] p-4"
      style={{ borderLeftColor: rc.fg }}
    >
      <div className="flex items-start gap-3">
        {open ? (
          <div
            className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(from -90deg, ${rc.fg} ${progress * 3.6}deg, hsl(var(--secondary)) 0deg)` }}
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-card">
              <span className="text-[11px] font-extrabold">{progress}%</span>
            </div>
          </div>
        ) : (
          <div className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full bg-green-500/15 text-[22px] text-green-700 dark:text-green-400">
            ✓
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[15px] font-bold">Ciclo {cycle.id}</h4>
            <span
              className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
              style={{ background: rc.bg, color: rc.fg }}
            >
              {rc.label}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">
            Concessivo {fmt(cycle.concessivePeriod.start)} → {fmt(cycle.concessivePeriod.end)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">{summaryLine}</div>
        </div>
      </div>

      {active.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {active.map(r => (
            <RecordRow key={r.id} record={r} concessiveEnd={cycle.concessivePeriod.end} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11.5px] text-muted-foreground">Nenhum período lançado neste ciclo ainda.</p>
      )}

      {open && canEdit && (
        <RegisterForms cycleId={cycle.id} userId={userId} />
      )}
    </div>
  );
}

// ─── One record row ───────────────────────────────────────────────────────────

function RecordRow({ record, concessiveEnd }: { record: DPVacationRecord; concessiveEnd: Date }) {
  const isVenda = record.recordType === 'venda';
  const s = VACATION_STATUS_HEX[record.status] ?? VACATION_STATUS_HEX.PENDING;
  const onTime = isVenda || !record.endDate ? true : !isAfter(parseISO(record.endDate), concessiveEnd);
  const prazo = onTime
    ? { fg: '#15803D', bg: 'rgba(34,197,94,0.14)', label: 'No prazo' }
    : { fg: '#DC2626', bg: 'rgba(239,68,68,0.13)', label: 'Fora do prazo' };

  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-muted px-3 py-2.5">
      <div
        className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg text-xs font-extrabold"
        style={
          isVenda
            ? { background: 'rgba(59,130,246,0.14)', color: '#1D4ED8' }
            : { background: 'rgba(139,92,246,0.14)', color: '#7C3AED' }
        }
      >
        {isVenda ? '$' : 'G'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-semibold">{isVenda ? 'Venda (abono)' : 'Gozo'}</span>
          <span className="text-[11.5px] font-bold">{record.days}d</span>
          <span
            className="rounded-full px-2 py-px text-[10.5px] font-semibold"
            style={{ background: s.bg, color: s.fg }}
          >
            {s.label}
          </span>
          {!isVenda && (
            <span
              className="rounded-full px-2 py-px text-[10.5px] font-semibold"
              style={{ background: prazo.bg, color: prazo.fg }}
            >
              {prazo.label}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {isVenda
            ? `Abono pecuniário · pagamento em ${fmt(record.paymentDate)}`
            : `${fmt(record.startDate)} → ${fmt(record.endDate)} · pagamento em ${fmt(record.paymentDate)}`}
        </div>
      </div>
    </div>
  );
}

// ─── Inline register forms ────────────────────────────────────────────────────

function RegisterForms({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { addVacation } = useDP();
  const { toast } = useToast();
  const [mode, setMode] = useState<'none' | 'gozo' | 'venda'>('none');
  const [saving, setSaving] = useState(false);

  // gozo fields
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [payment, setPayment] = useState('');
  // venda fields
  const [vendaDays, setVendaDays] = useState('10');

  function reset() {
    setMode('none'); setStart(''); setEnd(''); setPayment(''); setVendaDays('10');
  }

  async function save(recordType: 'gozo' | 'venda') {
    let days: number;
    if (recordType === 'gozo') {
      if (!start || !end || end < start) {
        toast({ title: 'Informe início e fim válidos.', variant: 'destructive' });
        return;
      }
      days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
    } else {
      days = Math.min(10, Math.max(1, Number(vendaDays) || 0));
      if (!days) { toast({ title: 'Informe os dias.', variant: 'destructive' }); return; }
    }
    setSaving(true);
    try {
      const status: DPVacationStatus = recordType === 'gozo' ? 'PLANNED' : 'APPROVED';
      await addVacation({
        userId,
        cycleId,
        recordType,
        days,
        status,
        startDate: recordType === 'gozo' ? start : undefined,
        endDate: recordType === 'gozo' ? end : undefined,
        paymentDate: payment || undefined,
        warnings: [],
      });
      toast({ title: recordType === 'gozo' ? 'Gozo registrado.' : 'Venda registrada.' });
      reset();
    } catch {
      toast({ title: 'Erro ao salvar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'mt-1 w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs';
  const labelCls = 'text-[10.5px] font-semibold';

  return (
    <div className="mt-3 border-t pt-3">
      {mode === 'none' && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('gozo')}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Registrar gozo
          </button>
          <button
            onClick={() => setMode('venda')}
            className="flex-1 rounded-lg border bg-card px-3 py-2 text-[12.5px] font-semibold hover:bg-muted"
          >
            Comprar (venda)
          </button>
        </div>
      )}

      {mode === 'gozo' && (
        <div>
          <div className="mb-2 text-[11.5px] font-bold">Registrar gozo</div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelCls}>Início</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Fim</span>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="mb-2.5 block">
            <span className={labelCls}>Pagamento</span>
            <input type="date" value={payment} onChange={e => setPayment(e.target.value)} className={inputCls} />
          </label>
          <FormActions onCancel={reset} onSave={() => save('gozo')} saving={saving} />
        </div>
      )}

      {mode === 'venda' && (
        <div>
          <div className="mb-2 text-[11.5px] font-bold">Comprar férias (abono)</div>
          <div className="mb-2.5 grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelCls}>Dias (máx. 10)</span>
              <input
                type="number" min={1} max={10} value={vendaDays}
                onChange={e => setVendaDays(e.target.value)} className={inputCls}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Pagamento</span>
              <input type="date" value={payment} onChange={e => setPayment(e.target.value)} className={inputCls} />
            </label>
          </div>
          <FormActions onCancel={reset} onSave={() => save('venda')} saving={saving} />
        </div>
      )}
    </div>
  );
}

function FormActions({ onCancel, onSave, saving }: { onCancel: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <button
        onClick={onCancel}
        disabled={saving}
        className="rounded-lg bg-muted px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  );
}
