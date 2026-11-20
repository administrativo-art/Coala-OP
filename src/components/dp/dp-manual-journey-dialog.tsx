'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchDraftScheduleShifts, saveManualJourneyDraft } from '@/features/dp/schedules/client';
import { reviewSplitJourney } from '@/features/dp/schedules/split-journey';
import { manualJourneyDraftSchema } from '@/features/dp/shifts/schemas';
import type { DPShift } from '@/types';

type ScheduleOption = { id: string; unitId: string; name: string };
type Segment = {
  id: string;
  scheduleId: string;
  existing: boolean;
  mode: 'fixed' | 'flexible';
  workMinutes: string;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
};

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

function fromShift(shift: DPShift, preserveLegacyLoad = false): Segment {
  return { id: shift.id, scheduleId: shift.scheduleId, existing: true,
    mode: shift.manualDay?.mode ?? 'fixed',
    workMinutes: shift.manualDay?.mode === 'flexible' && (shift.manualOrder != null || preserveLegacyLoad)
      ? String(shift.manualDay.expectedWorkMinutes) : '',
    startTime: shift.startTime, endTime: shift.endTime,
    breakStart: shift.manualBreak?.start ?? '', breakEnd: shift.manualBreak?.end ?? '' };
}

function blankSegment(scheduleId: string): Segment {
  return { id: crypto.randomUUID(), scheduleId, existing: false, mode: 'fixed', workMinutes: '', startTime: '', endTime: '', breakStart: '', breakEnd: '' };
}

type Draft = Awaited<ReturnType<typeof fetchDraftScheduleShifts>>;

function shiftsOfDay(drafts: Draft[], userId: string, date: string) {
  return drafts.flatMap(({ shifts }) => shifts).filter((shift) =>
    shift.userId === userId && shift.date === date && shift.type !== 'day_off');
}

function initialForm(drafts: Draft[], userId: string, date: string, originScheduleId: string, seed?: DPShift) {
  const day = shiftsOfDay(drafts, userId, date);
  const selected = day.filter((shift) => shift.manualDay || (shift.id === seed?.id && shift.scheduleId === seed?.scheduleId));
  return selected.length
    ? selected.sort((left, right) => left.manualOrder != null && right.manualOrder != null
      ? left.manualOrder - right.manualOrder : left.startTime.localeCompare(right.startTime))
      .map((shift) => fromShift(shift, selected.length === 1))
    : day.length || !userId ? [] : [blankSegment(originScheduleId)];
}

