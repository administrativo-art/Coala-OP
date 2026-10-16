"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { formatRequestDate } from '@/features/hr/requests/request-ui';
import { actOnResponsibilityTask, fetchResponsibilityTasks } from './client';
import type { DPResponsibilityTask, User } from '@/types';

const statusLabel: Record<DPResponsibilityTask['status'], string> = {
  unassigned: 'Sem responsável', pending: 'Aguardando aceite', claimed: 'Em ajuste', resolved: 'Concluída',
};

export function ResponsibilityTaskSection({ firebaseUser, people, canManage = false, canWorkSchedules = false,
  canReceiveGaps = false, canResolveAny = false }: {
  firebaseUser: FirebaseUser | null;
  people: User[];
  canManage?: boolean;
  canWorkSchedules?: boolean;
  canReceiveGaps?: boolean;
  canResolveAny?: boolean;
}) {
  const [tasks, setTasks] = useState<DPResponsibilityTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.username])), [people]);
  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true); setError(null);
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
    } finally { setLoading(false); }
  }, [canManage, canReceiveGaps, canWorkSchedules, firebaseUser]);
  useEffect(() => { void load(); }, [load]);

  const act = async (task: DPResponsibilityTask, action: 'claim' | 'resolve') => {
    if (!firebaseUser || busyId) return;
    setBusyId(task.id); setError(null);
    try {
      await actOnResponsibilityTask(firebaseUser, task.id, action === 'claim'
        ? { action, expectedVersion: task.version, operationId: crypto.randomUUID() }
        : { action, expectedVersion: task.version, operationId: crypto.randomUUID(), note: noteById[task.id]?.trim() ?? '' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a pendência.');
    } finally { setBusyId(null); }
  };

  return <section className="space-y-3 rounded-ds-card-lg border border-ds-border bg-ds-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-extrabold text-ds-ink">Ajustes de escala por ausência</h2>
        <p className="text-xs text-ds-ink-muted">O turno anterior foi retirado da escala. A pendência indica quem precisa recompor a cobertura.</p></div>
      <Button variant="ds-secondary" size="sm" onClick={() => void load()} disabled={loading}>Atualizar</Button>
    </div>
    {error ? <p role="alert" className="text-xs font-bold text-ds-danger">{error}</p> : null}
    {loading ? <p className="text-xs text-ds-ink-muted">Carregando pendências…</p> : !tasks.length
      ? <p className="rounded-ds-md bg-ds-muted p-3 text-xs text-ds-ink-muted">Nenhum ajuste de escala pendente.</p>
      : <div className="space-y-2">{tasks.map((task) => {
        const canClaim = task.status === 'pending' && task.assignedUserIds.includes(firebaseUser?.uid ?? '');
        const canResolve = (task.status === 'claimed' && task.claimedByUid === firebaseUser?.uid)
          || (canResolveAny && task.status === 'pending');
        const title = task.kind === 'absence_cancellation_review' ? 'Revisar escala após cancelamento' : 'Recompor escala após ausência';
        return <article key={task.id} className="rounded-ds-md border border-ds-divider p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-sm font-extrabold text-ds-ink">{title}</p>
              <p className="text-xs text-ds-ink-muted">{peopleById.get(task.beneficiaryUid) ?? 'Colaborador'} · {formatRequestDate(task.startDate)} a {formatRequestDate(task.endDate)} · {task.displacedShiftCount} turno(s)</p></div>
            <StatusPill variant={task.status === 'unassigned' ? 'danger' : task.status === 'claimed' ? 'info' : 'warn'}>{statusLabel[task.status]}</StatusPill>
          </div>
          {task.status === 'unassigned' ? <p className="mt-2 text-xs font-bold text-ds-danger">Configure uma cobertura válida em Configurações → Pessoal → Responsabilidades.</p> : null}
          {canClaim ? <div className="mt-3 flex justify-end"><Button size="sm" variant="primary-page" loading={busyId === task.id} onClick={() => void act(task, 'claim')}>Assumir ajuste</Button></div> : null}
          {canResolve ? <div className="mt-3 space-y-2"><Textarea value={noteById[task.id] ?? ''} onChange={(event) => setNoteById((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="Descreva como a escala foi ajustada." maxLength={1000} />
            <div className="flex justify-end"><Button size="sm" variant="primary-page" loading={busyId === task.id} disabled={(noteById[task.id]?.trim().length ?? 0) < 10} onClick={() => void act(task, 'resolve')}>Concluir ajuste</Button></div></div> : null}
        </article>;
      })}</div>}
  </section>;
}
