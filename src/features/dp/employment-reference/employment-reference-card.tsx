'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { BriefcaseBusiness, ChevronDown, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { PanelSection, SidePanel } from '@/components/patterns/side-panel';
import type { DPUnit, User } from '@/types';

import { employmentPublicationError, loadEmploymentHistory, publishEmploymentHistory } from './client';
import {
  employmentRelationshipLabels,
  employerCatalogIssues,
  formatCivilDateBR,
  formatCnpj,
  incompleteDraftFields,
  prepareTimelinePublication,
  seedEmploymentPeriod,
  unitLabel,
  type EmploymentHistoryResult,
  type EmploymentPeriodDraft,
} from './presentation';
import type { EmploymentPeriod } from './resolve';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; result: EmploymentHistoryResult };

type SummaryProps = {
  result: EmploymentHistoryResult;
  units: DPUnit[];
};

function displayNames(names: string[], fallback: string) {
  return names.filter(Boolean).join(', ') || fallback;
}

function PeriodCard({ period, units, index }: { period: EmploymentPeriod; units: DPUnit[]; index: number }) {
  return (
    <article className="rounded-ds-btn-lg border border-ds-border bg-ds-page px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-ds-ink">Vigência {index + 1}</p>
        <StatusPill variant={period.validTo ? 'neutral' : 'ok'}>{period.validTo ? 'Encerrada' : 'Atual'}</StatusPill>
      </div>
      <p className="mt-1 text-xs font-semibold text-ds-ink-muted">
        {formatCivilDateBR(period.validFrom)} até {period.validTo ? formatCivilDateBR(period.validTo) : 'vigência aberta'}
      </p>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div><dt className="font-extrabold text-ds-ink-faint">Relação</dt><dd className="mt-0.5 font-semibold text-ds-ink">{employmentRelationshipLabels[period.employmentRelationshipType]}</dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Empregador cadastrado</dt><dd className="mt-0.5 font-semibold text-ds-ink">{period.employer.unitName}<span className="block font-mono text-[11px] text-ds-ink-muted">{formatCnpj(period.employer.cnpj)}</span></dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Referência financeira</dt><dd className="mt-0.5 font-semibold text-ds-ink">{unitLabel(period.unitId, units)}</dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Unidades operacionais</dt><dd className="mt-0.5 font-semibold text-ds-ink">{period.unitIds.map((id) => unitLabel(id, units)).join(', ')}</dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Cargo congelado</dt><dd className="mt-0.5 font-semibold text-ds-ink">{period.jobRoleName || 'Sem cargo registrado'}</dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Funções congeladas</dt><dd className="mt-0.5 font-semibold text-ds-ink">{displayNames(period.jobFunctionNames, 'Sem funções registradas')}</dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Referência do documento-base</dt><dd className="mt-0.5 break-all font-mono font-semibold text-ds-ink">{period.sourceDocumentId}</dd></div>
        <div><dt className="font-extrabold text-ds-ink-faint">Motivo</dt><dd className="mt-0.5 font-semibold text-ds-ink">{period.sourceReason}</dd></div>
      </dl>
      <p className="mt-3 rounded-ds-sm border border-ds-info/20 bg-ds-info-bg px-3 py-2 text-[11.5px] font-semibold leading-5 text-ds-info">
        Cadastro da unidade conferido por CNPJ, endereço e nome operacional. A razão social e o vínculo jurídico ainda não foram atestados.
      </p>
    </article>
  );
}

