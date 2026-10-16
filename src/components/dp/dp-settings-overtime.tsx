"use client";

import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { useDP } from '@/components/dp-context';
import { DPTimeApplicabilityFields, TimeConfigurationNotice } from '@/components/dp/dp-time-config-fields';
import { ControlPanel, ControlSearch } from '@/components/patterns/control-panel';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { FilterChips } from '@/components/patterns/filter-chips';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useDPTimeConfigs } from '@/hooks/use-dp-time-config';
import { useHrBootstrap } from '@/hooks/use-hr-bootstrap';
import {
  applicabilityLabel,
  externalCoverageRuleLabel,
  formatValidityBR,
  formatDuration,
  parseDuration,
  timeConfigStatusLabel,
} from '@/lib/dp-time-config-ui';
import { activeOperationalUnits } from '@/lib/dp-units';
import { filterTimeConfigsByListStatus, timeConfigListCounts, type DPTimeConfigListStatus } from '@/lib/dp-time-config-status';
import { resolveUnitAccess } from '@/lib/unit-access';
import { cn } from '@/lib/utils';
import type { DPOvertimeCategory, DPOvertimePolicy, DPTimeApplicability } from '@/types';

const ROW_TEMPLATE = 'minmax(230px,1.4fr) minmax(170px,1fr) 130px 150px 16px';
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function OvertimeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select {...props} className={cn(fieldInputClass, 'appearance-none pr-10', className)}>{children}</select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
    </div>
  );
}

type CategoryForm = Omit<DPOvertimeCategory, 'ratePercent' | 'bankCreditFactor'> & {
  ratePercent: string;
  bankCreditFactor: string;
};

type OvertimeForm = {
  name: string;
  description: string;
  collectiveAgreementReference: string;
  applicability: DPTimeApplicability;
  validFrom: string;
  validTo: string;
  dailyToleranceMinutes: string;
  dailyOvertimeLimit: string;
  weeklyOvertimeLimit: string;
  categories: CategoryForm[];
  timeBank: {
    enabled: boolean;
    allowNegativeBalance: boolean;
    positiveLimit: string;
    negativeLimit: string;
    expirationDays: string;
    expiredBalanceDestination: 'payroll' | 'forfeit' | 'review';
  };
  externalCoverageRule: DPOvertimePolicy['externalCoverageRule'];
};

type PanelState =
  | { mode: 'view'; item: DPOvertimePolicy }
  | { mode: 'edit'; item: DPOvertimePolicy }
  | { mode: 'create'; supersedes?: DPOvertimePolicy };

function defaultCategory(index = 0): CategoryForm {
  return {
    id: index === 0 ? 'hora-extra-50' : `faixa-${index + 1}`,
    name: index === 0 ? 'Hora extra 50%' : `Nova faixa ${index + 1}`,
    trigger: 'workday',
    ratePercent: index === 0 ? '50' : '0',
    destination: 'payroll',
    bankCreditFactor: '',
    requiresApproval: true,
  };
}

function formFor(item?: DPOvertimePolicy): OvertimeForm {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    collectiveAgreementReference: item?.collectiveAgreementReference ?? '',
    applicability: item?.applicability ?? { scope: { kind: 'company' } },
    validFrom: item?.validFrom ?? new Date().toISOString().slice(0, 10),
    validTo: item?.validTo ?? '',
    dailyToleranceMinutes: String(item?.dailyToleranceMinutes ?? 10),
    dailyOvertimeLimit: item?.dailyOvertimeLimitMinutes ? formatDuration(item.dailyOvertimeLimitMinutes) : '',
    weeklyOvertimeLimit: item?.weeklyOvertimeLimitMinutes ? formatDuration(item.weeklyOvertimeLimitMinutes) : '',
    categories: item?.categories.map((category) => ({
      ...category,
      ratePercent: String(category.ratePercent),
      bankCreditFactor: category.bankCreditFactor == null ? '' : String(category.bankCreditFactor),
    })) ?? [defaultCategory()],
    timeBank: {
      enabled: item?.timeBank.enabled ?? false,
      allowNegativeBalance: item?.timeBank.allowNegativeBalance ?? false,
      positiveLimit: item?.timeBank.positiveLimitMinutes ? formatDuration(item.timeBank.positiveLimitMinutes) : '',
      negativeLimit: item?.timeBank.negativeLimitMinutes ? formatDuration(item.timeBank.negativeLimitMinutes) : '',
      expirationDays: item?.timeBank.expirationDays == null ? '' : String(item.timeBank.expirationDays),
      expiredBalanceDestination: item?.timeBank.expiredBalanceDestination ?? 'review',
    },
    externalCoverageRule: item?.externalCoverageRule ?? 'origin',
  };
}

