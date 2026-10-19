"use client";

import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { useDP } from '@/components/dp-context';
import { AbsenceApprovalAssignments } from '@/components/dp/absence-approval-assignments';
import { DPTimeApplicabilityFields, TimeConfigurationNotice } from '@/components/dp/dp-time-config-fields';
import { ControlPanel, ControlSearch } from '@/components/patterns/control-panel';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useDPTimeConfigs } from '@/hooks/use-dp-time-config';
import { useHrBootstrap } from '@/hooks/use-hr-bootstrap';
import { resolveAbsencePolicy } from '@/lib/dp-absence-rules';
import { applicabilityLabel, formatValidityBR, timeConfigStatusLabel } from '@/lib/dp-time-config-ui';
import { resolveUnitAccess } from '@/lib/unit-access';
import { cn } from '@/lib/utils';
import type {
  DPAbsenceColor,
  DPAbsenceEmploymentRelationship,
  DPAbsenceInitiator,
  DPAbsencePolicy,
  DPAbsenceRequestUnit,
  DPAbsenceType,
  DPTimeApplicability,
} from '@/types';

const ROW_TEMPLATE = 'minmax(230px,1.5fr) minmax(160px,1fr) 130px 120px 16px';

function AbsenceSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select {...props} className={cn(fieldInputClass, 'appearance-none pr-10', className)}>{children}</select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
    </div>
  );
}

type PolicyForm = Omit<DPAbsencePolicy, 'maxUnitsPerRequest' | 'maxUnitsPerPeriod' | 'minimumNoticeDays' | 'maximumRetroactiveDays' | 'tacitApprovalDays'> & {
  /** "" = nunca aprova sozinho. */
  tacitApprovalDays: string;
  maxUnitsPerRequest: string;
  maxUnitsPerPeriod: string;
  minimumNoticeDays: string;
  maximumRetroactiveDays: string;
};

type AbsenceForm = Omit<DPAbsenceType, 'id' | 'lineageId' | 'version' | 'status' | 'policies' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'publishedAt' | 'publishedBy' | 'archivedAt' | 'archivedBy' | 'supersedesId'> & {
  description: string;
  validTo: string;
  policies: PolicyForm[];
};

type PanelState =
  | { mode: 'view'; item: DPAbsenceType }
  | { mode: 'edit'; item: DPAbsenceType }
  | { mode: 'create'; supersedes?: DPAbsenceType };

const relationshipLabels: Record<DPAbsenceEmploymentRelationship, string> = {
  clt: 'CLT',
  apprenticeship: 'Aprendiz',
  internship: 'Estágio',
};
const calculationLabels: Record<DPAbsencePolicy['calculation'], string> = {
  scheduled_workdays: 'Dias de trabalho previstos',
  calendar_days: 'Dias corridos',
  calendar_days_until_return: 'Dias corridos até o retorno',
};
const approvalLabels: Record<DPAbsencePolicy['approvalFlow'], string> = {
  automatic: 'Automática',
  manager: 'Gestor',
  dp: 'Departamento Pessoal',
  manager_then_dp: 'Gestor e depois DP',
};
const workdayEffectLabels: Record<DPAbsenceType['workdayEffect'], string> = {
  excused_absence: 'Ausência justificada',
  unexcused_absence: 'Ausência não justificada',
  worked_credit: 'Crédito como período trabalhado',
  time_bank_debit: 'Débito em banco de horas',
  manual_review: 'Revisão manual',
};
const colorClasses: Record<DPAbsenceColor, string> = {
  pink: 'bg-pink-500', red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-500', yellow: 'bg-yellow-400', green: 'bg-emerald-500', teal: 'bg-teal-500', cyan: 'bg-cyan-500', blue: 'bg-blue-500', indigo: 'bg-indigo-500', violet: 'bg-violet-500', slate: 'bg-slate-500',
};
const colorLabels: Record<DPAbsenceColor, string> = {
  pink: 'rosa', red: 'vermelho', orange: 'laranja', amber: 'âmbar', yellow: 'amarelo', green: 'verde', teal: 'verde-azulado', cyan: 'ciano', blue: 'azul', indigo: 'índigo', violet: 'violeta', slate: 'cinza',
};

type InstructionPolicy = Pick<DPAbsencePolicy,
  'employmentRelationshipTypes' | 'applicability' | 'calculation' | 'attachment'
  | 'approvalFlow' | 'allowFutureEdit' | 'allowFutureCancel'
> & {
  minimumNoticeDays?: number | string;
  maximumRetroactiveDays?: number | string;
};

