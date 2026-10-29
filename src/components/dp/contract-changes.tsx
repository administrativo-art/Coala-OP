'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import { Button } from '@/components/ui/button';
import { operationalCivilDate } from '@/lib/operational-unit-periods';
import { formatCivilDateBR } from '@/features/dp/employment-reference/presentation';
import type { DPUnit } from '@/types';

type ContractChange = {
  id: string; createdAt: string | null; actorName: string; effectiveDate: string | null;
  reason: string | null; source: string;
  status?: 'applied' | 'scheduled' | 'cancelled' | 'conflict';
  changes: Record<string, { before: unknown; after: unknown }>;
  activationIssue?: string;
  cancellation?: { reason: string | null; actorName: string | null; createdAt: string | null };
};
const labels: Record<string, string> = {
  contractStage: 'Situação do contrato',
  profileId: 'Perfil de acesso derivado do cargo e das funções',
  employmentRelationshipType: 'Tipo de vínculo', admissionDate: 'Data de admissão',
  employerUnitId: 'Unidade empregadora', employerCnpj: 'CNPJ do empregador',
  employerUnitName: 'Empregador', unitId: 'Unidade financeira', jobRoleId: 'Cargo',
  jobRoleName: 'Cargo', jobFunctionIds: 'Funções', jobFunctionNames: 'Funções',
  probationStartDate: 'Início da experiência', probationFirstEndDate: 'Fim do 1º período de experiência',
  probationFinalEndDate: 'Fim da experiência', indefiniteStartDate: 'Início do prazo indeterminado',
};
function displayValue(value: unknown, field: string, units: DPUnit[]): string {
  if (value == null || value === '') return 'Não informado';
  if (Array.isArray(value)) return value.map((item) => displayValue(item, field, units)).join(', ') || 'Nenhuma';
  if (field === 'unitId' || field === 'employerUnitId') return units.find((unit) => unit.id === value)?.name ?? String(value);
  if (field === 'employmentRelationshipType') return ({ clt: 'CLT', apprenticeship: 'Aprendizagem', pj: 'Pessoa jurídica', internship: 'Estágio', partner: 'Sócio(a)' } as Record<string, string>)[String(value)] ?? String(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return formatCivilDateBR(value.slice(0, 10));
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number };
    const seconds = timestamp.seconds ?? timestamp._seconds;
    return typeof seconds === 'number' ? formatCivilDateBR(new Date(seconds * 1000).toISOString().slice(0, 10)) : 'Valor registrado';
  }
  return String(value);
}

