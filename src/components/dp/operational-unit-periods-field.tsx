'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import type { DPUnit } from '@/types';
import { appendOperationalPeriod, operationalCivilDate, type OperationalUnitPeriod } from '@/lib/operational-unit-periods';
import { formatCivilDateBR } from '@/features/dp/employment-reference/presentation';

export function OperationalUnitPeriodsField({ periods, units, initialUnitIds = [], onChange, onValidityChange }: {
  periods: OperationalUnitPeriod[];
  units: DPUnit[];
  initialUnitIds?: string[];
  onChange: (periods: OperationalUnitPeriod[] | undefined) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [start, setStart] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const today = operationalCivilDate();
  const current = periods.find((period) => period.validFrom <= today && (!period.validTo || period.validTo >= today));
  const names = (ids: string[]) => ids.map((id) => units.find((unit) => unit.id === id)?.name ?? id).join(' · ');
  function preview(date: string, ids: string[]) {
    setStart(date); setSelected(ids);
    try {
      if (periods.length && date < today) throw new Error('Para uma nova definição, escolha hoje ou uma data futura.');
      const next = appendOperationalPeriod(periods, date, ids);
      setError(''); onChange(next); onValidityChange(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Confira a vigência.');
      onChange(undefined); onValidityChange(false);
    }
  }
  function cancel() {
    setEditing(false); setError(''); onChange(undefined); onValidityChange(true);
  }
  return <div className="space-y-3 rounded-ds-md border border-ds-border p-3">
    <div className="flex items-center gap-2"><p className="text-sm font-bold">Unidades de operação e escala</p><InfoPopover title="Unidades de operação e escala"><p>Unidades habituais de trabalho por período. Uma nova vigência fecha a anterior na véspera, mantendo o histórico. Cobertura em outra unidade é registrada no turno específico, com motivo, sem alterar financeira ou empregador.</p></InfoPopover></div>
    {current ? <div className="text-sm"><p className="font-semibold">Vigência {periods.indexOf(current) + 1} · {formatCivilDateBR(current.validFrom)} até {current.validTo ? formatCivilDateBR(current.validTo) : 'indeterminado'}</p><p>{names(current.unitIds)}</p></div>
      : <p className="text-sm text-ds-ink-muted">{!periods.length && initialUnitIds.length ? `Unidades do cadastro atual: ${names(initialUnitIds)}. Confira a data inicial para registrar a primeira vigência.` : 'Sem vigência definida para hoje. Colaboradores sem atuação em escala ou ponto podem permanecer assim.'}</p>}
    {periods.filter((period) => period.validFrom > today).map((period) => <p key={period.validFrom} className="text-sm">Agendada · {formatCivilDateBR(period.validFrom)} · {names(period.unitIds)}</p>)}
    {!editing ? <Button type="button" variant="ds-secondary" size="sm" onClick={() => {
      setEditing(true);
      const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      preview(periods.length ? tomorrow.toISOString().slice(0, 10) : '', periods.at(-1)?.unitIds ?? initialUnitIds);
    }}>{periods.length ? 'Alterar unidades' : 'Definir primeira vigência'}</Button> : <div className="space-y-3 border-t border-ds-border pt-3">
      <label className="grid gap-1 text-sm font-semibold">Início da {periods.length ? 'nova vigência' : 'Vigência 1'}<input type="date" value={start} min={periods.length ? today : undefined} onChange={(event) => preview(event.target.value, selected)} className="rounded-ds-sm border border-ds-border bg-ds-input p-2" /></label>
      {!periods.length && <p className="text-xs text-ds-ink-muted">Confira desde quando estas unidades valem. A data inicial não será preenchida automaticamente.</p>}
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">Unidades habituais de trabalho</legend>{units.filter((unit) => !unit.isArchived || selected.includes(unit.id)).map((unit) => <label key={unit.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(unit.id)} onChange={(event) => preview(start, event.target.checked ? [...selected, unit.id] : selected.filter((id) => id !== unit.id))} />{unit.name}</label>)}</fieldset>
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : start && <p role="status" className="text-sm">Nova vigência a partir de {formatCivilDateBR(start)}, sem data final. {periods.at(-1) && !periods.at(-1)?.validTo ? 'A anterior será encerrada no dia precedente.' : ''} Confirme em Salvar alterações.</p>}
      <Button type="button" variant="ds-ghost" size="sm" onClick={cancel}>Descartar nova vigência</Button>
    </div>}
    {periods.length > 0 && <><button type="button" className="text-sm font-semibold underline" aria-expanded={history} onClick={() => setHistory(!history)}>{history ? 'Recolher histórico' : 'Ver histórico'}</button>{history && <ol className="space-y-2">{periods.map((period, index) => <li key={period.validFrom} className="rounded-ds-sm bg-ds-page p-2 text-sm"><p className="font-semibold">Vigência {index + 1} · {formatCivilDateBR(period.validFrom)} até {period.validTo ? formatCivilDateBR(period.validTo) : 'indeterminado'}</p><p>{names(period.unitIds)}</p></li>)}</ol>}</>}
  </div>;
}
