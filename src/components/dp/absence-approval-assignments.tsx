"use client";

import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { Field, fieldInputClass } from '@/components/patterns/field';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import type { DPAbsenceApprovalLevel, DPAbsencePolicy } from '@/types';

type Assignments = NonNullable<DPAbsencePolicy['approvalAssignments']>;
type Stage = keyof Assignments;
type Option = { id: string; name: string };

function LevelSelect({ value, onChange, children, label }: { value: string; onChange: (value: string) => void; children: ReactNode; label: string }) {
  return <Field label={label}><div className="relative"><select aria-label={label} className={`${fieldInputClass} appearance-none pr-10`} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" /></div></Field>;
}

export function ResponsibilityLevelsEditor({ levels, onChange, roles, functions, people, labelPrefix = 'Responsabilidade' }: {
  levels: DPAbsenceApprovalLevel[];
  onChange: (levels: DPAbsenceApprovalLevel[]) => void;
  roles: Option[];
  functions: Option[];
  people: Array<{ id: string; username: string }>;
  labelPrefix?: string;
}) {
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-ds-ink">Hierarquia</p><Button type="button" variant="ds-secondary" size="xs" disabled={levels.length >= 20} onClick={() => onChange([...levels, { kind: 'people', personIds: [] }])}>Adicionar nível</Button></div>
    {levels.length === 0 ? <p className="text-xs text-ds-ink-muted">Nenhum nível configurado.</p> : null}
    {levels.map((level, index) => {
      const patch = (next: DPAbsenceApprovalLevel) => onChange(levels.map((entry, entryIndex) => entryIndex === index ? next : entry));
      return <div key={`${labelPrefix}-${index}`} className="space-y-3 rounded-ds-md border border-ds-border bg-ds-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-ds-ink">Nível {index + 1}</p><div className="flex gap-1"><Button type="button" variant="ds-secondary" size="xs" disabled={index === 0} onClick={() => { const copy = [...levels]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; onChange(copy); }}>Subir</Button><Button type="button" variant="ds-secondary" size="xs" disabled={index === levels.length - 1} onClick={() => { const copy = [...levels]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; onChange(copy); }}>Descer</Button><Button type="button" variant="danger-link" size="xs" onClick={() => onChange(levels.filter((_, entryIndex) => entryIndex !== index))}>Remover</Button></div></div>
        <LevelSelect label={`Origem dos responsáveis · ${labelPrefix} · nível ${index + 1}`} value={level.kind} onChange={(kind) => patch(kind === 'function' ? { kind: 'function', functionId: '' } : kind === 'role' ? { kind: 'role', jobRoleId: '' } : { kind: 'people', personIds: [] })}>
          <option value="people">Pessoas</option><option value="function">Função</option><option value="role">Cargo</option>
        </LevelSelect>
        {level.kind === 'people' ? <Field label="Pessoas responsáveis"><MultiSelect options={people.map((person) => ({ value: person.id, label: person.username }))} selected={level.personIds} onChange={(personIds) => { if (personIds.length <= 20) patch({ kind: 'people', personIds }); }} placeholder="Selecione até 20 pessoas" /></Field> : null}
        {level.kind === 'function' ? <><LevelSelect label="Função responsável" value={level.functionId} onChange={(functionId) => patch({ ...level, functionId })}><option value="">Selecione</option>{functions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</LevelSelect><LevelSelect label="Cargo alternativo (opcional)" value={level.fallbackJobRoleId ?? ''} onChange={(fallbackJobRoleId) => patch({ ...level, fallbackJobRoleId: fallbackJobRoleId || undefined })}><option value="">Nenhum</option>{roles.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</LevelSelect></> : null}
        {level.kind === 'role' ? <LevelSelect label="Cargo responsável" value={level.jobRoleId} onChange={(jobRoleId) => patch({ kind: 'role', jobRoleId })}><option value="">Selecione</option>{roles.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</LevelSelect> : null}
      </div>;
    })}
  </div>;
}

export function AbsenceApprovalAssignments({ value, onChange, roles, functions, people, attachment }: {
  value: DPAbsencePolicy['approvalAssignments'];
  onChange: (value: DPAbsencePolicy['approvalAssignments']) => void;
  roles: Option[];
  functions: Option[];
  people: Array<{ id: string; username: string }>;
  attachment: DPAbsencePolicy['attachment'];
}) {
  const current = value ?? {};
  const update = (stage: Stage, levels: DPAbsenceApprovalLevel[]) => onChange({ ...current, [stage]: levels.length ? levels : undefined });
  return <div className="space-y-4 rounded-ds-card border border-ds-divider bg-ds-warm p-3">
    <div><p className="text-xs font-extrabold text-ds-ink">Responsáveis por etapa</p><p className="mt-1 text-xs text-ds-ink-muted">A ordem define a busca: o primeiro nível com pessoas elegíveis recebe a etapa. Cada pessoa precisa ter permissão de analisar solicitações.</p></div>
    {attachment === 'required' ? <p className="rounded-ds-md border border-ds-warn/20 bg-ds-warn-bg p-2 text-xs text-ds-warn">Pedidos com documento exigem responsável de DP configurado, inclusive com aprovação automática ou apenas pelo gestor.</p> : null}
    {(['manager', 'dp'] as const).map((stage) => {
      const levels = current[stage] ?? [];
      return <div key={stage} className="space-y-3 border-t border-ds-divider pt-3">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-ds-ink">{stage === 'manager' ? 'Gestor' : 'Departamento Pessoal'}</p><Button type="button" variant="ds-secondary" size="xs" disabled={levels.length >= 20} onClick={() => update(stage, [...levels, { kind: 'people', personIds: [] }])}>Adicionar nível</Button></div>
        {stage === 'manager' && !levels.length ? <p className="text-xs text-ds-ink-muted">Sem níveis configurados, o sistema tentará o gestor direto vigente.</p> : null}
        <ResponsibilityLevelsEditor levels={levels} onChange={(next) => update(stage, next)} roles={roles} functions={functions} people={people} labelPrefix={stage} />
      </div>;
    })}
  </div>;
}
