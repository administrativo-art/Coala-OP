'use client';

import { useEffect, useState } from 'react';
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
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
};

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

function fromShift(shift: DPShift): Segment {
  return { id: shift.id, scheduleId: shift.scheduleId, existing: true,
    startTime: shift.startTime, endTime: shift.endTime,
    breakStart: shift.manualBreak?.start ?? '', breakEnd: shift.manualBreak?.end ?? '' };
}

function blankSegment(scheduleId: string): Segment {
  return { id: crypto.randomUUID(), scheduleId, existing: false, startTime: '', endTime: '', breakStart: '', breakEnd: '' };
}

type Draft = Awaited<ReturnType<typeof fetchDraftScheduleShifts>>;

function shiftsOfDay(drafts: Draft[], userId: string, date: string) {
  return drafts.flatMap(({ shifts }) => shifts).filter((shift) =>
    shift.userId === userId && shift.date === date && shift.type !== 'day_off');
}

function initialForm(drafts: Draft[], userId: string, date: string, originScheduleId: string, seed?: DPShift) {
  const day = shiftsOfDay(drafts, userId, date);
  const selected = day.filter((shift) => shift.manualDay || (shift.id === seed?.id && shift.scheduleId === seed?.scheduleId));
  const settings = day.find((shift) => shift.manualDay)?.manualDay;
  return {
    mode: settings?.mode ?? 'fixed',
    expectedWorkMinutes: settings?.mode === 'flexible' ? String(settings.expectedWorkMinutes) : '',
    segments: selected.length ? selected.map(fromShift) : day.length || !userId ? [] : [blankSegment(originScheduleId)],
  } as const;
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
  const [mode, setMode] = useState<'fixed' | 'flexible'>('fixed');
  const [expectedWorkMinutes, setExpectedWorkMinutes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(schedules.map(({ id }) => fetchDraftScheduleShifts(id))).then((result) => {
      if (cancelled) return;
      const form = initialForm(result, seed?.userId ?? '', date, originScheduleId, seed);
      setDrafts(result);
      setMode(form.mode);
      setExpectedWorkMinutes(form.expectedWorkMinutes);
      setSegments(form.segments);
    }).catch(() => {
      if (!cancelled) setError('Não foi possível carregar os rascunhos. Feche e abra a jornada novamente.');
    });
    return () => { cancelled = true; };
  }, [date, originScheduleId, schedules, seed]);

  const existing = drafts ? shiftsOfDay(drafts, userId, date) : [];

  function selectPerson(id: string) {
    const form = initialForm(drafts ?? [], id, date, originScheduleId);
    setUserId(id);
    setMode(form.mode);
    setExpectedWorkMinutes(form.expectedWorkMinutes);
    setSegments(form.segments);
    setError('');
  }

  const rows = segments.map((segment) => ({
    id: `${segment.scheduleId}:${segment.id}`,
    unitId: schedules.find(({ id }) => id === segment.scheduleId)?.unitId ?? '',
    startTime: segment.startTime, endTime: segment.endTime,
    manualBreak: segment.breakStart || segment.breakEnd ? { start: segment.breakStart, end: segment.breakEnd } : undefined,
  }));
  const review = reviewSplitJourney(rows);
  const available = existing.filter((shift) =>
    !segments.some((segment) => segment.id === shift.id && segment.scheduleId === shift.scheduleId));
  const update = (index: number, change: Partial<Segment>) =>
    setSegments((current) => current.map((segment, position) => position === index ? { ...segment, ...change } : segment));

  async function save() {
    const manualDay = mode === 'fixed'
      ? { mode, expectedBreakMinutes: review.breakMinutes }
      : { mode, expectedBreakMinutes: review.breakMinutes, expectedWorkMinutes: Number(expectedWorkMinutes) };
    const input = manualJourneyDraftSchema.safeParse({
      date, userId, manualDay,
      segments: segments.map(({ scheduleId, id, existing: saved }, index) => {
        const { unitId, startTime, endTime, manualBreak } = rows[index];
        const draft = drafts?.[schedules.findIndex((schedule) => schedule.id === scheduleId)];
        return { unitId, startTime, endTime, manualBreak, scheduleId, shiftId: id, existing: saved, expectedDraftVersion: draft?.draftVersion,
          expectedDraftGenerationId: draft?.draftGenerationId, expectedOperationalVersion: draft?.operationalVersion };
      }),
    });
    if (!input.success || review.issues.length) {
      setError(review.issues[0]?.message ?? 'Confira a carga, a pausa e os horários antes de salvar.');
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
          <label className="space-y-1 text-sm">Regime
            <select className={selectClass} value={mode} disabled={saving}
              onChange={(event) => setMode(event.target.value === 'flexible' ? 'flexible' : 'fixed')}>
              <option value="fixed">Fixa</option><option value="flexible">Flexível</option>
            </select>
          </label>
        </div>
        {mode === 'flexible' && <label className="space-y-1 text-sm">Carga líquida esperada no dia, em minutos
          <Input type="number" min={1} max={1439} value={expectedWorkMinutes} disabled={saving}
            onChange={(event) => setExpectedWorkMinutes(event.target.value)} />
        </label>}
        {!drafts && !error && <p role="status" className="text-sm">Carregando rascunhos…</p>}
        {drafts && userId && <fieldset className="space-y-3" disabled={saving}>
          {segments.map((segment, index) => {
            const locked = existing.some((shift) => shift.id === segment.id
              && shift.scheduleId === segment.scheduleId && Boolean(shift.manualDay));
            return <fieldset key={`${segment.scheduleId}:${segment.id}`} className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Trecho {index + 1}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-sm">Unidade
                  <select className={selectClass} value={segment.scheduleId} disabled={segment.existing}
                    onChange={(event) => update(index, { scheduleId: event.target.value })}>
                    {schedules.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
                <label className="text-sm">Início<Input type="time" value={segment.startTime}
                  onChange={(event) => update(index, { startTime: event.target.value })} /></label>
                <label className="text-sm">Fim<Input type="time" value={segment.endTime}
                  onChange={(event) => update(index, { endTime: event.target.value })} /></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-sm">Início da pausa<Input type="time" value={segment.breakStart}
                  onChange={(event) => update(index, { breakStart: event.target.value })} /></label>
                <label className="text-sm">Fim da pausa<Input type="time" value={segment.breakEnd}
                  onChange={(event) => update(index, { breakEnd: event.target.value })} /></label>
                {!locked && <Button type="button" variant="ghost" className="self-end"
                  onClick={() => setSegments((current) => current.filter((_, position) => index !== position))}>
                  Retirar da seleção
                </Button>}
              </div>
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
            onClick={() => setSegments((current) => [...current, blankSegment(originScheduleId)])}>Adicionar trecho</Button>
        </fieldset>}
        {segments.length > 0 && !review.issues.length && <div aria-live="polite" className="space-y-1 text-sm">
          <ol className="list-decimal pl-5">
            {review.segments.map((segment) => <li key={segment.id}>
              {schedules.find(({ unitId }) => unitId === segment.unitId)?.name} · {segment.startTime}–{segment.endTime}
            </li>)}
          </ol>
          <p>Jornada líquida {Math.floor(review.journeyMinutes / 60)}h{String(review.journeyMinutes % 60).padStart(2, '0')}
            {review.travelMinutes > 0 && ` · inclui ${review.travelMinutes} min entre unidades`}</p>
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