export function ContractChanges({ userId, units }: { userId: string; units: DPUnit[] }) {
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const allowed = isDefaultAdmin || permissions.settings.manageUsers;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState<ContractChange[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [savingCancel, setSavingCancel] = useState(false);
  if (!allowed) return null;
  async function load() {
    if (!firebaseUser) return;
    setLoading(true); setError(null);
    try {
      const result = await authenticatedApiRequest<{ changes: ContractChange[]; truncated?: boolean }>(`/api/users/${encodeURIComponent(userId)}/contract-changes`, {
        getIdToken: () => firebaseUser.getIdToken(), fallbackError: 'Não foi possível carregar as alterações contratuais.',
      });
      setChanges(result.changes);
      setTruncated(Boolean(result.truncated));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as alterações.'); }
    finally { setLoading(false); }
  }
  async function cancelChange() {
    if (!firebaseUser || !cancellingId || savingCancel || cancelReason.trim().length < 5) return;
    setSavingCancel(true); setError(null);
    try {
      await authenticatedApiRequest(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH', getIdToken: () => firebaseUser.getIdToken(),
        json: { cancelContractChangeId: cancellingId, contractChangeReason: cancelReason.trim() },
        fallbackError: 'Não foi possível cancelar o agendamento.',
      });
      setCancellingId(null); setCancelReason(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar o agendamento.'); }
    finally { setSavingCancel(false); }
  }
  return <div className="border-t border-ds-divider p-3">
    <Button type="button" variant="ds-ghost" size="sm" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }}>{open ? 'Recolher alterações' : 'Ver alterações'}</Button>
    {open && <div className="mt-2 space-y-2">
      {loading ? <p role="status" className="text-sm text-ds-ink-muted">Carregando alterações…</p> : error ? <div role="alert" className="space-y-2 text-sm text-ds-danger"><p>{error}</p><Button type="button" variant="ds-secondary" size="sm" onClick={() => void load()}>Tentar novamente</Button></div> : changes?.length ? changes.map((entry) => <article key={entry.id} className="rounded-ds-md border border-ds-border bg-ds-page p-3 text-xs">
        <p className="font-extrabold">{entry.createdAt ? new Date(entry.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Belem' }) : 'Data do registro não informada'} · {entry.source === 'system' || entry.source === 'automatic' ? 'Sistema' : entry.actorName || 'Responsável não informado'}</p>
        <p className="mt-1 text-ds-ink-muted">{entry.effectiveDate ? `${entry.effectiveDate > operationalCivilDate() ? 'Agendada para' : 'Válida a partir de'} ${formatCivilDateBR(entry.effectiveDate)}` : 'Data efetiva não registrada'}</p>
        {entry.status === 'cancelled' ? <p className="mt-1 font-bold">Agendamento cancelado</p> : entry.status === 'conflict' ? <p className="mt-1 font-bold text-ds-danger">Aplicação pendente de conferência</p> : null}
        <dl className="mt-2 space-y-2">{Object.entries(entry.changes).filter(([field]) => !(field === 'jobRoleId' && entry.changes.jobRoleName) && !(field === 'jobFunctionIds' && entry.changes.jobFunctionNames)).map(([field, value]) => <div key={field}><dt className="font-bold">{labels[field] ?? field}</dt><dd className="mt-0.5 break-words"><span className="text-ds-ink-muted">{displayValue(value.before, field, units)}</span> → <span>{displayValue(value.after, field, units)}</span></dd></div>)}</dl>
        <p className="mt-2"><strong>Justificativa:</strong> {entry.reason || 'Não registrada'}</p>
        {entry.activationIssue ? <p className="mt-2 text-ds-danger">{entry.activationIssue}</p> : null}
        {entry.cancellation ? <p className="mt-2"><strong>Cancelamento:</strong> {entry.cancellation.reason || 'Motivo não registrado'} · {entry.cancellation.actorName || 'Responsável não informado'}{entry.cancellation.createdAt ? ` · ${new Date(entry.cancellation.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Belem' })}` : ''}</p> : null}
        {(entry.status === 'scheduled' || entry.status === 'conflict') ? cancellingId === entry.id ? <div className="mt-3 space-y-2"><label className="grid gap-1 font-semibold">Justificativa do cancelamento<textarea value={cancelReason} minLength={5} maxLength={500} disabled={savingCancel} onChange={(event) => setCancelReason(event.target.value)} className="min-h-16 rounded-ds-sm border border-ds-border bg-ds-input p-2" /></label><div className="flex gap-2"><Button type="button" variant="ds-secondary" size="sm" disabled={savingCancel || cancelReason.trim().length < 5} onClick={() => void cancelChange()}>Confirmar cancelamento</Button><Button type="button" variant="ds-ghost" size="sm" disabled={savingCancel} onClick={() => { setCancellingId(null); setCancelReason(''); }}>Voltar</Button></div></div> : <Button type="button" className="mt-2" variant="ds-secondary" size="sm" onClick={() => { setCancellingId(entry.id); setCancelReason(''); }}>Cancelar agendamento</Button> : null}
      </article>) : <p className="text-sm text-ds-ink-muted">Nenhuma alteração contratual registrada.</p>}
      {truncated && !loading && !error ? <p className="text-xs text-ds-ink-muted">Exibindo as 50 alterações mais recentes. Registros anteriores continuam preservados na trilha de auditoria.</p> : null}
    </div>}
  </div>;
}
