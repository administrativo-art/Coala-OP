"use client";

import { ChevronDown } from 'lucide-react';

import { TimeConfigurationNotice } from '@/components/dp/dp-time-config-fields';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { PanelField, PanelSection } from '@/components/patterns/side-panel';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { breakToleranceFor, LEGAL_INTRAJORNADA_DEFAULT, LEGAL_TOLERANCE_DEFAULTS, TOLERANCE_CEILING } from '@/features/dp/time-config/policy-rules';
import { RULE_ORIGIN_LABELS, type PolicyRulesForm } from '@/features/dp/time-config/policy-rules-form';
import { cn } from '@/lib/utils';
import type { DPOvertimePolicy, DPPolicyRuleSource } from '@/types';

function SourceFields({ idPrefix, value, onChange }: { idPrefix: string; value: PolicyRulesForm['toleranceSource']; onChange: (value: PolicyRulesForm['toleranceSource']) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Origem da regra" htmlFor={`${idPrefix}-origin`}>
        <div className="relative">
          <select id={`${idPrefix}-origin`} className={cn(fieldInputClass, 'appearance-none pr-10')} value={value.origin}
            onChange={(event) => onChange({ ...value, origin: event.target.value as DPPolicyRuleSource['origin'] })}>
            {Object.entries(RULE_ORIGIN_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
        </div>
      </Field>
      <Field label="Cláusula ou referência" htmlFor={`${idPrefix}-reference`} requirement="opcional">
        <Input id={`${idPrefix}-reference`} className={fieldInputClass} maxLength={240} value={value.reference} onChange={(event) => onChange({ ...value, reference: event.target.value })} />
      </Field>
    </div>
  );
}

export function PolicyRulesFields({ value, onChange }: { value: PolicyRulesForm; onChange: (value: PolicyRulesForm) => void }) {
  const set = (patch: Partial<PolicyRulesForm>) => onChange({ ...value, ...patch });
  const minutes = (id: string, label: string, field: 'markingMinutes' | 'dailyMinutes' | 'upTo15' | 'upTo30' | 'upTo60', max: number, hint: string) => (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="number" min={0} max={max} step={1} className={fieldInputClass} value={value[field]} onChange={(event) => set({ [field]: event.target.value })} />
    </Field>
  );
  const example45 = breakToleranceFor(45, { breakMinutes: { upTo15: Number(value.upTo15) || 0, upTo30: Number(value.upTo30) || 0, upTo60: Number(value.upTo60) || 0 } });
  return (
    <>
      <PanelSection title="Tolerâncias">
        <label className="flex items-center justify-between gap-3 text-[13px] font-bold text-ds-ink-2"><span>Definir as tolerâncias nesta política</span><Switch aria-label="Definir tolerâncias na política" checked={value.tolerancesEnabled} onCheckedChange={(tolerancesEnabled) => set({ tolerancesEnabled })} /></label>
        {value.tolerancesEnabled ? (
          <div className="space-y-3">
            <p className="text-xs text-ds-ink-muted">Entrada e saída da jornada. Substitui a tolerância cadastrada na jornada. Atraso ou saída antecipada dentro de 5 min por marcação e 10 no dia nunca é descontado, mesmo com valor menor aqui.</p>
            <div className="grid grid-cols-2 gap-3">
              {minutes('policy-tolerance-marking', 'Por marcação (min)', 'markingMinutes', TOLERANCE_CEILING.markingMinutes, `Até ${TOLERANCE_CEILING.markingMinutes}.`)}
              {minutes('policy-tolerance-daily', 'Limite no dia (min)', 'dailyMinutes', TOLERANCE_CEILING.dailyMinutes, `Soma de entrada e saída. Até ${TOLERANCE_CEILING.dailyMinutes}.`)}
            </div>
            <p className="text-xs text-ds-ink-muted">Intervalo: um só total, somando o que faltou na saída e na volta.</p>
            <div className="grid grid-cols-3 gap-3">
              {minutes('policy-tolerance-15', 'Intervalo de 15 min', 'upTo15', TOLERANCE_CEILING.upTo15, `Até ${TOLERANCE_CEILING.upTo15}.`)}
              {minutes('policy-tolerance-30', 'Intervalo de 30 min', 'upTo30', TOLERANCE_CEILING.upTo30, `Até ${TOLERANCE_CEILING.upTo30}.`)}
              {minutes('policy-tolerance-60', 'Intervalo de 60 min', 'upTo60', TOLERANCE_CEILING.upTo60, `Até ${TOLERANCE_CEILING.upTo60}.`)}
            </div>
            <p className="text-xs text-ds-ink-muted">Outros tamanhos usam a proporção do valor de 60 min, arredondada para baixo. Um intervalo de 45 min tolera {example45} min.</p>
            <SourceFields idPrefix="policy-tolerance" value={value.toleranceSource} onChange={(toleranceSource) => set({ toleranceSource })} />
          </div>
        ) : <p className="text-xs text-ds-ink-muted">Desligado: entrada e saída usam a tolerância da jornada, e o intervalo não tem tolerância. Os campos já vêm preenchidos ({LEGAL_TOLERANCE_DEFAULTS.markingMinutes} e {LEGAL_TOLERANCE_DEFAULTS.dailyMinutes} min); só valem depois de ligar.</p>}
      </PanelSection>

      <PanelSection title="Hora extra intrajornada">
        <label className="flex items-center justify-between gap-3 text-[13px] font-bold text-ds-ink-2"><span>Pagar o intervalo suprimido</span><Switch aria-label="Pagar o intervalo suprimido" checked={value.tolerancesEnabled && value.intrajornadaEnabled} disabled={!value.tolerancesEnabled} onCheckedChange={(intrajornadaEnabled) => set({ intrajornadaEnabled })} /></label>
        {value.tolerancesEnabled && value.intrajornadaEnabled ? (
          <div className="space-y-3">
            <p className="text-xs text-ds-ink-muted">Passou da tolerância do intervalo, paga todo o tempo suprimido. É indenizatória, vai para a folha e nunca para o banco.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código na folha" htmlFor="policy-intrajornada-code"><Input id="policy-intrajornada-code" className={`${fieldInputClass} font-ds-mono`} maxLength={40} value={value.intrajornadaCode} onChange={(event) => set({ intrajornadaCode: event.target.value })} /></Field>
              <Field label="Adicional (%)" htmlFor="policy-intrajornada-rate" hint={`Mínimo de ${LEGAL_INTRAJORNADA_DEFAULT.ratePercent}%.`}><Input id="policy-intrajornada-rate" type="number" min={LEGAL_INTRAJORNADA_DEFAULT.ratePercent} step="0.01" className={fieldInputClass} value={value.intrajornadaRate} onChange={(event) => set({ intrajornadaRate: event.target.value })} /></Field>
            </div>
            <SourceFields idPrefix="policy-intrajornada" value={value.intrajornadaSource} onChange={(intrajornadaSource) => set({ intrajornadaSource })} />
            <TimeConfigurationNotice>Atenção: a entrega ao contador ainda não leva esta parcela, e um mês com intervalo a pagar fica bloqueado nela. Dia sem pausa, pausas divididas, turno de 6h estendido, intervalo reduzido, turno manual ou noturno vão para decisão do DP.</TimeConfigurationNotice>
          </div>
        ) : null}
      </PanelSection>
    </>
  );
}

export function PolicyRulesView({ policy }: { policy: Pick<DPOvertimePolicy, 'tolerances' | 'intrajornada'> }) {
  const { tolerances, intrajornada } = policy;
  const origin = (source: DPPolicyRuleSource) => `${RULE_ORIGIN_LABELS[source.origin]}${source.reference ? ` · ${source.reference}` : ''}`;
  return (
    <PanelSection title="Tolerâncias e intervalo">
      {tolerances ? (
        <div className="grid grid-cols-2 gap-4">
          <PanelField label="Entrada e saída">{`${tolerances.markingMinutes} min por marcação · ${tolerances.dailyMinutes} no dia`}</PanelField>
          <PanelField label="Intervalo de 15 / 30 / 60 min">{`${tolerances.breakMinutes.upTo15} / ${tolerances.breakMinutes.upTo30} / ${tolerances.breakMinutes.upTo60} min`}</PanelField>
          <PanelField label="Origem das tolerâncias">{origin(tolerances.source)}</PanelField>
          <PanelField label="Intrajornada">{intrajornada ? `${intrajornada.code} · +${intrajornada.ratePercent}% · ${origin(intrajornada.source)}` : 'Não apurada'}</PanelField>
        </div>
      ) : <p className="text-xs text-ds-ink-muted">Esta política não define tolerâncias: vale a tolerância da jornada.</p>}
    </PanelSection>
  );
}
