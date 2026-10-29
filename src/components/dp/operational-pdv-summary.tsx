'use client';

import { useState } from 'react';

import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { FormControl, FormItem, FormLabel } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { kioskIdsForOperationalUnits } from '@/lib/collaborator-operational-selection';
import { listPdvAccesses } from '@/features/hr/lib/pdv-operational-unit-sync';
import type { DPUnit, Kiosk, User } from '@/types';

const names = (ids: string[], items: { id: string; name: string }[]) =>
  ids.map((id) => items.find((item) => item.id === id)?.name ?? id).join(', ');

/** Quiosques atribuídos são derivados da vigência; aqui só se mostra o resultado. */
export function OperationalKioskSummary({ hasPeriods, unitIds, legacyKioskIds, kiosks, units }: {
  hasPeriods: boolean;
  unitIds: string[];
  legacyKioskIds: string[];
  kiosks: Kiosk[];
  units: DPUnit[];
}) {
  if (!hasPeriods) {
    return (
      <p className="rounded-ds-md border border-ds-border bg-ds-muted px-3 py-2 text-xs leading-5 text-ds-ink-muted">
        Quiosques atribuídos no cadastro antigo: <b className="text-ds-ink">{legacyKioskIds.length ? names(legacyKioskIds, kiosks) : 'nenhum'}</b>.
        Ao definir a primeira vigência, eles passam a seguir as unidades dela.
      </p>
    );
  }
  const derived = kioskIdsForOperationalUnits(unitIds, kiosks, units);
  const changes = derived.length !== legacyKioskIds.length || derived.some((id) => !legacyKioskIds.includes(id));
  return (
    <p className="text-xs leading-5 text-ds-ink-muted">
      Quiosques atribuídos (automático): <b className="text-ds-ink">{derived.length ? names(derived, kiosks) : 'nenhum'}</b>.
      {changes ? ` Ao salvar, substitui o valor anterior (${legacyKioskIds.length ? names(legacyKioskIds, kiosks) : 'nenhum'}).` : ''}
    </p>
  );
}

/**
 * Switch "Acesso ao PDV": com Sim, as unidades da vigência com filial do PDV
 * recebem acesso e acompanham as mudanças; desligar remove os acessos ao salvar.
 */
export function PdvAccessControl({ enabled, onChange, user, unitIds, units }: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  user: User;
  unitIds: string[];
  units: DPUnit[];
}) {
  const [confirmingOff, setConfirmingOff] = useState(false);
  const active = listPdvAccesses(user as unknown as Record<string, unknown>).filter((access) => access.status === 'active');
  const unitRows = unitIds.map((id) => {
    const unit = units.find((item) => item.id === id);
    const access = active.find((item) => item.unitId === id);
    const status = !unit?.pdvFilialId ? 'sem PDV' : access ? `ID ${access.externalUserId}` : enabled ? 'sem acesso' : '—';
    return { id, name: unit?.name ?? id, status, missing: Boolean(unit?.pdvFilialId && !access && enabled) };
  });

  return (
    <FormItem className="space-y-3 rounded-ds-md border border-ds-border bg-ds-input p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <FormLabel className="text-[13px] font-extrabold text-ds-ink">Acesso ao PDV</FormLabel>
          <p className="mt-0.5 text-xs leading-5 text-ds-ink-muted">
            {enabled
              ? 'Sim: cada quiosque da vigência tem acesso; ao mudar a vigência, o PDV muda junto.'
              : 'Não: a pessoa não tem cadastro no PDV.'}
          </p>
        </div>
        <FormControl>
          <Switch
            checked={enabled}
            onCheckedChange={(value) => {
              if (!value && active.length > 0) { setConfirmingOff(true); return; }
              onChange(value);
            }}
          />
        </FormControl>
      </div>
      {confirmingOff ? (
        <InlineConfirm
          message={`Ao salvar, remove ${active.length === 1 ? 'o acesso' : `os ${active.length} acessos`} no PDV Legal (ID ${active.map((access) => access.externalUserId).join(', ')}). As vendas antigas continuam ligadas à pessoa.`}
          confirmLabel="Remover ao salvar"
          onConfirm={() => { setConfirmingOff(false); onChange(false); }}
          onCancel={() => setConfirmingOff(false)}
        />
      ) : null}
      {unitRows.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Acesso ao PDV por unidade da vigência">
          {unitRows.map((row) => (
            <li key={row.id} className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-surface px-2.5 py-1 text-xs font-semibold text-ds-ink">
              {row.name}
              <span className={row.missing ? 'font-bold text-ds-warn' : 'font-bold text-ds-ink-muted'}>{row.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {enabled && active.length === 0 ? (
        <p className="text-xs leading-5 text-ds-ink-muted">
          Ainda não há acesso no PDV. O primeiro acesso é criado na admissão; depois disso as unidades com PDV acompanham a vigência.
        </p>
      ) : null}
      {enabled && active.length > 0 && unitRows.some((row) => row.missing) ? (
        <p className="text-xs leading-5 text-ds-warn">
          Unidade com PDV sem acesso: a sincronia só age nas unidades que mudam. Confira na ficha do colaborador, em Acesso ao PDV.
        </p>
      ) : null}
      {user.operationalFollowUpError ? (
        <p role="status" className="text-xs leading-5 text-ds-danger">
          A sincronização automática da última vigência não concluiu ({user.operationalFollowUpError}). Confira os acessos na ficha do colaborador.
        </p>
      ) : null}
    </FormItem>
  );
}
