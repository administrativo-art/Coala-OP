"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyResults, ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { ResponsibilityLevelsEditor } from '@/components/dp/absence-approval-assignments';
import { ControlPanel, ControlSearch } from '@/components/patterns/control-panel';
import { LiftRow } from '@/components/patterns/lift-row';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill';
import { useAuth } from '@/hooks/use-auth';
import { useHrBootstrap } from '@/hooks/use-hr-bootstrap';
import { RESPONSIBILITY_ACTIVITY_LABELS } from '@/features/dp/responsibility-coverage/model';
import { fetchResponsibilityCoverages, saveResponsibilityCoverage, type ResponsibilityCoverageRow } from '@/features/dp/responsibility-coverage/client';
import type { DPAbsenceApprovalLevel, DPResponsibilityActivity } from '@/types';

const statusLabels: Record<ResponsibilityCoverageRow['status'], string> = {
  covered: 'Coberto', warning: 'Coberto com atenção', uncovered: 'Sem responsável', draft: 'Rascunho',
};
const statusTones: Record<ResponsibilityCoverageRow['status'], StatusPillVariant> = {
  covered: 'ok', warning: 'warn', uncovered: 'danger', draft: 'neutral',
};

function validLevels(levels: DPAbsenceApprovalLevel[]) {
  return levels.length > 0 && levels.every((level) => level.kind === 'people' ? level.personIds.length > 0
    : level.kind === 'function' ? Boolean(level.functionId) : Boolean(level.jobRoleId));
}

function diagnosticText(row: ResponsibilityCoverageRow) {
  if (row.gapReason === 'not_configured') return 'Nenhuma hierarquia foi configurada.';
  if (row.gapReason === 'draft') return 'A hierarquia ainda não foi ativada.';
  if (row.gapReason === 'empty_scope') return 'O grupo ainda não possui unidade ativa.';
  if (row.gapReason === 'no_eligible_user') return 'Nenhuma pessoa reúne permissão e abrangência.';
  if (row.status === 'warning') return 'Há níveis inválidos na hierarquia, mas um nível posterior mantém a cobertura.';
  return `${row.eligibleUserIds.length} pessoa(s) apta(s) no nível ${Number(row.effectiveLevel) + 1}.`;
}