function joinPortuguese(items: string[]) {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

function generateRequesterInstructions(
  config: Pick<AbsenceForm, 'name' | 'requestUnits' | 'workdayEffect' | 'blocksSchedule'>,
  policy: InstructionPolicy,
) {
  const typeName = config.name.trim().toLocaleLowerCase('pt-BR') || 'ausência';
  const relationships = joinPortuguese(policy.employmentRelationshipTypes.map((relationship) => ({
    clt: 'colaboradores CLT', apprenticeship: 'aprendizes', internship: 'estagiários',
  })[relationship]));
  const scope = policy.applicability.scope.kind === 'company'
    ? 'em toda a empresa'
    : 'dentro da abrangência definida nesta regra';
  const units = config.requestUnits.includes('day') && config.requestUnits.includes('hour')
    ? 'em dias ou horas'
    : config.requestUnits.includes('hour') ? 'em horas' : 'em dias';
  const calculation = policy.calculation === 'scheduled_workdays'
    ? 'Nas solicitações em dias, serão considerados somente os dias de trabalho previstos na escala.'
    : policy.calculation === 'calendar_days_until_return'
      ? 'Nas solicitações em dias, serão contados os dias corridos até a data de retorno informada.'
      : 'Nas solicitações em dias, o período será contado em dias corridos, incluindo sábados, domingos e feriados.';
  const minimumNoticeDays = Number(policy.minimumNoticeDays ?? 0);
  const maximumRetroactiveDays = Number(policy.maximumRetroactiveDays ?? 0);
  const notice = minimumNoticeDays > 0
    ? `Envie o pedido com pelo menos ${minimumNoticeDays} ${minimumNoticeDays === 1 ? 'dia' : 'dias'} de antecedência.`
    : 'Não há antecedência mínima para o envio.';
  const retroactive = maximumRetroactiveDays > 0
    ? `É permitido registrar uma ausência iniciada há, no máximo, ${maximumRetroactiveDays} ${maximumRetroactiveDays === 1 ? 'dia' : 'dias'}.`
    : 'Não é permitido registrar o pedido depois do início da ausência.';
  const attachment = policy.attachment === 'required'
    ? 'Anexe obrigatoriamente um documento legível antes de enviar.'
    : 'O envio de documento é opcional.';
  const approval = ({
    automatic: 'O pedido será validado automaticamente pelo sistema.',
    manager: 'O pedido será analisado pelo gestor direto.',
    dp: 'O pedido será analisado pelo Departamento Pessoal.',
    manager_then_dp: 'O pedido passará primeiro pelo gestor direto e depois pelo Departamento Pessoal.',
  } as const)[policy.approvalFlow];
  const effect = ({
    excused_absence: 'Após a aprovação, o período será tratado como ausência justificada.',
    unexcused_absence: 'Após a aprovação, o período será registrado como ausência não justificada.',
    worked_credit: 'Após a aprovação, o período será considerado como tempo trabalhado, sem gerar hora extra.',
    time_bank_debit: 'Após a aprovação, o período será debitado do banco de horas.',
    manual_review: 'Após a aprovação, o tratamento da jornada será definido pelo Departamento Pessoal.',
  } as const)[config.workdayEffect];
  const futureActions = [
    policy.allowFutureEdit ? 'editado' : null,
    policy.allowFutureCancel ? 'cancelado' : null,
  ].filter((value): value is string => Boolean(value));
  const lines = [
    `Registre a solicitação de ${typeName} ${units} e confira cuidadosamente o período informado.`,
    '',
    `• Esta regra vale para ${relationships} ${scope}.`,
    `• ${calculation}`,
    `• ${notice} ${retroactive}`,
    `• ${attachment}`,
    `• ${approval}`,
    `• ${effect}${config.blocksSchedule ? ' O período aprovado ficará bloqueado para novas alocações na escala.' : ''}`,
  ];
  if (futureActions.length) lines.push(`• Pedidos referentes a períodos futuros podem ser ${joinPortuguese(futureActions)}.`);
  lines.push('', 'A solicitação só produz efeito depois de concluído o fluxo de aprovação.');
  return lines.join('\n');
}

function DefinitionPeriodHelp() {
  return (
    <>
      <p><strong>Cor:</strong> identifica visualmente este tipo em listas e calendários; não altera a regra.</p>
      <p><strong>Início da vigência:</strong> primeiro dia em que esta versão poderá ser aplicada.</p>
      <p><strong>Fim:</strong> último dia da versão. Sem fim, ela permanece válida até ser substituída ou arquivada.</p>
    </>
  );
}

function RequestEffectHelp() {
  return (
    <>
      <p><strong>Unidade da solicitação:</strong> escolha <em>Dias</em>, <em>Horas</em> ou marque os dois. Com ambos ativos, o solicitante escolhe a unidade adequada em cada pedido.</p>
      <p><strong>Quem pode iniciar:</strong> Colaborador abre o próprio pedido; Gestor abre para sua equipe; DP abre administrativamente; Sistema permite uma automação identificada.</p>
      <div className="space-y-2">
        <p><strong>Efeito na jornada:</strong> define o tratamento do período aprovado na apuração de tempo. Não determina, sozinho, pagamento ou desconto em folha.</p>
        <ul className="list-disc space-y-1.5 pl-4">
          <li><strong>Ausência justificada:</strong> registra que a pessoa não trabalhou, mas classifica o período como justificado. Não credita trabalho nem debita banco de horas.</li>
          <li><strong>Ausência não justificada:</strong> mantém o tempo previsto como não cumprido e o classifica como falta não justificada para os fluxos posteriores de ponto e DP.</li>
          <li><strong>Crédito como período trabalhado:</strong> considera o período aprovado como cumprido na jornada, mesmo sem marcação de ponto. Não cria hora extra.</li>
          <li><strong>Débito em banco de horas:</strong> desconta do saldo a quantidade aprovada. Na solicitação futura, saldo insuficiente deverá impedir aplicação automática e exigir tratamento pelo DP.</li>
          <li><strong>Revisão manual:</strong> não aplica efeito automático; o DP deverá definir o tratamento antes de concluir a ocorrência.</li>
        </ul>
      </div>
      <p><strong>Absenteísmo:</strong> inclui ocorrências aprovadas deste tipo no indicador futuro.</p>
      <p><strong>Bloqueio da escala:</strong> impede nova alocação no período depois da aprovação. O cadastro, sozinho, ainda não altera a escala.</p>
    </>
  );
}

function RulesHelp() {
  return (
    <>
      <p><strong>Escopo:</strong> todas as regras desta aba pertencem exclusivamente ao tipo de ausência aberto. Elas não são compartilhadas com outros tipos.</p>
      <p><strong>Código e nome:</strong> identificam a regra dentro deste tipo de ausência.</p>
      <p><strong>Vínculos:</strong> limita a regra a CLT, Aprendiz e/ou Estágio. PJ não participa deste domínio.</p>
      <p><strong>Abrangência:</strong> parte de empresa, organização, grupo ou unidade e pode ser refinada por cargo, função e colaborador.</p>
      <p><strong>Contagem:</strong> usa dias de trabalho previstos, dias corridos ou dias corridos incluindo o retorno.</p>
      <p><strong>Fluxo de aprovação:</strong> Automática não cria etapa humana; Gestor ou DP cria uma etapa; Gestor → DP exige as duas decisões nessa ordem.</p>
      <p><strong>Limites:</strong> o máximo por solicitação vale para um pedido; o acumulado vale no mês ou ano selecionado.</p>
      <p><strong>Antecedência e retroatividade:</strong> controlam quantos dias antes ou depois do início o pedido pode ser enviado.</p>
      <p><strong>Anexo:</strong> define se um documento será obrigatório antes do envio.</p>
      <p><strong>Rejeição, edição e cancelamento:</strong> controlam a justificativa do aprovador e as mudanças em pedidos futuros.</p>
      <p><strong>Instruções:</strong> orientação mostrada ao solicitante antes de enviar.</p>
    </>
  );
}

function RuleAudienceHelp() {
  return (
    <>
      <p><strong>Código:</strong> identificador interno da regra dentro deste tipo. Use um código estável e sem duplicidade.</p>
      <p><strong>Nome:</strong> título operacional que o DP verá ao consultar a regra aplicada.</p>
      <p><strong>Vínculos:</strong> CLT, Aprendiz e Estágio podem ser combinados. PJ fica fora do domínio de ausência trabalhista.</p>
      <p><strong>Abrangência:</strong> Toda a empresa alcança todos; Organização, Grupo de unidades e Unidade específica reduzem o alcance.</p>
      <p><strong>Cargos, funções e pessoas:</strong> refinam a abrangência. Pessoa prevalece sobre função, função sobre cargo e cargo sobre a abrangência geral.</p>
    </>
  );
}

function RuleCountingApprovalHelp() {
  return (
    <>
      <p><strong>Contagem:</strong></p>
      <ul className="list-disc space-y-1.5 pl-4">
        <li><strong>Dias de trabalho previstos:</strong> conta somente os dias em que a pessoa deveria trabalhar conforme jornada e escala.</li>
        <li><strong>Dias corridos:</strong> conta todos os dias entre início e fim, inclusive folgas, domingos e feriados.</li>
        <li><strong>Dias corridos até o retorno:</strong> o solicitante informa a data de retorno; essa data não entra na ausência.</li>
      </ul>
      <p><strong>Fluxo de aprovação:</strong></p>
      <ul className="list-disc space-y-1.5 pl-4">
        <li><strong>Automática:</strong> aprova após as validações, sem decisão humana.</li>
        <li><strong>Gestor:</strong> exige decisão do gestor direto vigente.</li>
        <li><strong>Departamento Pessoal:</strong> envia diretamente para a fila do DP.</li>
        <li><strong>Gestor e depois DP:</strong> exige as duas aprovações nessa ordem. Sem gestor válido, o pedido fica bloqueado e sinalizado ao DP.</li>
      </ul>
    </>
  );
}

function RuleLimitsHelp() {
  return (
    <>
      <p><strong>Máximo por solicitação:</strong> teto de dias ou horas em um único pedido. Em branco, esta regra não define um teto por pedido.</p>
      <p><strong>Máximo acumulado:</strong> teto total permitido no período escolhido. Dias e horas são controlados separadamente e não são somados entre si.</p>
      <p><strong>Período do limite:</strong> reinicia o acumulado a cada mês ou a cada ano.</p>
      <p><strong>Antecedência mínima:</strong> quantidade de dias corridos entre o envio e o início. Zero permite solicitar no próprio dia.</p>
      <p><strong>Retroativo permitido:</strong> quantidade de dias corridos após o início em que o pedido ainda pode ser enviado. Zero impede pedido retroativo.</p>
      <p><strong>Anexo:</strong> Obrigatório bloqueia o envio sem documento; Não obrigatório permite enviar sem arquivo.</p>
    </>
  );
}

function RuleRequestControlsHelp() {
  return (
    <>
      <p><strong>Exigir motivo ao rejeitar:</strong> o aprovador precisa registrar uma justificativa antes de rejeitar.</p>
      <p><strong>Permitir editar pedido futuro:</strong> autoriza correções antes do início, sem reabrir automaticamente pedidos já concluídos.</p>
      <p><strong>Permitir cancelar pedido futuro:</strong> autoriza cancelamento antes do início; a ação continua registrada na trilha.</p>
      <p><strong>Instruções ao solicitante:</strong> orientação exibida antes do envio, como documento aceito, prazo ou procedimento interno.</p>
    </>
  );
}

function RuleSectionHeader({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{label}</p>
      <InfoPopover title={title}>{children}</InfoPopover>
    </div>
  );
}

function ApprovalFlowPreview({ flow }: { flow: DPAbsencePolicy['approvalFlow'] }) {
  const steps = flow === 'automatic'
    ? ['Validações do sistema', 'Aprovação automática']
    : flow === 'manager'
      ? ['Gestor direto']
      : flow === 'dp'
        ? ['Departamento Pessoal']
        : ['Gestor direto', 'Departamento Pessoal'];
  return (
    <div className="col-span-2 rounded-ds-md border border-ds-divider bg-ds-input px-3 py-3">
      <div className="flex flex-wrap items-center gap-2" aria-label="Ordem de aprovação">
        {steps.map((step, index) => (
          <div key={step} className="contents">
            {index > 0 ? <span aria-hidden="true" className="text-ds-ink-faint">→</span> : null}
            <span className="rounded-ds-pill border border-ds-border bg-ds-surface px-2.5 py-1 text-xs font-bold text-ds-ink">{index + 1}. {step}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ds-ink-muted">
        {flow === 'manager_then_dp'
          ? 'O DP só recebe depois da aprovação do gestor. Uma rejeição encerra o fluxo.'
          : flow === 'automatic'
            ? 'Será automática somente se todas as validações da regra forem atendidas.'
            : 'A solicitação aguarda a decisão desta etapa.'}
      </p>
      {(flow === 'manager' || flow === 'manager_then_dp') ? (
        <p className="mt-1 text-xs font-semibold text-ds-alert-ink">Sem gestor direto válido, a solicitação não avança automaticamente e fica sinalizada ao DP.</p>
      ) : null}
    </div>
  );
}

function defaultPolicy(index = 0): PolicyForm {
  return {
    id: `regra-${index + 1}`,
    name: index === 0 ? 'Regra geral' : `Regra ${index + 1}`,
    employmentRelationshipTypes: ['clt'],
    applicability: { scope: { kind: 'company' } },
    calculation: 'scheduled_workdays',
    maxUnitsPerRequest: '',
    maxUnitsPerPeriod: '',
    limitPeriod: undefined,
    minimumNoticeDays: '0',
    maximumRetroactiveDays: '0',
    attachment: 'not_required',
    approvalFlow: 'dp',
    // Decisão do programador (19/10/2026): sem análise em 3 dias, a etapa é aprovada por decurso de prazo.
    tacitApprovalDays: '3',
    rejectionReasonRequired: true,
    allowFutureEdit: true,
    allowFutureCancel: true,
    instructions: '',
  };
}

function formFor(item?: DPAbsenceType): AbsenceForm {
  const instructionContext = {
    name: item?.name ?? '',
    requestUnits: item?.requestUnits ?? ['day'] as DPAbsenceRequestUnit[],
    workdayEffect: item?.workdayEffect ?? 'excused_absence' as DPAbsenceType['workdayEffect'],
    blocksSchedule: item?.blocksSchedule ?? true,
  };
  const seedMedicalInstructions = item?.name.trim().toLocaleLowerCase('pt-BR') === 'atestado médico';
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    color: item?.color ?? 'pink',
    requestUnits: item?.requestUnits ?? ['day'],
    initiatedBy: item?.initiatedBy ?? ['collaborator', 'manager', 'dp'],
    workdayEffect: item?.workdayEffect ?? 'excused_absence',
    includeInAbsenteeism: item?.includeInAbsenteeism ?? false,
    blocksSchedule: item?.blocksSchedule ?? true,
    policies: item?.policies.map((policy) => ({
      ...policy,
      maxUnitsPerRequest: policy.maxUnitsPerRequest == null ? '' : String(policy.maxUnitsPerRequest),
      maxUnitsPerPeriod: policy.maxUnitsPerPeriod == null ? '' : String(policy.maxUnitsPerPeriod),
      minimumNoticeDays: policy.minimumNoticeDays == null ? '' : String(policy.minimumNoticeDays),
      maximumRetroactiveDays: policy.maximumRetroactiveDays == null ? '' : String(policy.maximumRetroactiveDays),
      tacitApprovalDays: policy.tacitApprovalDays == null ? '' : String(policy.tacitApprovalDays),
      instructions: policy.instructions ?? (seedMedicalInstructions ? generateRequesterInstructions(instructionContext, policy) : ''),
    })) ?? [defaultPolicy()],
    validFrom: item?.validFrom ?? new Date().toISOString().slice(0, 10),
    validTo: item?.validTo ?? '',
  };
}

function optionalNumber(value: string, label: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} deve ser um número válido.`);
  return parsed;
}

function buildPayload(form: AbsenceForm) {
  return {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    color: form.color,
    requestUnits: form.requestUnits,
    initiatedBy: form.initiatedBy,
    workdayEffect: form.workdayEffect,
    includeInAbsenteeism: form.includeInAbsenteeism,
    blocksSchedule: form.blocksSchedule,
    policies: form.policies.map((policy) => ({
      ...policy,
      name: policy.name.trim(),
      id: policy.id.trim(),
      maxUnitsPerRequest: optionalNumber(policy.maxUnitsPerRequest, 'O limite por solicitação'),
      maxUnitsPerPeriod: optionalNumber(policy.maxUnitsPerPeriod, 'O limite acumulado'),
      minimumNoticeDays: optionalNumber(policy.minimumNoticeDays, 'A antecedência mínima'),
      maximumRetroactiveDays: optionalNumber(policy.maximumRetroactiveDays, 'O limite retroativo'),
      tacitApprovalDays: policy.approvalFlow === 'automatic' ? undefined : optionalNumber(policy.tacitApprovalDays, 'O prazo de aprovação por decurso'),
      ...(policy.instructions?.trim() ? { instructions: policy.instructions.trim() } : { instructions: undefined }),
    })),
    validFrom: form.validFrom,
    ...(form.validTo ? { validTo: form.validTo } : {}),
  };
}

function statusVariant(status: DPAbsenceType['status']) {
  if (status === 'published') return 'ok' as const;
  if (status === 'archived') return 'neutral' as const;
  return 'warn' as const;
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((current) => current !== value) : [...values, value];
}

export function DPSettingsAbsences() {
  const { permissions, isDefaultAdmin, activeUsers, user } = useAuth();
  const canManage = Boolean((isDefaultAdmin || permissions.dp?.settings?.manageAbsences === true) && user && resolveUnitAccess(user, { isDefaultAdmin }).allUnits);
  const { units, unitGroups, unitOrganizations } = useDP();
  const { roles, functions } = useHrBootstrap();
  const { items, loading, error, reload, create, update } = useDPTimeConfigs('absence-types', canManage);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [form, setForm] = useState<AbsenceForm>(() => formFor());
  const [editorTab, setEditorTab] = useState<'definition' | number>('definition');
  const [search, setSearch] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [previewUserId, setPreviewUserId] = useState('');
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);

  const editing = panel?.mode === 'edit' || panel?.mode === 'create';
  const item = panel && panel.mode !== 'create' ? panel.item : panel?.supersedes ?? null;
  useEffect(() => {
    setSaveError(null);
    setConfirmingArchive(false);
    setEditorTab('definition');
    if (panel?.mode === 'edit') setForm(formFor(panel.item));
    if (panel?.mode === 'create') {
      const next = formFor(panel.supersedes);
      setForm(panel.supersedes ? { ...next, validFrom: '', validTo: '' } : next);
    }
  }, [panel]);

  const unitNames = useMemo(() => new Map(units.map((entry) => [entry.id, entry.name])), [units]);
  const groupNames = useMemo(() => new Map(unitGroups.map((entry) => [entry.id, entry.name])), [unitGroups]);
  const organizationNames = useMemo(() => new Map(unitOrganizations.map((entry) => [entry.id, entry.name])), [unitOrganizations]);
  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return items;
    return items.filter((entry) => `${entry.name} ${entry.description ?? ''} ${entry.policies.map((policy) => policy.name).join(' ')}`.toLocaleLowerCase('pt-BR').includes(term));
  }, [items, search]);

  const preview = useMemo(() => {
    if (!item || !previewUserId) return null;
    const person = activeUsers.find((candidate) => candidate.id === previewUserId);
    if (!person || !person.employmentRelationshipType) return null;
    const unit = units.find((candidate) => candidate.id === person.unitId);
    const group = unitGroups.find((candidate) => candidate.id === unit?.groupId);
    return resolveAbsencePolicy(item, new Date().toISOString().slice(0, 10), {
      collaboratorId: person.id,
      employmentRelationshipType: person.employmentRelationshipType,
      unitId: person.unitId,
      unitGroupId: unit?.groupId,
      unitOrganizationId: unit?.organizationId ?? group?.organizationId,
      jobRoleId: person.jobRoleId,
      jobFunctionIds: person.jobFunctionIds,
    });
  }, [activeUsers, item, previewUserId, unitGroups, units]);

  function updatePolicy(index: number, patch: Partial<PolicyForm>) {
    setForm((current) => ({ ...current, policies: current.policies.map((policy, policyIndex) => policyIndex === index ? { ...policy, ...patch } : policy) }));
  }

  function addPolicy() {
    const nextIndex = form.policies.length;
    setForm((current) => ({ ...current, policies: [...current.policies, defaultPolicy(current.policies.length)] }));
    setEditorTab(nextIndex);
  }

  function removePolicy(index: number) {
    if (form.policies.length <= 1) return;
    setForm((current) => ({ ...current, policies: current.policies.filter((_, policyIndex) => policyIndex !== index) }));
    setEditorTab((current) => {
      if (current === 'definition') return current;
      if (current > index) return current - 1;
      if (current === index) return Math.max(0, index - 1);
      return current;
    });
  }

  async function save() {
    setSaveError(null);
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (panel?.mode === 'edit') {
        const updated = await update(panel.item.id, { action: 'update', data: { ...payload, description: form.description.trim() || null, validTo: form.validTo || null } });
        setPanel({ mode: 'view', item: updated });
      } else if (panel?.mode === 'create') {
        const created = await create({ ...payload, ...(panel.supersedes ? { supersedesId: panel.supersedes.id } : {}) });
        setPanel({ mode: 'view', item: created });
      }
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Não foi possível salvar o tipo de ausência.');
    } finally {
      setSaving(false);
    }
  }

  async function transition(action: 'publish' | 'archive') {
    if (!item) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await update(item.id, { action });
      setPanel({ mode: 'view', item: updated });
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Não foi possível alterar a situação.');
    } finally {
      setSaving(false);
      setConfirmingArchive(false);
    }
  }

  if (!canManage) return <p role="alert" className="text-sm font-semibold text-ds-danger">Você não tem permissão para gerenciar ausências.</p>;
  if (loading && items.length === 0) return <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando tipos de ausência"><ListSkeleton rows={4} /></div>;
  if (error && items.length === 0) return <div className="space-y-3" role="alert"><p className="text-sm font-semibold text-ds-danger">Erro ao carregar ausências: {error}</p><Button type="button" variant="ds-secondary" size="sm" onClick={() => void reload()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-5">
      <TimeConfigurationNotice>
        <span className="inline-flex items-center gap-2">Esta etapa configura os tipos e as regras. Ainda não recebe solicitações, bloqueia escalas, lança ponto ou gera folha.<InfoTooltip title="Limite desta etapa"><p>A simulação valida qual regra alcançaria uma pessoa.</p><p>A aplicação operacional acontecerá nas próximas etapas, depois da publicação das regras.</p></InfoTooltip></span>
      </TimeConfigurationNotice>
      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px] shadow-none ring-1 ring-white/10">
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Governança de ausências</p><p className="mt-1 font-ds-mono text-[44px] font-bold leading-none tracking-tighter">{items.length}</p><p className="mt-1 text-base font-extrabold">Tipos cadastrados</p></div>
        <div className="flex flex-wrap items-center gap-2.5"><ControlSearch value={search} onChange={setSearch} placeholder="Buscar tipo ou regra" /><Button type="button" variant="primary-page" size="xl" onClick={() => setPanel({ mode: 'create' })}>+ Novo tipo</Button></div>
      </ControlPanel>
      <div className="flex items-baseline gap-2.5"><span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleItems.length}</span><span className="text-[13px] text-ds-ink-faint">de {items.length} tipos</span></div>
      <ListShell minWidth={820}>
        <ListHead template={ROW_TEMPLATE}><span>Tipo</span><span>Solicitação</span><span>Regras</span><span>Situação</span><span /></ListHead>
        {visibleItems.map((entry) => (
          <ListRow key={entry.id} template={ROW_TEMPLATE} isOpen={item?.id === entry.id} isSelected={false} isMuted={entry.status === 'archived'} onOpen={() => setPanel({ mode: 'view', item: entry })} label={`Abrir tipo ${entry.name}`}>
            <div className="flex min-w-0 items-center gap-3"><span className={cn('h-3 w-3 shrink-0 rounded-full', colorClasses[entry.color])} /><div className="min-w-0"><p className="truncate text-[13.5px] font-bold">{entry.name}</p><p className="truncate text-xs text-ds-ink-muted">Versão {entry.version} · {workdayEffectLabels[entry.workdayEffect]}</p></div></div>
            <span className="truncate text-xs text-ds-ink-muted">{entry.requestUnits.map((unit) => unit === 'day' ? 'dias' : 'horas').join(' e ')}</span>
            <span className="font-ds-mono text-[13px] font-semibold">{entry.policies.length}</span>
            <StatusPill variant={statusVariant(entry.status)}>{timeConfigStatusLabel(entry.status)}</StatusPill><Chevron />
          </ListRow>
        ))}
        {items.length === 0 ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum tipo cadastrado. O primeiro será criado como rascunho.</p> : visibleItems.length === 0 ? <EmptyResults title="Nenhum tipo encontrado com essa busca." onClear={() => setSearch('')} /> : null}
      </ListShell>

      <SidePanel open={!!panel} onOpenChange={(open) => { if (!open) setPanel(null); }} kicker={panel?.mode === 'create' ? (panel.supersedes ? 'Nova versão' : 'Novo tipo') : panel?.mode === 'edit' ? 'Editar rascunho' : `Ausência · v${item?.version ?? 1}`} title={editing ? (form.name || 'Sem nome') : (item?.name ?? '')} subtitle="Tipo, efeito, público, documentos, aprovação e limites.">
        {panel && !editing && item ? <>
          <PanelSection title="Definição"><div className="grid grid-cols-2 gap-4"><PanelField label="Vigência">{formatValidityBR(item.validFrom, item.validTo)}</PanelField><PanelField label="Efeito">{workdayEffectLabels[item.workdayEffect]}</PanelField><PanelField label="Solicitação">{item.requestUnits.map((unit) => unit === 'day' ? 'Dia' : 'Hora').join(' e ')}</PanelField><PanelField label="Escala futura">{item.blocksSchedule ? 'Bloquear período aprovado' : 'Não bloquear'}</PanelField></div>{item.description ? <p className="text-xs text-ds-ink-muted">{item.description}</p> : null}</PanelSection>
          <PanelSection title="Regras" aside={`${item.policies.length}`}>{item.policies.map((policy) => <div key={policy.id} className="rounded-ds-md border border-ds-divider px-3 py-2.5"><p className="text-[13px] font-bold">{policy.name}</p><p className="mt-1 text-xs text-ds-ink-muted">{policy.employmentRelationshipTypes.map((relationship) => relationshipLabels[relationship]).join(', ')} · {calculationLabels[policy.calculation]} · {approvalLabels[policy.approvalFlow]}</p><p className="mt-1 text-xs text-ds-ink-muted">{applicabilityLabel(policy.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}</p></div>)}</PanelSection>
          <PanelSection title="Simular regra"><Field label="Colaborador" htmlFor="absence-preview-person" hint="A simulação usa vínculo, cargo, função e unidade atuais. Não cria solicitação."><AbsenceSelect id="absence-preview-person" value={previewUserId} onChange={(event) => setPreviewUserId(event.target.value)}><option value="">Selecione</option>{activeUsers.map((person) => <option key={person.id} value={person.id}>{person.username}</option>)}</AbsenceSelect></Field>{preview ? <div className="rounded-ds-md border border-ds-divider bg-ds-input px-3 py-2.5 text-xs">{preview.status === 'matched' ? <>Regra aplicável: <strong>{preview.policy.name}</strong></> : preview.status === 'ambiguous' ? <span className="font-semibold text-ds-danger">Há empate entre {preview.policies.length} regras. Refine a abrangência.</span> : <span className="text-ds-ink-muted">Nenhuma regra aplicável para esta pessoa e data.</span>}</div> : null}</PanelSection>
          <TimeConfigurationNotice>Publicar torna esta versão disponível aos fluxos futuros, mas ainda não altera escalas, ponto ou folha.</TimeConfigurationNotice>
          {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
          <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">{item.status === 'draft' ? <div className="grid grid-cols-2 gap-2"><Button type="button" variant="ds-secondary" size="md" onClick={() => setPanel({ mode: 'edit', item })}>Editar rascunho</Button><Button type="button" variant="primary-modal" size="md" loading={saving} onClick={() => void transition('publish')}>Publicar tipo</Button></div> : item.status === 'published' ? <><Button type="button" variant="primary-modal" size="md" onClick={() => setPanel({ mode: 'create', supersedes: item })}>Duplicar como nova versão</Button>{confirmingArchive ? <InlineConfirm message={`Arquivar “${item.name}”?`} loading={saving} returnFocusRef={archiveTriggerRef} onCancel={() => setConfirmingArchive(false)} onConfirm={() => void transition('archive')} /> : <Button ref={archiveTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingArchive(true)}>Arquivar tipo</Button>}</> : <Button type="button" variant="ds-secondary" size="md" onClick={() => setPanel({ mode: 'create', supersedes: item })}>Duplicar como nova versão</Button>}</div>
        </> : null}

        {panel && editing ? <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
          <div role="tablist" aria-label="Etapas do cadastro" className="flex max-w-full gap-1 overflow-x-auto rounded-ds-md bg-ds-seg p-[3px]">
            <button
              type="button"
              role="tab"
              id="absence-tab-definition"
              aria-controls="absence-panel-definition"
              aria-selected={editorTab === 'definition'}
              onClick={() => setEditorTab('definition')}
              className={cn('h-8 shrink-0 whitespace-nowrap rounded-ds-sm px-[14px] text-[13px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2', editorTab === 'definition' ? 'bg-white text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ds-ink-muted hover:text-ds-ink')}
            >
              Definição
            </button>
            {form.policies.map((_, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                id={`absence-tab-rule-${index}`}
                aria-controls={`absence-panel-rule-${index}`}
                aria-selected={editorTab === index}
                onClick={() => setEditorTab(index)}
                className={cn('h-8 shrink-0 whitespace-nowrap rounded-ds-sm px-[14px] text-[13px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2', editorTab === index ? 'bg-white text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ds-ink-muted hover:text-ds-ink')}
              >
                Regra <span aria-hidden="true">•</span> {index + 1}
              </button>
            ))}
          </div>
          {editorTab === 'definition' ? (
            <div id="absence-panel-definition" role="tabpanel" aria-labelledby="absence-tab-definition" className="space-y-5">
              <Field label="Nome do tipo" htmlFor="absence-name">
                <Input id="absence-name" className={fieldInputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Atestado médico" />
              </Field>
              <Field label="Descrição" htmlFor="absence-description" requirement="opcional">
                <textarea id="absence-description" className={`${fieldInputClass} h-24 resize-y py-2.5`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </Field>
              <PanelSection title="Identificação e período" aside={<InfoPopover title="Identificação e vigência"><DefinitionPeriodHelp /></InfoPopover>}>
                <div className="space-y-3">
                  <Field label="Cor">
                    <div className="flex flex-wrap gap-2">{(Object.keys(colorClasses) as DPAbsenceColor[]).map((color) => <button key={color} type="button" title={colorLabels[color]} aria-label={`Usar cor ${colorLabels[color]}`} aria-pressed={form.color === color} onClick={() => setForm((current) => ({ ...current, color }))} className={cn('h-8 w-8 rounded-full ring-offset-2', colorClasses[color], form.color === color && 'ring-2 ring-ds-modal')} />)}</div>
                  </Field>
                  <div className="grid grid-cols-2 gap-3 [&>div>label]:min-h-8">
                    <Field label="Início da vigência" htmlFor="absence-valid-from"><Input id="absence-valid-from" type="date" className={fieldInputClass} value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} /></Field>
                    <Field label="Fim" htmlFor="absence-valid-to" requirement="opcional"><Input id="absence-valid-to" type="date" className={fieldInputClass} value={form.validTo} onChange={(event) => setForm((current) => ({ ...current, validTo: event.target.value }))} /></Field>
                  </div>
                </div>
              </PanelSection>
              <PanelSection title="Pedido e efeito" aside={<InfoPopover title="Pedido e efeito na operação"><RequestEffectHelp /></InfoPopover>}>
                <Field label="Unidade da solicitação" hint="Você pode habilitar Dias, Horas ou as duas opções.">
                  <div className="flex gap-2">{([['day', 'Dias'], ['hour', 'Horas']] as const).map(([value, label]) => <Button key={value} type="button" variant={form.requestUnits.includes(value) ? 'primary-modal' : 'ds-secondary'} size="sm" onClick={() => setForm((current) => ({ ...current, requestUnits: toggleValue(current.requestUnits, value) as DPAbsenceRequestUnit[] }))}>{label}</Button>)}</div>
                </Field>
                <Field label="Quem pode iniciar">
                  <div className="flex flex-wrap gap-2">{([['collaborator', 'Colaborador'], ['manager', 'Gestor'], ['dp', 'DP'], ['system', 'Sistema']] as const).map(([value, label]) => <Button key={value} type="button" variant={form.initiatedBy.includes(value) ? 'primary-modal' : 'ds-secondary'} size="sm" onClick={() => setForm((current) => ({ ...current, initiatedBy: toggleValue(current.initiatedBy, value) as DPAbsenceInitiator[] }))}>{label}</Button>)}</div>
                </Field>
                <Field label="Efeito na jornada" htmlFor="absence-effect">
                  <AbsenceSelect id="absence-effect" value={form.workdayEffect} onChange={(event) => setForm((current) => ({ ...current, workdayEffect: event.target.value as DPAbsenceType['workdayEffect'] }))}>{Object.entries(workdayEffectLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AbsenceSelect>
                </Field>
                <div className="space-y-2">
                  <label className="flex min-h-11 items-center justify-between gap-3 rounded-ds-md px-0 text-xs font-bold"><span>Incluir no indicador de absenteísmo</span><Switch checked={form.includeInAbsenteeism} onCheckedChange={(includeInAbsenteeism) => setForm((current) => ({ ...current, includeInAbsenteeism }))} /></label>
                  <label className="flex min-h-11 items-center justify-between gap-3 rounded-ds-md px-0 text-xs font-bold"><span>Bloquear o período na escala quando aprovado</span><Switch checked={form.blocksSchedule} onCheckedChange={(blocksSchedule) => setForm((current) => ({ ...current, blocksSchedule }))} /></label>
                </div>
              </PanelSection>
            </div>
          ) : (
            <div
              id={`absence-panel-rule-${editorTab}`}
              role="tabpanel"
              aria-labelledby={`absence-tab-rule-${editorTab}`}
            >
            <PanelSection
              title="Regras deste tipo"
              aside={<span className="flex items-center gap-2"><span>{form.policies.length}</span><InfoPopover title="Campos e opções das regras"><RulesHelp /></InfoPopover></span>}
            >
              <TimeConfigurationNotice>
                <strong>Escopo deste cadastro:</strong> todas as regras abaixo pertencem somente a {form.name.trim() ? `“${form.name.trim()}”` : 'este novo tipo ainda sem nome'}. Elas não se aplicam aos demais tipos de ausência. PJ não participa destas regras. Use regras separadas quando CLT, aprendiz ou estágio tiverem condições diferentes.
              </TimeConfigurationNotice>
              <div className="space-y-4">
                {form.policies.map((policy, index) => editorTab === index ? (
                  <div key={index} className="space-y-4 rounded-ds-btn-lg border border-ds-divider bg-ds-surface px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Regra {index + 1}</p>
                        <InfoPopover title={`Como configurar a regra ${index + 1}`}><RulesHelp /></InfoPopover>
                      </div>
                      {form.policies.length > 1 ? <Button type="button" variant="danger-link" size="xs" onClick={() => removePolicy(index)}><Trash2 className="mr-1 h-3.5 w-3.5" />Remover</Button> : null}
                    </div>
                    <div className="space-y-3">
                      <RuleSectionHeader label="Público e abrangência" title="Público e abrangência da regra"><RuleAudienceHelp /></RuleSectionHeader>
                      <div className="grid grid-cols-2 gap-3 [&>div>label]:min-h-8">
                        <Field label="Código" htmlFor={`absence-policy-id-${index}`}><Input id={`absence-policy-id-${index}`} className={fieldInputClass} value={policy.id} onChange={(event) => updatePolicy(index, { id: event.target.value })} /></Field>
                        <Field label="Nome" htmlFor={`absence-policy-name-${index}`}><Input id={`absence-policy-name-${index}`} className={fieldInputClass} value={policy.name} onChange={(event) => updatePolicy(index, { name: event.target.value })} /></Field>
                      </div>
                      <Field label="Vínculos"><div className="flex flex-wrap gap-2">{(Object.keys(relationshipLabels) as DPAbsenceEmploymentRelationship[]).map((relationship) => <Button key={relationship} type="button" variant={policy.employmentRelationshipTypes.includes(relationship) ? 'primary-modal' : 'ds-secondary'} size="sm" onClick={() => updatePolicy(index, { employmentRelationshipTypes: toggleValue(policy.employmentRelationshipTypes, relationship) as DPAbsenceEmploymentRelationship[] })}>{relationshipLabels[relationship]}</Button>)}</div></Field>
                      <DPTimeApplicabilityFields idPrefix={`absence-policy-${index}`} value={policy.applicability} onChange={(applicability: DPTimeApplicability) => updatePolicy(index, { applicability })} units={units} unitOrganizations={unitOrganizations} unitGroups={unitGroups} roles={roles} functions={functions} people={activeUsers} />
                    </div>
                    <div className="space-y-3 border-t border-ds-divider pt-4">
                      <RuleSectionHeader label="Contagem e aprovação" title="Contagem e fluxo de aprovação"><RuleCountingApprovalHelp /></RuleSectionHeader>
                      <div className="grid grid-cols-2 gap-3 [&>div>label]:min-h-8">
                        <Field label="Contagem" htmlFor={`absence-calculation-${index}`}><AbsenceSelect id={`absence-calculation-${index}`} value={policy.calculation} onChange={(event) => updatePolicy(index, { calculation: event.target.value as DPAbsencePolicy['calculation'] })}>{Object.entries(calculationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AbsenceSelect></Field>
                        <Field label="Fluxo de aprovação" htmlFor={`absence-approval-${index}`} hint="A ordem aparece logo abaixo."><AbsenceSelect id={`absence-approval-${index}`} value={policy.approvalFlow} onChange={(event) => updatePolicy(index, { approvalFlow: event.target.value as DPAbsencePolicy['approvalFlow'] })}>{Object.entries(approvalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AbsenceSelect></Field>
                        <ApprovalFlowPreview flow={policy.approvalFlow} />
                      </div>
                      <AbsenceApprovalAssignments value={policy.approvalAssignments} onChange={(approvalAssignments) => updatePolicy(index, { approvalAssignments })} roles={roles} functions={functions} people={activeUsers} attachment={policy.attachment} />
                    </div>
                    <div className="space-y-3 border-t border-ds-divider pt-4">
                      <RuleSectionHeader label="Limites, prazos e documento" title="Limites, prazos e anexo"><RuleLimitsHelp /></RuleSectionHeader>
                      <div className="grid grid-cols-2 gap-3 [&>div>label]:min-h-8">
                        <Field label="Máximo por solicitação" htmlFor={`absence-max-request-${index}`} requirement="opcional"><Input id={`absence-max-request-${index}`} type="number" min={0} className={fieldInputClass} value={policy.maxUnitsPerRequest} onChange={(event) => updatePolicy(index, { maxUnitsPerRequest: event.target.value })} /></Field>
                        <Field label="Máximo acumulado" htmlFor={`absence-max-period-${index}`} requirement="opcional"><Input id={`absence-max-period-${index}`} type="number" min={0} className={fieldInputClass} value={policy.maxUnitsPerPeriod} onChange={(event) => updatePolicy(index, { maxUnitsPerPeriod: event.target.value })} /></Field>
                        {policy.maxUnitsPerPeriod ? <Field label="Período do limite" htmlFor={`absence-limit-period-${index}`}><AbsenceSelect id={`absence-limit-period-${index}`} value={policy.limitPeriod ?? ''} onChange={(event) => updatePolicy(index, { limitPeriod: event.target.value as DPAbsencePolicy['limitPeriod'] })}><option value="">Selecione</option><option value="month">Mês</option><option value="year">Ano</option></AbsenceSelect></Field> : null}
                        <Field label="Antecedência mínima (dias)" htmlFor={`absence-notice-${index}`}><Input id={`absence-notice-${index}`} type="number" min={0} className={fieldInputClass} value={policy.minimumNoticeDays} onChange={(event) => updatePolicy(index, { minimumNoticeDays: event.target.value })} /></Field>
                        <Field label="Retroativo permitido (dias)" htmlFor={`absence-retroactive-${index}`}><Input id={`absence-retroactive-${index}`} type="number" min={0} className={fieldInputClass} value={policy.maximumRetroactiveDays} onChange={(event) => updatePolicy(index, { maximumRetroactiveDays: event.target.value })} /></Field>
                        <Field label="Anexo" htmlFor={`absence-attachment-${index}`}><AbsenceSelect id={`absence-attachment-${index}`} value={policy.attachment} onChange={(event) => updatePolicy(index, { attachment: event.target.value as DPAbsencePolicy['attachment'] })}><option value="not_required">Não obrigatório</option><option value="required">Obrigatório</option></AbsenceSelect></Field>
                      </div>
                    </div>
                    <div className="space-y-3 border-t border-ds-divider pt-4">
                      <RuleSectionHeader label="Gestão da solicitação" title="Rejeição, edição e cancelamento"><RuleRequestControlsHelp /></RuleSectionHeader>
                      <div className="space-y-2">
                        <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-bold"><span>Exigir motivo ao rejeitar</span><Switch checked={policy.rejectionReasonRequired} onCheckedChange={(rejectionReasonRequired) => updatePolicy(index, { rejectionReasonRequired })} /></label>
                        <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-bold"><span>Permitir editar pedido futuro</span><Switch checked={policy.allowFutureEdit} onCheckedChange={(allowFutureEdit) => updatePolicy(index, { allowFutureEdit })} /></label>
                        {policy.approvalFlow !== 'automatic' ? (
                          <Field label="Aprovar por decurso de prazo após (dias corridos)" htmlFor={`absence-tacit-${index}`} requirement="opcional"
                            hint="Sem análise nesse prazo, contado desde a atribuição de cada etapa, a etapa é aprovada automaticamente e o pedido mostra a tag “Aprovada por decurso de prazo”. Em branco: nunca aprova sozinho.">
                            <Input id={`absence-tacit-${index}`} type="number" min={1} max={30} className={fieldInputClass} value={policy.tacitApprovalDays}
                              onChange={(event) => updatePolicy(index, { tacitApprovalDays: event.target.value })} />
                          </Field>
                        ) : null}
                        <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-bold"><span>Permitir cancelar pedido futuro</span><Switch checked={policy.allowFutureCancel} onCheckedChange={(allowFutureCancel) => updatePolicy(index, { allowFutureCancel })} /></label>
                      </div>
                      <div className="space-y-2">
                        <Button type="button" variant="ds-secondary" size="xs" onClick={() => updatePolicy(index, { instructions: generateRequesterInstructions(form, policy) })}>Gerar instruções a partir da regra</Button>
                        <Field label="Instruções ao solicitante" htmlFor={`absence-instructions-${index}`} requirement="opcional"><textarea id={`absence-instructions-${index}`} className={`${fieldInputClass} h-48 resize-y py-2.5`} value={policy.instructions ?? ''} onChange={(event) => updatePolicy(index, { instructions: event.target.value })} /></Field>
                      </div>
                    </div>
                  </div>
                ) : null)}
                <Button type="button" variant="ds-secondary" size="sm" onClick={addPolicy}><Plus className="mr-1.5 h-4 w-4" />Adicionar regra</Button>
              </div>
            </PanelSection>
            </div>
          )}
          {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}<div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4"><Button type="button" variant="ds-secondary" size="md" disabled={saving} onClick={() => item ? setPanel({ mode: 'view', item }) : setPanel(null)}>Cancelar</Button><Button type="submit" variant="primary-modal" size="md" loading={saving}>{panel.mode === 'edit' ? 'Salvar rascunho' : 'Criar rascunho'}</Button></div>
        </form> : null}
      </SidePanel>
    </div>
  );
}
