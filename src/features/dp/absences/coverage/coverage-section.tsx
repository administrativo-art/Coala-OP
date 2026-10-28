"use client";

import { useCallback, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { Loader2, Search } from 'lucide-react';

import { PanelSection } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';

import { decideAbsenceCoverage, fetchAbsenceCoverage, fetchAbsenceCoverageCandidates } from './client';
import { COVERAGE_MODE_LABELS, formatCoverageDate, type CoverageMode } from './core';
import type { AbsenceCoverageCandidate, AbsenceCoverageShift, AbsenceCoverageView } from './types';

const CHOICES: Array<{ mode: CoverageMode; title: string; detail: string }> = [
  { mode: 'cover', title: 'Sim, alguém vai cobrir', detail: 'A pessoa entra na escala e é avisada no sino.' },
  { mode: 'closed', title: 'Não, o quiosque fecha nesse turno', detail: 'Fica registrado que o turno não terá operação.' },
  { mode: 'understaffed', title: 'Não, desfalque', detail: 'O quiosque abre com uma pessoa a menos.' },
];

function weekday(date: string) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)).replace('.', '');
}

function RadioMark({ checked }: { checked: boolean }) {
  return <span aria-hidden="true" className={cn('mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-ds-border-input',
    checked && 'border-[5px] border-ds-accent-ink')} />;
}

function CandidateRow({ candidate, selected, onSelect }: { candidate: AbsenceCoverageCandidate; selected: boolean; onSelect: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} disabled={!candidate.eligible} onClick={onSelect}
    className={cn('flex w-full items-center gap-3 rounded-ds-btn border px-3 py-2.5 text-left transition-colors',
      candidate.eligible ? 'border-ds-border-input bg-ds-surface hover:bg-ds-muted' : 'cursor-not-allowed border-dashed border-ds-border bg-ds-muted',
      selected && 'border-ds-accent-ink bg-ds-accent-row')}>
    <span className="min-w-0 flex-1">
      <span className={cn('block text-[13.5px] font-extrabold', candidate.eligible ? 'text-ds-ink' : 'text-ds-ink-faint')}>
        {candidate.name}{candidate.external ? <span className="font-semibold text-ds-ink-muted"> · {candidate.originUnitName}</span> : null}
      </span>
      <span className="block text-xs text-ds-ink-muted">{candidate.summary}</span>
    </span>
    {candidate.eligible ? <RadioMark checked={selected} /> : null}
  </button>;
}

function DecidedShift({ shift }: { shift: AbsenceCoverageShift }) {
  const decision = shift.decision!;
  const label = decision.mode === 'cover'
    ? `Coberto por ${decision.substituteName ?? 'colaborador'}${decision.external ? ' (outra unidade)' : ''}`
    : COVERAGE_MODE_LABELS[decision.mode];
  return <div className="space-y-1">
    <StatusPill variant={decision.mode === 'cover' ? 'ok' : decision.mode === 'closed' ? 'danger' : 'warn'}>{decision.mode === 'cover' ? 'Coberto' : decision.mode === 'closed' ? 'Sem operação' : 'Desfalque'}</StatusPill>
    <p className="text-[13px] font-semibold text-ds-ink">{label}</p>
    {decision.exceptionReason ? <p className="text-xs text-ds-ink-muted">Motivo: {decision.exceptionReason}</p> : null}
    {decision.decidedByName ? <p className="text-xs text-ds-ink-faint">Definido por {decision.decidedByName}</p> : null}
  </div>;
}