export function DPResponsibilityCoverage() {
  const { firebaseUser, activeUsers, permissions, isDefaultAdmin } = useAuth();
  const { roles, functions } = useHrBootstrap();
  const [activity, setActivity] = useState<DPResponsibilityActivity>('schedules');
  const [rows, setRows] = useState<ResponsibilityCoverageRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResponsibilityCoverageRow | null>(null);
  const [levels, setLevels] = useState<DPAbsenceApprovalLevel[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canManage = isDefaultAdmin || permissions.dp?.responsibilities?.manage === true;

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true); setError(null);
    try {
      const response = await fetchResponsibilityCoverages(firebaseUser, activity);
      setRows(response.coverages);
      setSelected((current) => current ? response.coverages.find((row) => row.id === current.id) ?? null : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as coberturas.');
    } finally { setLoading(false); }
  }, [activity, firebaseUser]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setLevels(selected?.levels ?? []); setSaveError(null); }, [selected]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return term ? rows.filter((row) => row.scopeName.toLocaleLowerCase('pt-BR').includes(term)) : rows;
  }, [rows, search]);
  const counts = useMemo(() => ({ covered: rows.filter((row) => row.status === 'covered').length,
    attention: rows.filter((row) => row.status === 'warning').length,
    gaps: rows.filter((row) => row.status === 'uncovered' || row.status === 'draft').length }), [rows]);
  const peopleById = useMemo(() => new Map(activeUsers.map((person) => [person.id, person.username])), [activeUsers]);

  const save = async (state: 'draft' | 'active') => {
    if (!firebaseUser || !selected || saving) return;
    setSaving(true); setSaveError(null);
    try {
      await saveResponsibilityCoverage(firebaseUser, { activity: selected.activity, scope: selected.scope, levels,
        state, expectedVersion: selected.version, operationId: crypto.randomUUID() });
      await load();
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Não foi possível salvar a cobertura.'); }
    finally { setSaving(false); }
  };

  return <div className="space-y-4">
    <ControlPanel className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RESPONSIBILITY_ACTIVITY_LABELS) as DPResponsibilityActivity[]).map((value) => <Button key={value} type="button" variant={activity === value ? 'primary-page' : 'on-dark-secondary'} size="sm" onClick={() => { setActivity(value); setSelected(null); }}>{RESPONSIBILITY_ACTIVITY_LABELS[value]}</Button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3"><ControlSearch value={search} onChange={setSearch} placeholder="Buscar grupo ou unidade" /><span className="text-xs text-white/80">{counts.covered} coberto(s) · {counts.attention} com atenção · {counts.gaps} pendente(s)</span></div>
    </ControlPanel>
    <p className="text-xs text-ds-ink-muted">A primeira linha da hierarquia que encontrar pessoas ativas, com a permissão da atividade e abrangência sobre todas as unidades do grupo, recebe a tarefa.</p>
    <ListShell minWidth={680}>
      {loading ? <ListSkeleton rows={5} /> : error ? <div className="space-y-2 p-5"><p role="alert" className="text-sm text-ds-danger">{error}</p><Button variant="ds-secondary" size="sm" onClick={() => void load()}>Tentar novamente</Button></div>
        : visible.length ? visible.map((row) => <LiftRow key={row.id} table selected={selected?.id === row.id} onClick={() => setSelected(row)} className="grid grid-cols-[minmax(0,1fr)_100px_170px] items-center gap-4">
          <div className="min-w-0"><p className="truncate text-sm font-extrabold text-ds-ink">{row.scopeName}</p><p className="text-xs text-ds-ink-muted">{row.unitCount} unidade(s) · {row.levels.length} nível(is)</p></div>
          <span className="text-xs font-semibold text-ds-ink-muted">{RESPONSIBILITY_ACTIVITY_LABELS[row.activity]}</span>
          <StatusPill variant={statusTones[row.status]}>{statusLabels[row.status]}</StatusPill>
        </LiftRow>) : <EmptyResults title="Nenhuma abrangência encontrada." onClear={() => setSearch('')} />}
    </ListShell>
    <SidePanel open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} kicker="Cobertura do DP" title={selected?.scopeName ?? 'Cobertura'} subtitle={selected ? RESPONSIBILITY_ACTIVITY_LABELS[selected.activity] : undefined}>
      {selected ? <>
        <PanelSection title="Situação">
          <PanelField label="Cobertura"><StatusPill variant={statusTones[selected.status]}>{statusLabels[selected.status]}</StatusPill></PanelField>
          <PanelField label="Diagnóstico">{diagnosticText(selected)}</PanelField>
          {selected.eligibleUserIds.length ? <PanelField label="Pessoas aptas">{selected.eligibleUserIds.map((uid) => peopleById.get(uid) ?? 'Pessoa ativa').join(', ')}</PanelField> : null}
        </PanelSection>
        {selected.diagnostics.length ? <PanelSection title="Conferência por nível">
          {selected.diagnostics.map((item) => <div key={item.level} className="rounded-ds-md border border-ds-divider p-3 text-xs">
            <p className="font-extrabold text-ds-ink">Nível {item.level + 1}{item.fallbackUsed ? ' · cargo alternativo usado' : ''}</p>
            <p className="mt-1 text-ds-ink-muted">{item.eligibleCount} apta(s) · {item.missingPermissionCount} sem permissão · {item.missingScopeCount} sem abrangência · {item.inactiveCount} inativa(s)</p>
          </div>)}
        </PanelSection> : null}
        {canManage ? <PanelSection title="Hierarquia configurada">
          <ResponsibilityLevelsEditor levels={levels} onChange={setLevels}
            roles={roles.filter((item) => item.isActive !== false)} functions={functions.filter((item) => item.isActive !== false)}
            people={activeUsers.filter((person) => person.isActive !== false)} labelPrefix={`${selected.activity}-${selected.scope.id}`} />
          {saveError ? <p role="alert" className="text-xs text-ds-danger">{saveError}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-ds-divider pt-3">
            {selected.state !== 'active' ? <Button variant="ds-secondary" disabled={saving} onClick={() => void save('draft')}>Salvar rascunho</Button> : null}
            <Button variant="primary-modal" loading={saving} disabled={!validLevels(levels)} onClick={() => void save('active')}>{selected.state === 'active' ? 'Salvar cobertura ativa' : 'Ativar cobertura'}</Button>
          </div>
        </PanelSection> : <p className="text-xs text-ds-ink-muted">Você pode consultar o diagnóstico, mas não possui permissão para alterar a hierarquia.</p>}
      </> : null}
    </SidePanel>
  </div>;
}
