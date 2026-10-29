import { resolveEmploymentRelationshipType } from '@/lib/hr/employment-relationship';
import type { User } from '@/types';
import { operationalCivilDate } from '@/lib/operational-unit-periods';

type ContractDraft = { employmentRelationshipType?: string; admissionDate?: string; employerUnitId?: string; unitId?: string; jobRoleId?: string; jobFunctionIds?: string[] };

export function contractFormChanged(user: User | null, values: ContractDraft, currentAdmissionDate: string) {
  if (!user) return false;
  return (resolveEmploymentRelationshipType(user.employmentRelationshipType, user.personRecordType) ?? '') !== (values.employmentRelationshipType ?? '')
    || currentAdmissionDate !== (values.admissionDate ?? '')
    || (user.employerUnitId ?? '') !== (values.employerUnitId ?? '')
    || (user.unitId ?? '') !== (values.unitId ?? '')
    || (user.jobRoleId ?? '') !== (values.jobRoleId ?? '')
    || JSON.stringify([...(user.jobFunctionIds ?? [])].sort()) !== JSON.stringify([...(values.jobFunctionIds ?? [])].sort());
}

export function ContractChangeForm({ reason, effectiveDate, onReasonChange, onEffectiveDateChange }: {
  reason: string; effectiveDate: string;
  onReasonChange: (value: string) => void; onEffectiveDateChange: (value: string) => void;
}) {
  return <div className="space-y-3 rounded-ds-md border border-ds-info/25 bg-ds-info-bg/40 p-3">
    <p className="text-sm font-bold">Registrar alteração contratual</p>
    <label className="grid gap-1 text-xs font-semibold">Válida a partir de
      <input type="date" value={effectiveDate} min={operationalCivilDate()} required onChange={(event) => onEffectiveDateChange(event.target.value)} className="rounded-ds-sm border border-ds-border bg-ds-input p-2 text-sm" />
    </label>
    <label className="grid gap-1 text-xs font-semibold">Justificativa da alteração
      <textarea value={reason} required minLength={5} maxLength={500} onChange={(event) => onReasonChange(event.target.value)} className="min-h-20 rounded-ds-sm border border-ds-border bg-ds-input p-2 text-sm" placeholder="Explique o motivo da alteração contratual." />
    </label>
    <p className="text-xs text-ds-ink-muted">Ao salvar, os valores anterior e novo, a justificativa, o responsável e a data ficarão no histórico. Uma data futura agenda a mudança.</p>
  </div>;
}