function PendingShift({ firebaseUser, view, shift, onSaved }: {
  firebaseUser: FirebaseUser; view: AbsenceCoverageView; shift: AbsenceCoverageShift; onSaved: (view: AbsenceCoverageView | null) => void;
}) {
  const [mode, setMode] = useState<CoverageMode | null>(null);
  const [candidates, setCandidates] = useState<AbsenceCoverageCandidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [search, setSearch] = useState('');
  const [substituteUid, setSubstituteUid] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCandidates = useCallback(async (term?: string) => {
    setLoadingCandidates(true); setError(null);
    try {
      const response = await fetchAbsenceCoverageCandidates(firebaseUser, view.requestId, { displacedId: shift.id, search: term });
      setCandidates(response.candidates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível conferir quem pode cobrir.');
    } finally { setLoadingCandidates(false); }
  }, [firebaseUser, shift.id, view.requestId]);

  useEffect(() => { if (mode === 'cover' && candidates === null) void loadCandidates(); }, [candidates, loadCandidates, mode]);

  const chosen = candidates?.find((candidate) => candidate.uid === substituteUid) ?? null;
  const missing = !mode ? 'Escolha uma opção.'
    : mode === 'cover' && !chosen ? 'Escolha quem vai cobrir.'
      : chosen?.external && reason.trim().length < 3 ? 'Informe o motivo da cobertura por outra unidade.' : null;
  const sameUnit = candidates?.filter((candidate) => !candidate.external) ?? [];
  const otherUnits = candidates?.filter((candidate) => candidate.external) ?? [];

  const save = async () => {
    if (missing || saving || !mode) return;
    setSaving(true); setError(null);
    try {
      const response = await decideAbsenceCoverage(firebaseUser, view.requestId, mode === 'cover'
        ? { mode, displacedId: shift.id, substituteUid: chosen!.uid, operationId: crypto.randomUUID(),
          ...(chosen!.external ? { exceptionReason: reason.trim() } : {}) }
        : { mode, displacedId: shift.id, operationId: crypto.randomUUID() });
      onSaved(response.coverage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a cobertura.');
    } finally { setSaving(false); }
  };

  return <div className="space-y-3">
    <p className="text-[12px] font-extrabold text-ds-ink">Vamos ter alguém para cobrir?</p>
    <div role="radiogroup" aria-label="Cobertura do turno" className="space-y-2">
      {CHOICES.map((choice) => <div key={choice.mode} className="space-y-2">
        <button type="button" role="radio" aria-checked={mode === choice.mode}
          onClick={() => { setMode(choice.mode); if (choice.mode !== 'cover') setSubstituteUid(null); }}
          className={cn('flex w-full items-start gap-3 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3.5 py-3 text-left transition-colors hover:bg-ds-muted',
            mode === choice.mode && 'border-ds-accent-ink bg-ds-accent-row')}>
          <RadioMark checked={mode === choice.mode} />
          <span><span className="block text-[13.5px] font-extrabold text-ds-ink">{choice.title}</span>
            <span className="block text-xs text-ds-ink-muted">{choice.detail}</span></span>
        </button>
        {choice.mode === 'cover' && mode === 'cover' ? <div className="space-y-2 pl-[30px]">
          {loadingCandidates && !candidates ? <p className="flex items-center gap-2 text-xs text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Conferindo jornada e escala de cada pessoa…</p> : null}
          {candidates ? <>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{view.unitName} · mesma unidade</p>
            {sameUnit.length ? <div role="radiogroup" aria-label="Pessoas da mesma unidade" className="space-y-1.5">
              {sameUnit.map((candidate) => <CandidateRow key={candidate.uid} candidate={candidate} selected={substituteUid === candidate.uid} onSelect={() => setSubstituteUid(candidate.uid)} />)}
            </div> : <p className="text-xs text-ds-ink-muted">Ninguém da unidade foi encontrado.</p>}
            {view.canAssignExternal ? <>
              <p className="pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Outras unidades</p>
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (search.trim().length >= 2) void loadCandidates(search); }}>
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar pessoa de outra unidade" className="h-10 rounded-ds-btn" />
                <Button type="submit" variant="ds-secondary" size="sm" disabled={search.trim().length < 2 || loadingCandidates}><Search className="h-4 w-4" />Buscar</Button>
              </form>
              {otherUnits.length ? <div role="radiogroup" aria-label="Pessoas de outras unidades" className="space-y-1.5">
                {otherUnits.map((candidate) => <CandidateRow key={candidate.uid} candidate={candidate} selected={substituteUid === candidate.uid} onSelect={() => setSubstituteUid(candidate.uid)} />)}
              </div> : null}
              {chosen?.external ? <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Motivo da cobertura por outra unidade
                <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Ex.: ninguém da unidade disponível" className="h-10 rounded-ds-btn" />
                <span className="block text-[11px] font-semibold text-ds-ink-faint">Turno de outra unidade não conta nas metas de {view.unitName}.</span></label> : null}
            </> : null}
            <p className="text-[11px] text-ds-ink-faint">Cada pessoa é conferida pelas regras da própria jornada e pela escala dela. O servidor confere de novo ao salvar.</p>
          </> : null}
        </div> : null}
      </div>)}
    </div>
    {error ? <p role="alert" className="text-xs font-bold text-ds-danger">{error}</p> : null}
    <div className="flex items-center justify-end gap-3 border-t border-ds-divider pt-3">
      {missing ? <span className="text-xs text-ds-ink-muted">{missing}</span> : null}
      <Button variant="primary-modal" size="md" disabled={Boolean(missing)} loading={saving} loadingLabel="Salvando…" onClick={() => void save()}>Concluir cobertura</Button>
    </div>
  </div>;
}

/** Última etapa da aprovação de ausência: o que acontece com cada turno retirado da escala. */
export function AbsenceCoverageSection({ firebaseUser, requestId, onChanged }: {
  firebaseUser: FirebaseUser | null; requestId: string; onChanged?: (view: AbsenceCoverageView) => void;
}) {
  const [view, setView] = useState<AbsenceCoverageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    setLoading(true); setError(null);
    void fetchAbsenceCoverage(firebaseUser, requestId)
      .then((response) => { if (active) setView(response.coverage); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a cobertura do turno.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [firebaseUser, requestId]);

  if (loading) return <PanelSection title="Cobertura do turno"><p className="flex items-center gap-2 text-xs text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Carregando turnos retirados…</p></PanelSection>;
  if (error) return <PanelSection title="Cobertura do turno"><p role="alert" className="text-xs font-bold text-ds-danger">{error}</p></PanelSection>;
  if (!view) return null;
  const pending = view.shifts.filter((shift) => !shift.decision).length;
  const update = (next: AbsenceCoverageView | null) => { setView(next); if (next) onChanged?.(next); };

  return <>{view.shifts.map((shift, index) => <PanelSection key={shift.id}
    title={view.shifts.length > 1 ? `Cobertura do turno ${index + 1} de ${view.shifts.length}` : 'Cobertura do turno'}
    aside={index === 0 && pending ? `${pending} sem decisão` : undefined}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-[15.5px] font-extrabold text-ds-ink">{weekday(shift.date)} {formatCoverageDate(shift.date)} · <span className="font-ds-mono">{shift.startTime}–{shift.endTime}</span></p>
      {!shift.decision ? <StatusPill variant="warn">Sem ninguém</StatusPill> : null}
    </div>
    <p className="text-xs text-ds-ink-muted">{view.unitName}{shift.shiftName ? ` · ${shift.shiftName}` : ''} · saiu da escala de {view.beneficiaryName}</p>
    {shift.decision ? <DecidedShift shift={shift} />
      : view.canDecide && firebaseUser ? <PendingShift firebaseUser={firebaseUser} view={view} shift={shift} onSaved={update} />
        : <p className="text-xs text-ds-ink-muted">Quem edita a escala desta unidade define a cobertura.</p>}
  </PanelSection>)}</>;
}