function statusVariant(status: DPOvertimePolicy['status']) {
  if (status === 'published') return 'ok' as const;
  if (status === 'archived') return 'neutral' as const;
  return 'warn' as const;
}

function optionalDuration(value: string, label: string) {
  if (!value.trim()) return undefined;
  const minutes = parseDuration(value);
  if (!minutes) throw new Error(`${label} deve usar HH:MM e ser maior que zero.`);
  return minutes;
}

function buildPayload(form: OvertimeForm) {
  if (form.name.trim().length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  if (!form.validFrom) throw new Error('Informe o início da vigência.');
  if (form.validTo && form.validTo < form.validFrom) throw new Error('O fim da vigência deve ser posterior ao início.');
  if (form.applicability.scope.kind !== 'company' && !form.applicability.scope.id) throw new Error('Selecione a abrangência da política.');
  const dailyToleranceMinutes = Number(form.dailyToleranceMinutes);
  if (!Number.isInteger(dailyToleranceMinutes) || dailyToleranceMinutes < 0 || dailyToleranceMinutes > 180) throw new Error('A tolerância diária deve ficar entre 0 e 180 minutos.');
  if (form.categories.length === 0) throw new Error('Cadastre ao menos uma faixa de hora extra.');
  if (new Set(form.categories.map((category) => category.id.trim())).size !== form.categories.length) throw new Error('Os códigos das faixas precisam ser únicos.');

  const categories: DPOvertimeCategory[] = form.categories.map((category, index) => {
    const ratePercent = Number(category.ratePercent);
    const bankCreditFactor = category.bankCreditFactor ? Number(category.bankCreditFactor) : undefined;
    if (!category.id.trim() || !category.name.trim()) throw new Error(`Preencha código e nome da faixa ${index + 1}.`);
    if (!Number.isFinite(ratePercent) || ratePercent < 0) throw new Error(`Revise o percentual da faixa ${index + 1}.`);
    if (category.trigger === 'specific_weekdays' && !category.weekdays?.length) throw new Error(`Selecione ao menos um dia da semana na faixa ${index + 1}.`);
    if (category.destination === 'time_bank' && (!bankCreditFactor || bankCreditFactor <= 0)) throw new Error(`Informe o fator de crédito da faixa ${index + 1}.`);
    return {
      id: category.id.trim(),
      name: category.name.trim(),
      trigger: category.trigger,
      ...(category.trigger === 'specific_weekdays' ? { weekdays: Array.from(new Set(category.weekdays)).sort() } : {}),
      ratePercent,
      destination: category.destination,
      ...(category.destination === 'time_bank' ? { bankCreditFactor } : {}),
      requiresApproval: category.requiresApproval,
    };
  });
  if (!form.timeBank.enabled && categories.some((category) => category.destination === 'time_bank')) throw new Error('Ative o banco de horas para usar uma faixa com esse destino.');

  const positiveLimitMinutes = optionalDuration(form.timeBank.positiveLimit, 'O limite positivo');
  const negativeLimitMinutes = optionalDuration(form.timeBank.negativeLimit, 'O limite negativo');
  const expirationDays = form.timeBank.expirationDays ? Number(form.timeBank.expirationDays) : undefined;
  if (expirationDays !== undefined && (!Number.isInteger(expirationDays) || expirationDays <= 0)) throw new Error('A validade do banco deve ser informada em dias inteiros.');

  return {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.collectiveAgreementReference.trim() ? { collectiveAgreementReference: form.collectiveAgreementReference.trim() } : {}),
    applicability: form.applicability,
    validFrom: form.validFrom,
    ...(form.validTo ? { validTo: form.validTo } : {}),
    dailyToleranceMinutes,
    ...(optionalDuration(form.dailyOvertimeLimit, 'O limite de hora extra por dia') ? { dailyOvertimeLimitMinutes: optionalDuration(form.dailyOvertimeLimit, 'O limite de hora extra por dia') } : {}),
    ...(optionalDuration(form.weeklyOvertimeLimit, 'O limite de hora extra por semana') ? { weeklyOvertimeLimitMinutes: optionalDuration(form.weeklyOvertimeLimit, 'O limite de hora extra por semana') } : {}),
    categories,
    timeBank: {
      enabled: form.timeBank.enabled,
      allowNegativeBalance: form.timeBank.allowNegativeBalance,
      ...(positiveLimitMinutes ? { positiveLimitMinutes } : {}),
      ...(negativeLimitMinutes ? { negativeLimitMinutes } : {}),
      ...(expirationDays ? { expirationDays } : {}),
      expiredBalanceDestination: form.timeBank.expiredBalanceDestination,
    },
    externalCoverageRule: form.externalCoverageRule,
  };
}