export function DPManualJourneyDialog({ date, originScheduleId, schedules, people, seed, onClose }: {
  date: string;
  originScheduleId: string;
  schedules: ScheduleOption[];
  people: { id: string; username?: string | null }[];
  seed?: DPShift;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState(seed?.userId ?? '');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(schedules.map(({ id }) => fetchDraftScheduleShifts(id))).then((result) => {
      if (cancelled) return;
      const form = initialForm(result, seed?.userId ?? '', date, originScheduleId, seed);
      setDrafts(result);
      setSegments(form);
    }).catch(() => {
      if (!cancelled) setError('Não foi possível carregar os rascunhos. Feche e abra a jornada novamente.');
    });
    return () => { cancelled = true; };
  }, [date, originScheduleId, schedules, seed]);

  const existing = drafts ? shiftsOfDay(drafts, userId, date) : [];

  function selectPerson(id: string) {
    const form = initialForm(drafts ?? [], id, date, originScheduleId);
    setUserId(id);
    setSegments(form);
    setError('');
  }

  const rows = segments.map((segment, manualOrder) => ({
    manualOrder,
    manualDay: segment.mode === 'fixed' ? { mode: segment.mode, expectedBreakMinutes: 0 }
      : { mode: segment.mode, expectedBreakMinutes: 0, expectedWorkMinutes: Number(segment.workMinutes) },
    id: `${segment.scheduleId}:${segment.id}`,
    unitId: schedules.find(({ id }) => id === segment.scheduleId)?.unitId ?? '',
    startTime: segment.startTime, endTime: segment.endTime,
    manualBreak: segment.breakStart || segment.breakEnd ? { start: segment.breakStart, end: segment.breakEnd } : undefined,
  }));
  const review = reviewSplitJourney(rows);
  const available = existing.filter((shift) =>
    !segments.some((segment) => segment.id === shift.id && segment.scheduleId === shift.scheduleId));
  const move = (index: number, step: -1 | 1) => setSegments((current) => {
    const target = index + step;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const byStart = (list: Segment[]) => [...list].sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
  const outOfOrder = segments.some((segment, index) => segments[index + 1]
    && segment.startTime && segments[index + 1].startTime && segment.startTime > segments[index + 1].startTime);
  const update = (index: number, change: Partial<Segment>) =>
    setSegments((current) => current.map((segment, position) => position === index ? { ...segment, ...change } : segment));

  const legacyLoad = existing.find((shift) => shift.manualOrder == null && shift.manualDay?.mode === 'flexible')?.manualDay;
  function draftVersions(scheduleId: string) {
    const draft = drafts?.[schedules.findIndex((schedule) => schedule.id === scheduleId)];
    return { expectedDraftVersion: draft?.draftVersion, expectedDraftGenerationId: draft?.draftGenerationId,
      expectedOperationalVersion: draft?.operationalVersion };
  }

  async function save() {
    if (review.issues.length) {
      setError(review.issues[0].message);
      return;
    }
    const input = manualJourneyDraftSchema.safeParse({
      date, userId,
      removals: available.filter((shift) => shift.manualDay).map(({ scheduleId, id }) => ({
        scheduleId, shiftId: id, ...draftVersions(scheduleId),
      })),
      segments: segments.map(({ scheduleId, id, existing: saved }, index) => {
        const { unitId, startTime, endTime, manualBreak, manualDay } = rows[index];
        const expectedBreakMinutes = manualBreak
          ? clockMinutes(manualBreak.end) - clockMinutes(manualBreak.start) : 0;
        return { unitId, startTime, endTime, manualBreak, manualDay: { ...manualDay, expectedBreakMinutes },
          scheduleId, shiftId: id, existing: saved, ...draftVersions(scheduleId) };
      }),
    });
    if (!input.success) {
      setError('Confira a carga, a pausa e os horários antes de salvar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveManualJourneyDraft(input.data);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a jornada.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Jornada manual · {date.split('-').reverse().join('/')}</DialogTitle>
          <DialogDescription>Organize os períodos de trabalho e as pausas do dia.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Colaboradora
            <select className={selectClass} value={userId} disabled={!drafts || Boolean(seed) || saving}
              onChange={(event) => selectPerson(event.target.value)}>
              <option value="">Selecionar</option>
              {people.map(({ id, username }) => <option key={id} value={id}>{username || id}</option>)}
            </select>
          </label>
        </div>
        {legacyLoad?.mode === 'flexible' && <p className="text-sm text-muted-foreground">
          Carga flexível anterior de {legacyLoad.expectedWorkMinutes} min no dia. Confira a distribuição entre os trechos antes de salvar.
        </p>}
        {!drafts && !error && <p role="status" className="text-sm">Carregando rascunhos…</p>}
        {drafts && userId && <fieldset className="space-y-3" disabled={saving}>
          {segments.length > 1 && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className={outOfOrder ? 'font-medium text-amber-600' : ''}>
              {outOfOrder ? 'Os trechos não estão em ordem de horário.' : 'Use as setas para reorganizar os trechos.'}
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs"
              onClick={() => setSegments(byStart)}>
              <ArrowUpDown className="h-3.5 w-3.5" />Ordenar por horário
            </Button>
          </div>}
          {segments.map((segment, index) => {
            return <fieldset key={`${segment.scheduleId}:${segment.id}`} className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                <span className="text-sm font-medium">Trecho {index + 1}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Subir trecho ${index + 1}`}
                    disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Descer trecho ${index + 1}`}
                    disabled={index === segments.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive"
                    aria-label={`Retirar trecho ${index + 1}`}
                    onClick={() => setSegments((current) => current.filter((_, position) => index !== position))}>
                    <X className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
                <label className="text-xs text-muted-foreground">Regime
                  <select className={selectClass} value={segment.mode}
                    onChange={(event) => update(index, { mode: event.target.value === 'flexible' ? 'flexible' : 'fixed' })}>
                    <option value="fixed">Fixo</option><option value="flexible">Flexível</option>
                  </select>
                </label>
                <label className="col-span-2 text-xs text-muted-foreground sm:col-span-2">Unidade
                  <select className={selectClass} value={segment.scheduleId} disabled={segment.existing}
                    onChange={(event) => update(index, { scheduleId: event.target.value })}>
                    {schedules.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">{segment.mode === 'flexible' ? 'Janela de' : 'Início'}<Input type="time" value={segment.startTime}
                  onChange={(event) => update(index, { startTime: event.target.value })} /></label>
                <label className="text-xs text-muted-foreground">{segment.mode === 'flexible' ? 'Janela até' : 'Fim'}<Input type="time" value={segment.endTime}
                  onChange={(event) => update(index, { endTime: event.target.value })} /></label>
                <label className="text-xs text-muted-foreground">Pausa de<Input type="time" value={segment.breakStart}
                  onChange={(event) => update(index, { breakStart: event.target.value })} /></label>
                <label className="text-xs text-muted-foreground">Pausa até<Input type="time" value={segment.breakEnd}
                  onChange={(event) => update(index, { breakEnd: event.target.value })} /></label>
              </div>
              {segment.mode === 'flexible' && <label className="mt-2 block max-w-48 text-xs text-muted-foreground">
                Carga líquida em minutos
                <Input type="number" min={1} max={1439} value={segment.workMinutes}
                  onChange={(event) => update(index, { workMinutes: event.target.value })} />
              </label>}
            </fieldset>;
          })}
          {!!available.length && <div className="space-y-1">
            <p className="text-sm font-medium">Turnos existentes</p>
            {available.map((shift) => <Button key={`${shift.scheduleId}:${shift.id}`} type="button" variant="outline"
              disabled={segments.length >= 32} onClick={() => setSegments((current) => [...current, fromShift(shift)])}>
              Incluir {schedules.find(({ id }) => id === shift.scheduleId)?.name} · {shift.startTime}–{shift.endTime}
            </Button>)}
          </div>}
          <Button type="button" variant="outline" disabled={segments.length >= 32}
            onClick={() => setSegments((current) => [...current, blankSegment(originScheduleId)])}>
            <Plus className="mr-1 h-4 w-4" />Adicionar trecho</Button>
        </fieldset>}
        {segments.length > 0 && !review.issues.length && <div aria-live="polite" className="space-y-1 text-sm">
          <ol className="list-decimal pl-5">
            {review.segments.map((segment) => <li key={segment.id}>
              {schedules.find(({ unitId }) => unitId === segment.unitId)?.name} · {segment.manualDay?.mode === 'flexible'
                ? `${segment.manualDay.expectedWorkMinutes ?? 0} min`
                : `${segment.startTime}–${segment.endTime}`}
            </li>)}
          </ol>
          <p>Jornada líquida {Math.floor(review.workMinutes / 60)}h{String(review.workMinutes % 60).padStart(2, '0')}</p>
          {review.changes.map(({ fromId, toId, minutes }) => <p key={`${fromId}:${toId}`}
            className={minutes === 0 ? 'text-amber-700' : 'text-muted-foreground'}>
            Trechos {rows.findIndex(({ id }) => id === fromId) + 1} e {rows.findIndex(({ id }) => id === toId) + 1}
            {' · '}{minutes === 0 ? 'Sem janela para a troca de unidade.'
              : minutes == null ? 'Troca de unidade sem horário de referência.' : `Janela de referência para a troca de unidade de ${minutes} min.`}
          </p>)}
          {review.breakMinutes > 0 && <p>Pausa planejada {review.breakMinutes} min</p>}
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Fechar</Button>
          <Button type="button" disabled={saving || !drafts || !segments.length} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