export function EmploymentReferenceSummary({ result, units }: SummaryProps) {
  if (result.status === 'missing') {
    return (
      <div className="rounded-ds-btn-lg border border-dashed border-ds-border-input bg-ds-page p-4">
        <StatusPill variant="neutral">Sem histórico</StatusPill>
        <p className="mt-2 text-sm font-semibold text-ds-ink-muted">Nenhuma vigência de vínculo foi publicada para esta pessoa.</p>
      </div>
    );
  }
  if (result.status === 'inconsistent') {
    return (
      <div role="alert" className="rounded-ds-btn-lg border border-ds-danger/20 bg-ds-danger-bg p-4 text-sm text-ds-danger">
        <StatusPill variant="danger">Histórico inconsistente</StatusPill>
        <p className="mt-2 font-semibold">A revisão disponível não pôde ser validada. Atualize a leitura antes de qualquer publicação.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill variant="info">Revisão {result.revision}</StatusPill>
        <span className="text-xs font-semibold text-ds-ink-faint">{result.periods.length} período(s)</span>
      </div>
      {[...result.periods].reverse().map((period, reverseIndex) => (
        <PeriodCard key={`${period.validFrom}-${period.sourceDocumentId}`} period={period} units={units} index={result.periods.length - reverseIndex - 1} />
      ))}
    </div>
  );
}

const selectClassName = 'h-10 w-full appearance-none rounded-ds-md border border-ds-border-input bg-ds-input px-3 pr-12 text-[13px] font-semibold text-ds-ink outline-hidden focus:border-ds-modal focus:bg-white focus:ring-[3px] focus:ring-ds-modal-soft focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60';
const inputClassName = 'h-10 w-full rounded-ds-md border border-ds-border-input bg-ds-input px-3 text-[13px] font-semibold text-ds-ink outline-hidden focus-visible:border-ds-modal focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-ds-modal-soft focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60';

function SelectField({ label, value, onChange, children, disabled }: {
  label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-ds-ink">
      {label}
      <span className="relative">
        <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={selectClassName}>{children}</select>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 right-1 grid w-8 place-items-center rounded-ds-sm border border-ds-border bg-ds-surface shadow-xs"><ChevronDown className="h-4 w-4" /></span>
      </span>
    </label>
  );
}

export function EmploymentReferenceCard({ user, units, firebaseUser, canPublish }: {
  user: User;
  units: DPUnit[];
  firebaseUser: FirebaseUser | null;
  canPublish: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<EmploymentPeriodDraft>(() => seedEmploymentPeriod(user).draft);
  const [requestId, setRequestId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const availableUnits = useMemo(() => units.filter((unit) => unit.isArchived !== true), [units]);

  const refresh = useCallback(async () => {
    if (!firebaseUser) return;
    setState({ kind: 'loading' });
    try {
      const result = await loadEmploymentHistory(firebaseUser, user.id);
      setState({ kind: 'ready', result });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar as vigências do vínculo.' });
    }
  }, [firebaseUser, user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  function openPublication() {
    setDraft(seedEmploymentPeriod(user).draft);
    setRequestId(globalThis.crypto.randomUUID());
    setFormError(null);
    setConflict(false);
    setPanelOpen(true);
  }

  function updateDraft(patch: Partial<EmploymentPeriodDraft>) {
    if (saving) return;
    setDraft((current) => ({ ...current, ...patch }));
    setFormError(null);
    setConflict(false);
  }

  const result = state.kind === 'ready' ? state.result : null;
  const preparation = result ? prepareTimelinePublication(result, draft) : null;
  const missing = [...incompleteDraftFields(draft, user), ...employerCatalogIssues(draft.employerUnitId, availableUnits)];

  async function publish() {
    if (!firebaseUser || !result || saving) return;
    if (missing.length) {
      setFormError(`Complete antes de publicar: ${missing.join(', ')}.`);
      return;
    }
    if (!preparation?.ok) {
      setFormError(preparation?.message ?? 'Atualize o histórico antes de publicar.');
      return;
    }
    setSaving(true);
    setFormError(null);
    setConflict(false);
    try {
      await publishEmploymentHistory(firebaseUser, user.id, {
        expectedRevision: result.status === 'found' ? result.revision : 0,
        requestId,
        periods: preparation.periods,
      });
      setPanelOpen(false);
      await refresh();
    } catch (error) {
      const presentation = employmentPublicationError(error);
      setFormError(presentation.message);
      setConflict(presentation.conflict);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="rounded-xl border border-ds-border bg-ds-surface shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-divider px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-accent-soft text-ds-accent-ink"><BriefcaseBusiness className="h-4 w-4" /></span>
            <div><h2 className="text-sm font-extrabold text-ds-ink">Vigências do vínculo</h2><p className="text-[11px] font-semibold text-ds-ink-faint">Histórico privado por período</p></div>
          </div>
          {canPublish && state.kind === 'ready' && state.result.status !== 'inconsistent' ? (
            <Button variant="primary-page" size="xs" onClick={openPublication}>{state.result.status === 'missing' ? 'Criar vigência' : 'Adicionar vigência'}</Button>
          ) : null}
        </header>
        <div className="p-3">
          {state.kind === 'loading' ? (
            <div role="status" className="flex items-center gap-2 rounded-ds-btn-lg bg-ds-page p-4 text-sm font-semibold text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Carregando vigências…</div>
          ) : state.kind === 'error' ? (
            <div role="alert" className="space-y-3 rounded-ds-btn-lg border border-ds-danger/20 bg-ds-danger-bg p-4 text-sm text-ds-danger"><p className="font-semibold">{state.message}</p><Button variant="ds-secondary" size="xs" onClick={() => void refresh()}>Tentar novamente</Button></div>
          ) : <EmploymentReferenceSummary result={state.result} units={units} />}
        </div>
      </section>

      <SidePanel open={panelOpen} onOpenChange={(open) => { if (!open && saving) return; setPanelOpen(open); }} kicker="Vínculo" title="Adicionar vigência" subtitle={user.username}>
        <PanelSection title="Período e referência">
          <label className="grid gap-1.5 text-xs font-bold text-ds-ink">Início da nova vigência
            <input type="date" value={draft.validFrom} onChange={(event) => updateDraft({ validFrom: event.target.value })} disabled={saving} className={inputClassName} />
          </label>
          {preparation?.ok && preparation.closesPreviousAt ? (
            <p className="rounded-ds-sm border border-ds-warn/20 bg-ds-warn-bg px-3 py-2 text-xs font-semibold leading-5 text-ds-warn">
              A vigência anterior será encerrada em {formatCivilDateBR(preparation.closesPreviousAt)}. A nova começará em {formatCivilDateBR(draft.validFrom)}.
            </p>
          ) : result?.status === 'found' && result.periods.at(-1)?.validTo ? (
            <p className="rounded-ds-sm border border-ds-info/20 bg-ds-info-bg px-3 py-2 text-xs font-semibold leading-5 text-ds-info">A vigência anterior já está encerrada. A data informada será preservada, inclusive se houver lacuna.</p>
          ) : null}
          <label className="grid gap-1.5 text-xs font-bold text-ds-ink">Código ou referência do documento-base
            <input value={draft.sourceDocumentId} onChange={(event) => updateDraft({ sourceDocumentId: event.target.value })} disabled={saving} className={inputClassName} placeholder="Ex.: contrato_2026_001" autoComplete="off" />
          </label>
          <p className="text-[11.5px] font-semibold leading-5 text-ds-ink-muted">Este campo registra uma referência rastreável. Ele não anexa nem valida o documento citado.</p>
          <label className="grid gap-1.5 text-xs font-bold text-ds-ink">Motivo da publicação
            <textarea value={draft.sourceReason} onChange={(event) => updateDraft({ sourceReason: event.target.value })} disabled={saving} className="min-h-24 w-full resize-y rounded-ds-md border border-ds-border-input bg-ds-input px-3 py-2.5 text-[13px] font-semibold text-ds-ink outline-hidden focus-visible:border-ds-modal focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-ds-modal-soft focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60" placeholder="Explique a origem e a razão desta vigência." />
          </label>
        </PanelSection>

        <PanelSection title="Vínculo atual">
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div><p className="font-extrabold text-ds-ink-faint">Relação</p><p className="mt-0.5 font-semibold text-ds-ink">{user.employmentRelationshipType ? employmentRelationshipLabels[user.employmentRelationshipType] : 'Não cadastrada'}</p></div>
            <div><p className="font-extrabold text-ds-ink-faint">Cargo</p><p className="mt-0.5 font-semibold text-ds-ink">{user.jobRoleName || user.jobRoleId || 'Não cadastrado'}</p></div>
            <div className="sm:col-span-2"><p className="font-extrabold text-ds-ink-faint">Funções</p><p className="mt-0.5 font-semibold text-ds-ink">{displayNames(user.jobFunctionNames ?? [], Array.isArray(user.jobFunctionIds) ? 'Sem funções registradas' : 'Não cadastradas')}</p></div>
          </div>
          <p className="text-[11.5px] font-semibold leading-5 text-ds-ink-muted">Cargo, funções e tipo de vínculo vêm do cadastro atual. A publicação congela os nomes encontrados no catálogo do RH.</p>
        </PanelSection>

        <PanelSection title="Unidades">
          <SelectField label="Unidade empregadora" value={draft.employerUnitId} onChange={(employerUnitId) => updateDraft({ employerUnitId })} disabled={saving}>
            <option value="">Selecione sem usar a lotação</option>
            {availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.cnpj ? ` · ${formatCnpj(unit.cnpj)}` : ''}</option>)}
          </SelectField>
          <p className="text-[11.5px] font-semibold leading-5 text-ds-ink-muted">O nome exibido é operacional. O servidor confere CNPJ e endereço; esta seleção não atesta razão social nem vínculo jurídico.</p>
          <SelectField label="Referência financeira" value={draft.unitId} onChange={(unitId) => updateDraft({ unitId })} disabled={saving}>
            <option value="">Selecione a lotação</option>
            {availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </SelectField>
          <p className="text-[11.5px] font-semibold leading-5 text-ds-ink-muted">Lotação e custos. Pode ser diferente das unidades operacionais e não libera escala nem batida de ponto.</p>
          <fieldset>
            <legend className="text-xs font-bold text-ds-ink">Unidades operacionais</legend>
            <div className="mt-2 grid max-h-44 gap-2 overflow-y-auto rounded-ds-btn border border-ds-border bg-ds-page p-3">
              {availableUnits.map((unit) => {
                const checked = draft.unitIds.includes(unit.id);
                return <label key={unit.id} className="flex items-center gap-2 text-xs font-semibold text-ds-ink"><input type="checkbox" checked={checked} disabled={saving} onChange={() => updateDraft({ unitIds: checked ? draft.unitIds.filter((id) => id !== unit.id) : [...draft.unitIds, unit.id] })} className="h-4 w-4 accent-(--ds-modal) disabled:cursor-not-allowed disabled:opacity-60" />{unit.name}</label>;
              })}
            </div>
          </fieldset>
        </PanelSection>

        {missing.length ? (
          <div role="alert" className="rounded-ds-btn-lg border border-ds-warn/20 bg-ds-warn-bg px-4 py-3 text-xs font-semibold leading-5 text-ds-warn">Complete antes de publicar: {missing.join(', ')}.</div>
        ) : null}
        {formError ? <div role="alert" className="rounded-ds-btn-lg border border-ds-danger/20 bg-ds-danger-bg px-4 py-3 text-xs font-semibold leading-5 text-ds-danger">{formError}</div> : null}
        {conflict ? <Button variant="ds-secondary" size="sm" onClick={() => { setPanelOpen(false); void refresh(); }}>Atualizar histórico</Button> : null}
        <div className="sticky bottom-0 z-10 -mx-6 -mb-5 flex justify-end gap-2 border-t border-ds-divider bg-ds-warm px-6 py-4">
          <Button variant="ds-ghost" size="md" disabled={saving} onClick={() => setPanelOpen(false)}>Cancelar</Button>
          <Button variant="primary-modal" size="md" loading={saving} loadingLabel="Publicando…" disabled={missing.length > 0 || !preparation?.ok || conflict} onClick={() => void publish()}>Publicar vigência</Button>
        </div>
      </SidePanel>
    </>
  );
}