const triggerLabels: Record<DPOvertimeCategory['trigger'], string> = {
  workday: 'Dias comuns (exceto domingos e feriados)',
  specific_weekdays: 'Dias específicos da semana',
  rest_day: 'Trabalho em dia de descanso',
  sunday: 'Trabalho no domingo',
  holiday: 'Trabalho em feriado',
  unplanned_work: 'Trabalho fora da escala',
};

const destinationLabels: Record<DPOvertimeCategory['destination'], string> = {
  payroll: 'Folha',
  time_bank: 'Banco de horas',
  review: 'Revisão manual',
};

export function DPSettingsOvertime() {
  const { permissions, isDefaultAdmin, activeUsers, user } = useAuth();
  const canManage = Boolean(
    (isDefaultAdmin || permissions.dp?.settings?.manageTime === true)
    && user
    && resolveUnitAccess(user, { isDefaultAdmin }).allUnits
  );
  const { units, unitGroups, unitOrganizations } = useDP();
  const { roles, functions } = useHrBootstrap();
  const { items, loading, error, reload, create, update } = useDPTimeConfigs('overtime-policies', canManage);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [form, setForm] = useState<OvertimeForm>(() => formFor());
  const [search, setSearch] = useState('');
  const [listStatus, setListStatus] = useState<DPTimeConfigListStatus>('active');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);

  const editing = panel?.mode === 'edit' || panel?.mode === 'create';
  const item = panel && panel.mode !== 'create' ? panel.item : panel?.supersedes ?? null;

  useEffect(() => {
    setSaveError(null);
    setConfirmingArchive(false);
    if (panel?.mode === 'edit') setForm(formFor(panel.item));
    if (panel?.mode === 'create') {
      const nextForm = formFor(panel.supersedes);
      setForm(panel.supersedes ? { ...nextForm, validFrom: '', validTo: '' } : nextForm);
    }
  }, [panel]);

  const unitNames = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const groupNames = useMemo(() => new Map(unitGroups.map((group) => [group.id, group.name])), [unitGroups]);
  const organizationNames = useMemo(() => new Map(unitOrganizations.map((organization) => [organization.id, organization.name])), [unitOrganizations]);
  const listCounts = useMemo(() => timeConfigListCounts(items), [items]);
  const statusItems = useMemo(() => filterTimeConfigsByListStatus(items, listStatus), [items, listStatus]);
  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return statusItems;
    return statusItems.filter((entry) => `${entry.name} ${entry.description ?? ''} ${entry.collectiveAgreementReference ?? ''} ${applicabilityLabel(entry.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}`.toLocaleLowerCase('pt-BR').includes(term));
  }, [groupNames, organizationNames, search, statusItems, unitNames]);

  function updateCategory(index: number, patch: Partial<CategoryForm>) {
    setForm((current) => ({ ...current, categories: current.categories.map((category, categoryIndex) => categoryIndex === index ? { ...category, ...patch } : category) }));
  }

  async function savePolicy() {
    setSaveError(null);
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (panel?.mode === 'edit') {
        const updated = await update(panel.item.id, {
          action: 'update',
          data: {
            ...payload,
            description: form.description.trim() || null,
            collectiveAgreementReference: form.collectiveAgreementReference.trim() || null,
            validTo: form.validTo || null,
            dailyOvertimeLimitMinutes: optionalDuration(form.dailyOvertimeLimit, 'O limite de hora extra por dia') ?? null,
            weeklyOvertimeLimitMinutes: optionalDuration(form.weeklyOvertimeLimit, 'O limite de hora extra por semana') ?? null,
          },
        });
        setPanel({ mode: 'view', item: updated });
      } else if (panel?.mode === 'create') {
        const created = await create({ ...payload, ...(panel.supersedes ? { supersedesId: panel.supersedes.id } : {}) });
        setPanel({ mode: 'view', item: created });
      }
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : 'Não foi possível salvar a política.');
    } finally {
      setSaving(false);
    }
  }

  async function transition(action: 'publish' | 'archive') {
    if (!item) return;
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await update(item.id, { action });
      setPanel({ mode: 'view', item: updated });
      if (action === 'archive') setListStatus('archived');
    } catch (transitionError) {
      setSaveError(transitionError instanceof Error ? transitionError.message : 'Não foi possível alterar a situação da política.');
    } finally {
      setSaving(false);
      setConfirmingArchive(false);
    }
  }

  if (!canManage) return <p role="alert" className="text-sm font-semibold text-ds-danger">Você não tem permissão para gerenciar hora extra.</p>;
  if (loading && items.length === 0) return <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando políticas de hora extra"><ListSkeleton rows={4} /></div>;
  if (error && items.length === 0) {
    return <div className="space-y-3" role="alert"><p className="text-sm font-semibold text-ds-danger">Erro ao carregar políticas: {error}</p><Button type="button" variant="ds-secondary" size="sm" onClick={() => void reload()}>Tentar novamente</Button></div>;
  }

  return (
    <div className="space-y-5">
      <TimeConfigurationNotice>
        <span className="inline-flex items-center gap-2">
          Esta fase configura critérios, destinos e vigência. Ela ainda não calcula ponto, quantidade oficial de horas nem valores financeiros.
          <InfoTooltip title="O que esta configuração faz agora">
            <p>Registra as regras que serão usadas futuramente para interpretar as batidas trazidas do Bizneo.</p>
            <p>Publicar uma política não lança folha, banco de horas ou pagamento.</p>
          </InfoTooltip>
        </span>
      </TimeConfigurationNotice>

      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px] shadow-none ring-1 ring-white/10">
        <div>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Critérios de apuração</p>
          <p className="mt-1 font-ds-mono text-[44px] font-bold leading-none tracking-tighter">{statusItems.length}</p>
          <p className="mt-1 text-base font-extrabold">Políticas de hora extra</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar política, CCT ou abrangência" />
          <Button type="button" variant="primary-page" size="xl" onClick={() => setPanel({ mode: 'create' })}>+ Nova política</Button>
        </div>
        <FilterChips
          includeAll={false}
          value={listStatus}
          onChange={(value) => setListStatus(value === 'archived' ? 'archived' : 'active')}
          chips={[
            { value: 'active', label: 'Ativas', count: listCounts.active },
            { value: 'archived', label: 'Arquivadas', count: listCounts.archived },
          ]}
        />
      </ControlPanel>

      <div className="flex items-baseline gap-2.5"><span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleItems.length}</span><span className="text-[13px] text-ds-ink-faint">de {statusItems.length} políticas {listStatus === 'active' ? 'ativas' : 'arquivadas'}</span></div>
      <ListShell minWidth={820}>
        <ListHead template={ROW_TEMPLATE}><span>Política</span><span>Abrangência</span><span>Faixas</span><span>Situação</span><span /></ListHead>
        {visibleItems.map((entry) => (
          <ListRow key={entry.id} template={ROW_TEMPLATE} isOpen={item?.id === entry.id} isSelected={false} isMuted={entry.status === 'archived'} onOpen={() => setPanel({ mode: 'view', item: entry })} label={`Abrir política ${entry.name}`}>
            <div className="min-w-0"><p className="truncate text-[13.5px] font-bold">{entry.name}</p><p className="truncate text-xs text-ds-ink-muted">Versão {entry.version} · tolerância {entry.dailyToleranceMinutes} min</p></div>
            <span className="truncate text-xs text-ds-ink-muted">{applicabilityLabel(entry.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}</span>
            <span className="font-ds-mono text-[13px] font-semibold">{entry.categories.length}</span>
            <StatusPill variant={statusVariant(entry.status)}>{timeConfigStatusLabel(entry.status)}</StatusPill>
            <Chevron />
          </ListRow>
        ))}
        {items.length === 0 ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma política cadastrada. Crie a primeira como rascunho.</p> : visibleItems.length === 0 ? <EmptyResults title={statusItems.length === 0 ? `Nenhuma política ${listStatus === 'active' ? 'ativa' : 'arquivada'}.` : 'Nenhuma política encontrada com essa busca.'} onClear={() => setSearch('')} /> : null}
      </ListShell>

      <SidePanel open={!!panel} onOpenChange={(open) => { if (!open) setPanel(null); }} kicker={panel?.mode === 'create' ? (panel.supersedes ? 'Nova versão' : 'Nova política') : panel?.mode === 'edit' ? 'Editar política' : `Hora extra · v${item?.version ?? 1}`} title={editing ? (form.name || 'Sem nome') : (item?.name ?? '')} subtitle="Abrangência, vigência, tolerância geral, faixas e banco de horas.">
        {panel && !editing && item ? (
          <>
            <PanelSection title="Aplicação">
              <PanelField label="Abrangência">{applicabilityLabel(item.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}</PanelField>
              <PanelField label="Vigência">{formatValidityBR(item.validFrom, item.validTo)}</PanelField>
              <PanelField label="Cobertura externa">{externalCoverageRuleLabel(item.externalCoverageRule)}</PanelField>
              {item.collectiveAgreementReference ? <PanelField label="Referência coletiva">{item.collectiveAgreementReference}</PanelField> : null}
            </PanelSection>
            <PanelSection title="Limites">
              <div className="grid grid-cols-2 gap-4">
                <PanelField label="Tolerância geral">{item.dailyToleranceMinutes} min</PanelField>
                <PanelField label="Limite de hora extra por dia">{formatDuration(item.dailyOvertimeLimitMinutes)}</PanelField>
                <PanelField label="Limite de hora extra por semana">{formatDuration(item.weeklyOvertimeLimitMinutes)}</PanelField>
                <PanelField label="Banco de horas">{item.timeBank.enabled ? 'Ativo' : 'Desativado'}</PanelField>
              </div>
            </PanelSection>
            <PanelSection title="Faixas" aside={`${item.categories.length}`}>
              {item.categories.map((category) => (
                <div key={category.id} className="rounded-ds-md border border-ds-divider px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2"><p className="text-[13px] font-bold">{category.name}</p><StatusPill variant="info">+{category.ratePercent}%</StatusPill></div>
                  <p className="mt-1 text-xs text-ds-ink-muted">
                    {triggerLabels[category.trigger]}
                    {category.trigger === 'specific_weekdays' && category.weekdays?.length ? ` (${category.weekdays.map((day) => WEEKDAY_LABELS[day]).join(', ')})` : ''}
                    {' · '}{destinationLabels[category.destination]}
                  </p>
                </div>
              ))}
            </PanelSection>
            <TimeConfigurationNotice>Somente configuração: nenhuma hora ou valor é calculado ao publicar.</TimeConfigurationNotice>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {item.status === 'draft' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="ds-secondary" size="md" onClick={() => setPanel({ mode: 'edit', item })}>Editar rascunho</Button>
                  <Button type="button" variant="primary-modal" size="md" loading={saving} onClick={() => void transition('publish')}>Publicar política</Button>
                </div>
              ) : item.status === 'published' ? (
                <>
                  <TimeConfigurationNotice>Uma regra publicada não pode ser editada. Duplique como nova versão para preservar o histórico da CCT.</TimeConfigurationNotice>
                  <Button type="button" variant="primary-modal" size="md" onClick={() => setPanel({ mode: 'create', supersedes: item })}>Duplicar como nova versão</Button>
                  {confirmingArchive
                    ? <InlineConfirm message={`Arquivar a regra “${item.name}”?`} loading={saving} returnFocusRef={archiveTriggerRef} onCancel={() => setConfirmingArchive(false)} onConfirm={() => void transition('archive')} />
                    : <Button ref={archiveTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingArchive(true)}>Arquivar regra</Button>}
                </>
              ) : (
                <Button type="button" variant="ds-secondary" size="md" onClick={() => setPanel({ mode: 'create', supersedes: item })}>Duplicar como nova versão</Button>
              )}
            </div>
          </>
        ) : null}

        {panel && editing ? (
          <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void savePolicy(); }} noValidate>
            <Field label="Nome" htmlFor="overtime-name"><Input id="overtime-name" className={fieldInputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: CCT São Luís 2026" /></Field>
            <Field label="Descrição" htmlFor="overtime-description" requirement="opcional"><textarea id="overtime-description" className={`${fieldInputClass} min-h-20 py-2`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
            <Field label="Referência da CCT ou acordo" htmlFor="overtime-agreement" requirement="opcional" hint="Referência informativa. O sistema não interpreta o documento automaticamente."><Input id="overtime-agreement" className={fieldInputClass} value={form.collectiveAgreementReference} onChange={(event) => setForm((current) => ({ ...current, collectiveAgreementReference: event.target.value }))} placeholder="Ex.: CCT 2026 · cláusula 12" /></Field>
            <PanelSection title="Abrangência"><DPTimeApplicabilityFields value={form.applicability} onChange={(applicability) => setForm((current) => ({ ...current, applicability }))} units={activeOperationalUnits(units)} unitOrganizations={activeOperationalUnits(unitOrganizations)} unitGroups={unitGroups} roles={roles} functions={functions} people={activeUsers} /></PanelSection>
            <PanelSection title="Vigência e tolerância geral">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Início" htmlFor="overtime-valid-from"><Input id="overtime-valid-from" type="date" className={fieldInputClass} value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} /></Field>
                <Field label="Fim" htmlFor="overtime-valid-to" requirement="opcional"><Input id="overtime-valid-to" type="date" className={fieldInputClass} value={form.validTo} onChange={(event) => setForm((current) => ({ ...current, validTo: event.target.value }))} /></Field>
                <Field label="Tolerância geral de hora extra" htmlFor="overtime-tolerance" hint="Margem diária única, em minutos, aplicada a todas as faixas desta política antes de começar a apurar hora extra. A regra só será aplicada quando o motor de ponto for ativado."><Input id="overtime-tolerance" type="number" min={0} max={180} className={fieldInputClass} value={form.dailyToleranceMinutes} onChange={(event) => setForm((current) => ({ ...current, dailyToleranceMinutes: event.target.value }))} /></Field>
                <Field label="Limite de hora extra por dia" htmlFor="overtime-daily-limit" requirement="opcional" hint="Máximo de horas extras reconhecidas automaticamente no dia. Não é o total da jornada. O excedente deverá seguir para revisão. Use HH:MM."><Input id="overtime-daily-limit" className={`${fieldInputClass} font-ds-mono`} value={form.dailyOvertimeLimit} onChange={(event) => setForm((current) => ({ ...current, dailyOvertimeLimit: event.target.value }))} placeholder="02:00" /></Field>
                <Field label="Limite de hora extra por semana" htmlFor="overtime-weekly-limit" requirement="opcional" hint="Máximo acumulado de horas extras reconhecidas automaticamente na semana. O excedente deverá seguir para revisão. Use HH:MM."><Input id="overtime-weekly-limit" className={`${fieldInputClass} font-ds-mono`} value={form.weeklyOvertimeLimit} onChange={(event) => setForm((current) => ({ ...current, weeklyOvertimeLimit: event.target.value }))} placeholder="10:00" /></Field>
              </div>
            </PanelSection>
            <PanelSection title="Faixas de hora extra" aside={`${form.categories.length}`}>
              <TimeConfigurationNotice>
                Todas as faixas usam a tolerância geral definida acima. Para uma CCT com 50% nos dias comuns, crie uma faixa geral e cadastre domingo e feriado em faixas separadas. Feriado é a condição mais específica e deve prevalecer na apuração futura.
              </TimeConfigurationNotice>
              <div className="space-y-3">
                {form.categories.map((category, index) => (
                  <div key={index} className="space-y-3 rounded-ds-btn-lg border border-ds-divider bg-ds-surface px-3 py-3">
                    <div className="flex items-center justify-between gap-2"><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Faixa {index + 1}</p>{form.categories.length > 1 ? <Button type="button" variant="danger-link" size="xs" onClick={() => setForm((current) => ({ ...current, categories: current.categories.filter((_, categoryIndex) => categoryIndex !== index) }))}><Trash2 className="mr-1 h-3.5 w-3.5" />Remover faixa</Button> : null}</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Código" htmlFor={`overtime-category-id-${index}`}><Input id={`overtime-category-id-${index}`} className={`${fieldInputClass} font-ds-mono`} value={category.id} onChange={(event) => updateCategory(index, { id: event.target.value })} /></Field>
                      <Field label="Nome" htmlFor={`overtime-category-name-${index}`}><Input id={`overtime-category-name-${index}`} className={fieldInputClass} value={category.name} onChange={(event) => updateCategory(index, { name: event.target.value })} /></Field>
                      <Field label="Quando aplicar" htmlFor={`overtime-category-trigger-${index}`} hint="Escolha uma situação por faixa. Para outra situação, crie outra faixa, mesmo quando percentual e destino forem iguais."><OvertimeSelect id={`overtime-category-trigger-${index}`} value={category.trigger} onChange={(event) => updateCategory(index, { trigger: event.target.value as DPOvertimeCategory['trigger'] })}>{Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OvertimeSelect></Field>
                      {category.trigger === 'specific_weekdays' ? (
                        <div className="col-span-2 space-y-2">
                          <p className="text-xs font-bold text-ds-ink-2">Dias da semana</p>
                          <div className="flex flex-wrap gap-2" role="group" aria-label={`Dias específicos da faixa ${index + 1}`}>
                            {WEEKDAY_LABELS.map((label, day) => {
                              const selected = category.weekdays?.includes(day) ?? false;
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => updateCategory(index, {
                                    weekdays: selected
                                      ? category.weekdays?.filter((currentDay) => currentDay !== day)
                                      : [...(category.weekdays ?? []), day].sort(),
                                  })}
                                  className={`h-9 min-w-12 rounded-ds-md px-3 text-xs font-bold transition-colors ${selected ? 'border-2 border-ds-modal bg-ds-modal-soft text-ds-modal-ink' : 'border border-ds-border-input bg-white text-ds-ink-2'}`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      <Field label="Percentual adicional" htmlFor={`overtime-category-rate-${index}`} hint="Ex.: 50% para uma hora extra com adicional de 50%.">
                        <div className="relative">
                          <Input id={`overtime-category-rate-${index}`} type="number" min={0} step="0.01" className={`${fieldInputClass} pr-10`} value={category.ratePercent} onChange={(event) => updateCategory(index, { ratePercent: event.target.value })} />
                          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-ds-ink-muted">%</span>
                        </div>
                      </Field>
                      <Field label="Destino" htmlFor={`overtime-category-destination-${index}`}><OvertimeSelect id={`overtime-category-destination-${index}`} value={category.destination} onChange={(event) => updateCategory(index, { destination: event.target.value as DPOvertimeCategory['destination'], bankCreditFactor: event.target.value === 'time_bank' ? (category.bankCreditFactor || '1') : '' })}>{Object.entries(destinationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OvertimeSelect></Field>
                      {category.destination === 'time_bank' ? <Field label="Fator de crédito" htmlFor={`overtime-category-factor-${index}`} hint="1,5 credita 1h30 para cada hora apurada."><Input id={`overtime-category-factor-${index}`} type="number" min={0.01} step="0.01" className={fieldInputClass} value={category.bankCreditFactor} onChange={(event) => updateCategory(index, { bankCreditFactor: event.target.value })} /></Field> : null}
                    </div>
                    <label className="flex items-center justify-between gap-3 text-xs font-bold text-ds-ink-2"><span>Exigir autorização antes do destino</span><Switch aria-label={`Exigir autorização na faixa ${index + 1}`} checked={category.requiresApproval} onCheckedChange={(requiresApproval) => updateCategory(index, { requiresApproval })} /></label>
                  </div>
                ))}
                <Button type="button" variant="ds-secondary" size="sm" onClick={() => setForm((current) => ({ ...current, categories: [...current.categories, defaultCategory(current.categories.length)] }))}><Plus className="mr-1.5 h-4 w-4" />Adicionar faixa</Button>
              </div>
            </PanelSection>
            <PanelSection title="Banco de horas">
              <label className="flex items-center justify-between gap-3 text-[13px] font-bold text-ds-ink-2"><span>Permitir destino para banco de horas</span><Switch aria-label="Ativar banco de horas" checked={form.timeBank.enabled} onCheckedChange={(enabled) => setForm((current) => ({ ...current, timeBank: { ...current.timeBank, enabled } }))} /></label>
              {form.timeBank.enabled ? <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 text-xs font-bold text-ds-ink-2"><span>Permitir saldo negativo</span><Switch aria-label="Permitir saldo negativo" checked={form.timeBank.allowNegativeBalance} onCheckedChange={(allowNegativeBalance) => setForm((current) => ({ ...current, timeBank: { ...current.timeBank, allowNegativeBalance } }))} /></label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Limite positivo" htmlFor="time-bank-positive" requirement="opcional" hint="Use HH:MM."><Input id="time-bank-positive" className={`${fieldInputClass} font-ds-mono`} value={form.timeBank.positiveLimit} onChange={(event) => setForm((current) => ({ ...current, timeBank: { ...current.timeBank, positiveLimit: event.target.value } }))} /></Field>
                  <Field label="Limite negativo" htmlFor="time-bank-negative" requirement="opcional" hint="Use HH:MM."><Input id="time-bank-negative" className={`${fieldInputClass} font-ds-mono`} value={form.timeBank.negativeLimit} onChange={(event) => setForm((current) => ({ ...current, timeBank: { ...current.timeBank, negativeLimit: event.target.value } }))} /></Field>
                  <Field label="Validade do saldo" htmlFor="time-bank-expiration" requirement="opcional" hint="Em dias."><Input id="time-bank-expiration" type="number" min={1} className={fieldInputClass} value={form.timeBank.expirationDays} onChange={(event) => setForm((current) => ({ ...current, timeBank: { ...current.timeBank, expirationDays: event.target.value } }))} /></Field>
                  <Field label="Destino ao vencer" htmlFor="time-bank-expired"><OvertimeSelect id="time-bank-expired" value={form.timeBank.expiredBalanceDestination} onChange={(event) => setForm((current) => ({ ...current, timeBank: { ...current.timeBank, expiredBalanceDestination: event.target.value as OvertimeForm['timeBank']['expiredBalanceDestination'] } }))}><option value="review">Revisão manual</option><option value="payroll">Folha</option><option value="forfeit">Descartar saldo</option></OvertimeSelect></Field>
                </div>
              </div> : <p className="text-xs text-ds-ink-muted">As faixas ficam disponíveis apenas para folha ou revisão manual.</p>}
            </PanelSection>
            <Field label="Cobertura em outra unidade" htmlFor="overtime-external-coverage" hint={<span className="inline-flex items-center gap-1.5">Define qual política considerar quando a pessoa cobre um turno fora da unidade de origem.<InfoTooltip title="Cobertura externa"><p>A cobertura não muda o vínculo da pessoa e não participa das metas da unidade de execução.</p><p>Escolha revisão manual quando a CCT aplicável depender de análise humana.</p></InfoTooltip></span>}>
              <OvertimeSelect id="overtime-external-coverage" value={form.externalCoverageRule} onChange={(event) => setForm((current) => ({ ...current, externalCoverageRule: event.target.value as DPOvertimePolicy['externalCoverageRule'] }))}><option value="origin">Usar regra da unidade de origem</option><option value="execution_unit">Usar regra da unidade de execução</option><option value="manual_review">Enviar para revisão manual</option></OvertimeSelect>
            </Field>
            <TimeConfigurationNotice>Salvar ou publicar não calcula ponto nem gera valor financeiro.</TimeConfigurationNotice>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4"><Button type="button" variant="ds-secondary" size="md" disabled={saving} onClick={() => item ? setPanel({ mode: 'view', item }) : setPanel(null)}>Cancelar</Button><Button type="submit" variant="primary-modal" size="md" loading={saving}>{panel.mode === 'edit' ? 'Salvar rascunho' : 'Criar rascunho'}</Button></div>
          </form>
        ) : null}
      </SidePanel>
    </div>
  );
}
