"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

import { ListShell } from '@/components/cadastros/cadastros-ui';
import { LiftRow } from '@/components/patterns/lift-row';
import { PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { AbsenceCoverageSection } from '@/features/dp/absences/coverage/coverage-section';
import { formatRequestDate } from '@/features/hr/requests/request-ui';
import { actOnResponsibilityTask, fetchResponsibilityTasks } from './client';
import type { DPResponsibilityTask, User } from '@/types';

const statusLabel: Record<DPResponsibilityTask['status'], string> = {
  unassigned: 'Sem responsável', pending: 'Aguardando aceite', claimed: 'Em ajuste', resolved: 'Concluída',
};

const isCoverage = (task: DPResponsibilityTask) => task.kind === 'absence_schedule_recomposition';

/**
 * Pendências de escala causadas por ausências. A recomposição após aprovação é resolvida pela etapa de cobertura;
 * a revisão após cancelamento continua com aceite e nota.
 */
export function ResponsibilityTaskSection({ firebaseUser, people, canManage = false, canWorkSchedules = false,
  canReceiveGaps = false, canResolveAny = false, onCountChange }: {
  firebaseUser: FirebaseUser | null;
  people: User[];
  canManage?: boolean;
  canWorkSchedules?: boolean;
  canReceiveGaps?: boolean;
  canResolveAny?: boolean;
  onCountChange?: (count: number | null) => void;
}) {
  const [tasks, setTasks] = useState<DPResponsibilityTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<DPResponsibilityTask | null>(null);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.username])), [people]);
  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setError(null);
    try {
      const responses = canManage
        ? [await fetchResponsibilityTasks(firebaseUser, { activity: 'schedules' })]
        : await Promise.all([
          ...(canWorkSchedules ? [fetchResponsibilityTasks(firebaseUser, { activity: 'schedules' })] : []),
          ...(canReceiveGaps ? [fetchResponsibilityTasks(firebaseUser, { activity: 'schedules', status: 'unassigned' })] : []),
        ]);
      setTasks([...new Map(responses.flatMap((response) => response.tasks).map((task) => [task.id, task])).values()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as pendências.');
      setTasks([]);
    }
  }, [canManage, canReceiveGaps, canWorkSchedules, firebaseUser]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onCountChange?.(tasks ? tasks.length : null); }, [onCountChange, tasks]);

  const act = async (task: DPResponsibilityTask, action: 'claim' | 'resolve') => {
    if (!firebaseUser || busyId) return;
    setBusyId(task.id); setError(null);
    try {
      await actOnResponsibilityTask(firebaseUser, task.id, action === 'claim'
        ? { action, expectedVersion: task.version, operationId: crypto.randomUUID() }
        : { action, expectedVersion: task.version, operationId: crypto.randomUUID(), note: noteById[task.id]?.trim() ?? '' });
      setSelected(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a pendência.');
    } finally { setBusyId(null); }
  };

  const name = (task: DPResponsibilityTask) => peopleById.get(task.beneficiaryUid) ?? 'Colaborador';
  const canClaim = (task: DPResponsibilityTask) => task.status === 'pending' && task.assignedUserIds.includes(firebaseUser?.uid ?? '');
  const canResolve = (task: DPResponsibilityTask) => (task.status === 'claimed' && task.claimedByUid === firebaseUser?.uid)
    || (canResolveAny && task.status === 'pending');

  return <section className="space-y-3">
    <div>
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Escala</p>
      <h2 className="text-lg font-extrabold text-ds-ink">Turnos sem cobertura</h2>
      <p className="text-xs text-ds-ink-muted">Turnos retirados da escala por ausência aprovada ou cancelada.</p>
    </div>
    {error ? <p role="alert" className="text-xs font-bold text-ds-danger">{error}</p> : null}
    <ListShell minWidth={580}>
      {tasks === null ? <p className="p-6 text-center text-sm text-ds-ink-muted">Carregando pendências…</p>
        : tasks.length ? tasks.map((task) => <LiftRow key={task.id} table selected={selected?.id === task.id}
          onClick={() => setSelected(task)} className="flex items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold text-ds-ink">{name(task)}</span>
            <span className="block truncate text-sm font-semibold text-ds-ink">{isCoverage(task) ? 'Definir cobertura após ausência' : 'Revisar escala após cancelamento'}</span>
            <span className="block text-xs text-ds-ink-muted">{formatRequestDate(task.startDate)} a {formatRequestDate(task.endDate)} · {task.displacedShiftCount} turno(s)</span>
          </span>
          <StatusPill variant={task.status === 'unassigned' ? 'danger' : isCoverage(task) ? 'warn' : task.status === 'claimed' ? 'info' : 'warn'}>
            {task.status === 'unassigned' ? statusLabel.unassigned : isCoverage(task) ? 'Falta cobertura' : statusLabel[task.status]}
          </StatusPill>
        </LiftRow>)
          : <p className="p-6 text-center text-sm text-ds-ink-muted">Nenhum turno sem cobertura.</p>}
    </ListShell>

    <SidePanel open={Boolean(selected)} onOpenChange={(open) => { if (!open && !busyId) setSelected(null); }}
      kicker={selected && isCoverage(selected) ? 'Cobertura após ausência' : 'Escala após cancelamento'}
      title={selected ? name(selected) : 'Pendência'}
      subtitle={selected ? `${formatRequestDate(selected.startDate)} a ${formatRequestDate(selected.endDate)} · ${selected.displacedShiftCount} turno(s)` : undefined}>
      {selected ? <>
        {selected.status === 'unassigned' ? <p className="rounded-ds-md bg-ds-danger-bg p-3 text-xs font-bold text-ds-danger">Nenhum responsável configurado. Ajuste em Configurações → Pessoal → Responsabilidades.</p> : null}
        {isCoverage(selected)
          ? <AbsenceCoverageSection firebaseUser={firebaseUser} requestId={selected.requestId}
            onChanged={(view) => { if (view.shifts.every((shift) => shift.decision)) void load(); }} />
          : <PanelSection title="Revisão da escala">
            <p className="text-xs text-ds-ink-muted">A ausência foi cancelada depois de retirar turnos. Confira a escala e registre o que foi feito.</p>
            {canClaim(selected) ? <div className="flex justify-end"><Button size="md" variant="primary-modal" loading={busyId === selected.id} onClick={() => void act(selected, 'claim')}>Assumir revisão</Button></div> : null}
            {canResolve(selected) ? <div className="space-y-2">
              <Textarea value={noteById[selected.id] ?? ''} onChange={(event) => setNoteById((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Descreva como a escala foi ajustada." maxLength={1000} />
              <div className="flex justify-end"><Button size="md" variant="primary-modal" loading={busyId === selected.id} disabled={(noteById[selected.id]?.trim().length ?? 0) < 10} onClick={() => void act(selected, 'resolve')}>Concluir revisão</Button></div>
            </div> : null}
          </PanelSection>}
      </> : null}
    </SidePanel>
  </section>;
}
