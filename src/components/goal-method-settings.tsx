"use client";

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calculator, Gift, Info, Megaphone, Plus, Save, Target, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useGoalMethodConfigs } from '@/hooks/use-goal-method-configs';
import { useToast } from '@/hooks/use-toast';
import {
  applyRevenueTargetsToGoalMethod,
  calculateTieredGoalBonus,
  DEFAULT_KIOSK_MEDIUM_GOAL_METHOD_ID,
  formatCurrencyBRL,
} from '@/lib/goal-methods';
import { cn } from '@/lib/utils';
import { type GoalBonusTierConfig, type GoalIncentiveMessageRule, type GoalMethodConfig } from '@/types';

interface GoalMethodSettingsProps {
  canManage: boolean;
}

function cloneConfig(config: GoalMethodConfig): GoalMethodConfig {
  return {
    ...config,
    tiers: config.tiers.map(tier => ({ ...tier })),
    teamBonus: {
      ...config.teamBonus,
      reliefWorker: config.teamBonus.reliefWorker ? { ...config.teamBonus.reliefWorker } : undefined,
    },
    leadershipBonus: { ...config.leadershipBonus },
    incentiveMessages: config.incentiveMessages.map(rule => ({ ...rule })),
  };
}

function goalPeriodLabel(value: string) {
  if (value === 'daily') return 'Diária';
  if (value === 'weekly') return 'Semanal';
  return 'Mensal';
}

function toneClass(tone: GoalIncentiveMessageRule['tone']) {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

function optionalNumberValue(value: number | null): string | number {
  return value ?? '';
}

function parseOptionalNumber(value: string): number | null {
  return value === '' ? null : Number(value);
}

function MethodInfoTooltip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-pink-200 hover:text-pink-700"
            aria-label={title}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-[380px] space-y-2 p-3 text-xs leading-relaxed">
          <p className="font-bold text-slate-950">{title}</p>
          <div className="space-y-1 text-muted-foreground">{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function createNewGoalMethodDraft(): GoalMethodConfig {
  const id = `custom-goal-method-${Date.now()}`;
  return {
    id,
    name: 'Nova forma de meta',
    type: 'tiered_unit_bonus',
    active: true,
    unitProfile: '',
    targetPeriod: 'monthly',
    referenceRevenue: 0,
    description: '',
    tiers: [
      { id: 'target', label: 'Meta Alvo', fromAmount: 0, toAmount: 0, displayTargetAmount: 0, fixedBonusAmount: 0, excessPercent: 0 },
      { id: 'up', label: 'Meta UP', fromAmount: 0, toAmount: 0, displayTargetAmount: 0, fixedBonusAmount: 0, excessPercent: 0 },
      { id: 'top', label: 'Meta TOP', fromAmount: 0, toAmount: null, displayTargetAmount: 0, fixedBonusAmount: 0, excessPercent: 0 },
    ],
    teamBonus: {
      enabled: true,
      splitMode: 'equal',
      eligibleCollaboratorRule: 'all_goal_participants',
      prorateByAttendance: false,
      reliefWorker: {
        enabled: true,
        splitMode: 'proportional_by_covered_shifts',
        turnsPerDay: 2,
        fixedCollaboratorRule: 'remaining_equal_split',
        description: '',
      },
    },
    leadershipBonus: {
      enabled: false,
      factorNumerator: 1,
      factorDenominator: 3,
    },
    incentiveMessages: [
      {
        id: 'near-next-tier',
        label: 'Perto da próxima faixa',
        triggerType: 'distance_to_next_tier_percent',
        thresholdPercent: 10,
        message: 'Falta pouco para {tierLabel}: R$ {remainingAmount}.',
        tone: 'info',
      },
      {
        id: 'tier-reached',
        label: 'Faixa atingida',
        triggerType: 'tier_reached',
        message: '{tierLabel} batida. Bonificação estimada por colaborador: R$ {perCollaboratorBonus}.',
        tone: 'success',
      },
    ],
  };
}

export function GoalMethodSettings({ canManage }: GoalMethodSettingsProps) {
  const { configs, loading, error, upsertGoalMethodConfig } = useGoalMethodConfigs();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState(DEFAULT_KIOSK_MEDIUM_GOAL_METHOD_ID);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GoalMethodConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewTarget, setPreviewTarget] = useState(29000);
  const [previewUp, setPreviewUp] = useState(32000);
  const [previewTop, setPreviewTop] = useState(35000);
  const [previewRevenue, setPreviewRevenue] = useState(36000);
  const [previewCollaborators, setPreviewCollaborators] = useState<number | null>(3);
  const [previewFixedCollaborators, setPreviewFixedCollaborators] = useState<number | null>(2);
  const [previewReliefWorkerCount, setPreviewReliefWorkerCount] = useState<number | null>(1);
  const [previewTotalTurns, setPreviewTotalTurns] = useState<number | null>(60);
  const [previewReliefCoveredTurns, setPreviewReliefCoveredTurns] = useState<number | null>(8);

  const selectedConfig = useMemo(
    () => configs.find(config => config.id === selectedId) ?? null,
    [configs, selectedId]
  );

  useEffect(() => {
    if (!selectedConfig) return;
    setDraft(cloneConfig(selectedConfig));
  }, [selectedConfig]);

  const previewConfig = useMemo(
    () => draft
      ? applyRevenueTargetsToGoalMethod(draft, {
          targetValue: previewTarget,
          upValue: previewUp,
          topValue: previewTop,
        })
      : null,
    [draft, previewTarget, previewTop, previewUp]
  );

  const previewUsesReliefWorker = draft?.teamBonus.reliefWorker?.enabled === true;
  const previewFixedCount = Math.max(previewFixedCollaborators ?? 0, 0);
  const previewReliefCount = previewUsesReliefWorker ? Math.max(previewReliefWorkerCount ?? 0, 0) : 0;
  const previewEligibleCount = previewUsesReliefWorker
    ? previewFixedCount + previewReliefCount
    : Math.max(previewCollaborators ?? 0, 0);

  const preview = useMemo(
    () => calculateTieredGoalBonus(previewConfig, previewRevenue, previewEligibleCount, {
      fixedCollaboratorCount: previewFixedCount,
      reliefWorkerCount: previewReliefCount,
      totalPeriodTurns: previewTotalTurns ?? 0,
      reliefWorkerCoveredTurns: previewReliefCoveredTurns ?? 0,
    }),
    [
      previewConfig,
      previewEligibleCount,
      previewFixedCount,
      previewReliefCount,
      previewReliefCoveredTurns,
      previewRevenue,
      previewTotalTurns,
    ]
  );

  const previewFixedDistributionRows = useMemo(() => {
    const amount = preview?.reliefWorkerSplit
      ? preview.reliefWorkerSplit.perFixedCollaboratorBonus
      : preview?.perCollaboratorBonus ?? 0;
    const count = previewUsesReliefWorker ? previewFixedCount : previewEligibleCount;
    return Array.from({ length: count }, (_, index) => ({
      label: `Colaborador fixo ${index + 1}`,
      amount,
    }));
  }, [preview, previewEligibleCount, previewFixedCount, previewUsesReliefWorker]);

  const previewReliefDistributionRows = useMemo(() => {
    const bonuses = preview?.reliefWorkerSplit?.reliefWorkerBonuses ?? [];
    return Array.from({ length: previewReliefCount }, (_, index) => ({
      label: `Folguista ${index + 1}`,
      amount: bonuses[index] ?? 0,
    }));
  }, [preview, previewReliefCount]);

  function updateTier(index: number, patch: Partial<GoalBonusTierConfig>) {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tiers: prev.tiers.map((tier, idx) => idx === index ? { ...tier, ...patch } : tier),
      };
    });
  }

  function updateMessage(index: number, patch: Partial<GoalIncentiveMessageRule>) {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        incentiveMessages: prev.incentiveMessages.map((rule, idx) => idx === index ? { ...rule, ...patch } : rule),
      };
    });
  }

  async function handleSave() {
    if (!draft || !canManage) return;
    setSaving(true);
    try {
      await upsertGoalMethodConfig(draft);
      toast({ title: 'Forma de meta salva', description: 'A metodologia ficou disponível para novas metas de faturamento.' });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Não foi possível salvar a forma de meta.';
      toast({ title: 'Erro ao salvar', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function openEditor(configId: string) {
    setSelectedId(configId);
    setEditingId(configId);
  }

  function handleCreateNew() {
    const nextDraft = createNewGoalMethodDraft();
    setSelectedId(nextDraft.id);
    setEditingId(nextDraft.id);
    setDraft(nextDraft);
    setPreviewTarget(29000);
    setPreviewUp(32000);
    setPreviewTop(35000);
    setPreviewRevenue(36000);
    setPreviewCollaborators(3);
    setPreviewFixedCollaborators(2);
    setPreviewReliefWorkerCount(1);
    setPreviewTotalTurns(60);
    setPreviewReliefCoveredTurns(8);
  }

  if (loading && !draft) {
    return (
      <Card className="rounded-2xl border-slate-200 bg-white">
        <CardContent className="p-8 text-sm text-muted-foreground">Carregando formas de meta...</CardContent>
      </Card>
    );
  }

  if (!editingId) {
    return (
      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-5 p-5 lg:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full bg-pink-100 text-pink-700 hover:bg-pink-100">Comercial</Badge>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Formas de meta</span>
              </div>
              <h2 className="mt-2 text-xl font-black tracking-tight">Formas de meta cadastradas</h2>
              <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
                Clique em uma metodologia para editar faixas, bonificação, divisão e mensagens.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                {configs.length} forma(s)
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                {configs.filter(config => config.active).length} ativa(s)
              </div>
              <Button onClick={handleCreateNew} disabled={!canManage} className="h-9 rounded-full">
                <Plus className="mr-2 h-4 w-4" />
                Nova forma de meta
              </Button>
            </div>
          </div>

          {error && (
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Usando modelo padrão local. Para persistir alterações, a coleção de configurações precisa estar liberada nas Rules.</span>
            </div>
          )}

          <div className="grid max-w-[1120px] gap-4">
            {configs.map(config => {
              return (
                <button
                  key={config.id}
                  type="button"
                  onClick={() => openEditor(config.id)}
                  className="group rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left transition hover:border-pink-200 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn(
                          'rounded-full',
                          config.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'
                        )}>
                          {config.active ? 'Ativa' : 'Inativa'}
                        </Badge>
                        <Badge variant="outline" className="rounded-full bg-white">
                          {goalPeriodLabel(config.targetPeriod)}
                        </Badge>
                      </div>
                      <h3 className="mt-3 text-lg font-black tracking-tight text-slate-950 group-hover:text-pink-700">
                        {config.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {config.description || 'Sem descrição operacional.'}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full bg-pink-50 px-3 py-1 text-xs font-bold text-pink-700">
                      Editar
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
                    {config.tiers.slice(0, 3).map(tier => (
                      <div key={tier.id} className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground">{tier.label}</p>
                        <p className="mt-1 font-black">R$ {formatCurrencyBRL(tier.fixedBonusAmount)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">+ {tier.excessPercent}% do excedente</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold">Aplicação</span>
                      <span className="font-semibold text-pink-700">Valores vêm da meta</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      A forma guarda regra de bonificação, divisão, liderança e mensagens. Alvo, UP e TOP são definidos ao criar a meta.
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {config.tiers.map(tier => (
                      <span key={tier.id} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {tier.label}: {tier.excessPercent}%
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card className="rounded-2xl border-slate-200 bg-white">
        <CardContent className="p-8 text-sm text-muted-foreground">Nenhuma forma de meta encontrada.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardContent className="p-6 lg:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="rounded-full bg-pink-100 text-pink-700 hover:bg-pink-100">Comercial</Badge>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Formas de meta</span>
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight">Editar forma de meta</h2>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  Ajuste a metodologia, as faixas de bonificação e as mensagens que aparecem nas metas de faturamento.
                </p>
              </div>
              {error && (
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  <Info className="h-3.5 w-3.5" />
                  Usando modelo padrão local. Para persistir alterações, a coleção de configurações precisa estar liberada nas Rules.
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setEditingId(null)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para formas
              </Button>
              <Button onClick={handleSave} disabled={!canManage || saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar forma de meta'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-7 2xl:grid-cols-[minmax(0,1fr)_540px]">
        <div className="space-y-6">
          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-6 p-6 lg:p-7">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-pink-600" />
                  <h3 className="text-lg font-black">Dados gerais</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="goal-method-active" className="text-xs text-muted-foreground">Ativa</Label>
                  <Switch
                    id="goal-method-active"
                    checked={draft.active}
                    disabled={!canManage}
                    onCheckedChange={checked => setDraft(prev => prev ? { ...prev, active: checked } : prev)}
                  />
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Nome da forma</Label>
                  <Input
                    value={draft.name}
                    disabled={!canManage}
                    onChange={event => setDraft(prev => prev ? { ...prev, name: event.target.value } : prev)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Perfil da unidade</Label>
                  <Input
                    value={draft.unitProfile ?? ''}
                    disabled={!canManage}
                    placeholder="Ex: Quiosque médio"
                    onChange={event => setDraft(prev => prev ? { ...prev, unitProfile: event.target.value } : prev)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Período sugerido</Label>
                  <Select
                    value={draft.targetPeriod}
                    disabled={!canManage}
                    onValueChange={value => setDraft(prev => prev ? { ...prev, targetPeriod: value as GoalMethodConfig['targetPeriod'] } : prev)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diária</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Descrição operacional</Label>
                <Textarea
                  value={draft.description ?? ''}
                  disabled={!canManage}
                  rows={3}
                  onChange={event => setDraft(prev => prev ? { ...prev, description: event.target.value } : prev)}
                />
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800">
                Esta tela configura apenas os parâmetros da forma. Os valores de faturamento, como Meta Alvo, UP e TOP, são definidos na montagem de cada meta.
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-5 p-6 lg:p-7">
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-pink-600" />
                <h3 className="text-lg font-black">Faixas de bonificação</h3>
              </div>

              <div className="space-y-4">
                {draft.tiers.map((tier, index) => {
                  return (
                    <div key={tier.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.8fr_0.7fr_1.45fr]">
                        <div className="space-y-2">
                          <Label>Nome da faixa</Label>
                          <Input
                            value={tier.label}
                            disabled={!canManage}
                            onChange={event => updateTier(index, { label: event.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Bonificação fixa</Label>
                          <CurrencyInput value={tier.fixedBonusAmount} disabled={!canManage} onChange={value => updateTier(index, { fixedBonusAmount: value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>% excedente</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={tier.excessPercent}
                            disabled={!canManage}
                            onChange={event => updateTier(index, { excessPercent: Number(event.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Descrição da faixa</Label>
                          <Input
                            value={tier.description ?? ''}
                            disabled={!canManage}
                            onChange={event => updateTier(index, { description: event.target.value })}
                          />
                        </div>
                      </div>
                      <p className="mt-4 text-xs text-muted-foreground">
                        Esta faixa será posicionada sobre o valor correspondente informado na meta: Alvo, UP ou TOP.
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-5 p-6 lg:p-7">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-pink-600" />
                <h3 className="text-lg font-black">Distribuição e liderança</h3>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold">Bonificação da equipe</p>
                        <MethodInfoTooltip title="Como calcular a bonificação da equipe">
                          <p>1. O sistema olha o faturamento realizado da meta.</p>
                          <p>2. Cada faixa atingida soma uma bonificação fixa mais um percentual sobre o excedente daquela faixa.</p>
                          <p>3. A soma das faixas forma a bonificação total da unidade. Exemplo: Meta Alvo + Meta UP + Meta TOP = bonificação da equipe.</p>
                        </MethodInfoTooltip>
                      </div>
                      <p className="text-xs text-muted-foreground">Divide o bônus total entre os colaboradores elegíveis.</p>
                    </div>
                    <Switch
                      checked={draft.teamBonus.enabled}
                      disabled={!canManage}
                      onCheckedChange={checked => setDraft(prev => prev ? { ...prev, teamBonus: { ...prev.teamBonus, enabled: checked } } : prev)}
                    />
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label>Forma de divisão</Label>
                    <Select
                      value={draft.teamBonus.splitMode}
                      disabled={!canManage}
                      onValueChange={value => setDraft(prev => prev ? { ...prev, teamBonus: { ...prev.teamBonus, splitMode: value as GoalMethodConfig['teamBonus']['splitMode'] } } : prev)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equal">Igual entre elegíveis</SelectItem>
                        <SelectItem value="weighted_by_presence">Proporcional à presença</SelectItem>
                        <SelectItem value="manual">Manual no fechamento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold">Bonificação da liderança</p>
                        <MethodInfoTooltip title="Como calcular a bonificação da liderança">
                          <p>A bonificação da liderança é calculada sobre a bonificação total da unidade.</p>
                          <p>No padrão 1/3: se a equipe gerou R$ 960,00 de bonificação, a liderança recebe R$ 320,00.</p>
                          <p>Esse valor é calculado separadamente e não muda a divisão entre colaboradoras fixas e folguista.</p>
                          <p>Quem recebe é identificado na montagem da meta pelo responsável estruturado no organograma da unidade.</p>
                        </MethodInfoTooltip>
                      </div>
                      <p className="text-xs text-muted-foreground">Calculado separadamente sobre a bonificação total da unidade.</p>
                    </div>
                    <Switch
                      checked={draft.leadershipBonus.enabled}
                      disabled={!canManage}
                      onCheckedChange={checked => setDraft(prev => prev ? { ...prev, leadershipBonus: { ...prev.leadershipBonus, enabled: checked } } : prev)}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Numerador</Label>
                      <Input
                        type="number"
                        min={0}
                        value={draft.leadershipBonus.factorNumerator}
                        disabled={!canManage}
                        onChange={event => setDraft(prev => prev ? { ...prev, leadershipBonus: { ...prev.leadershipBonus, factorNumerator: Number(event.target.value) || 0 } } : prev)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Denominador</Label>
                      <Input
                        type="number"
                        min={1}
                        value={draft.leadershipBonus.factorDenominator}
                        disabled={!canManage}
                        onChange={event => setDraft(prev => prev ? { ...prev, leadershipBonus: { ...prev.leadershipBonus, factorDenominator: Number(event.target.value) || 1 } } : prev)}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 md:col-span-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-blue-950">Folguista proporcional por turnos</p>
                        <MethodInfoTooltip title="Como o sistema identifica e calcula a folguista">
                          <p>A identificação vem da escala e do organograma: se a colaboradora tem função/cargo de Folguista e aparece escalada nesta unidade, ela entra como folguista.</p>
                          <p>O sistema conta quantos turnos ela cobriu e divide pelo total de turnos possíveis do período.</p>
                          <p>Fórmula: turnos cobertos ÷ total de turnos × bonificação total da unidade. O restante é dividido igualmente entre as fixas.</p>
                        </MethodInfoTooltip>
                      </div>
                      <p className="max-w-4xl text-xs leading-relaxed text-blue-800">
                        O sistema identifica pela escala e pelo organograma: colaboradora com função de folguista escalada nesta unidade recebe proporcionalmente aos turnos cobertos.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4">
                    <div className="space-y-2">
                      <Label>Texto de apoio operacional</Label>
                      <Textarea
                        rows={3}
                        disabled={!canManage}
                        value={draft.teamBonus.reliefWorker?.description ?? ''}
                        onChange={event => setDraft(prev => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            teamBonus: {
                              ...prev.teamBonus,
                              reliefWorker: {
                                enabled: prev.teamBonus.reliefWorker?.enabled ?? true,
                                splitMode: 'proportional_by_covered_shifts',
                                turnsPerDay: prev.teamBonus.reliefWorker?.turnsPerDay ?? 2,
                                fixedCollaboratorRule: 'remaining_equal_split',
                                description: event.target.value,
                              },
                            },
                          };
                        })}
                      />
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-blue-200 bg-white/70 p-4 text-sm text-blue-950">
                    <p className="font-black">Fórmula</p>
                    <p className="mt-1">
                      Bonificação da folguista = (turnos cobertos pela folguista ÷ total de turnos do mês) × bonificação total da unidade.
                    </p>
                    <p className="mt-1 text-xs text-blue-800">
                      Depois disso, o restante é dividido igualmente entre as colaboradoras fixas, sem considerar quantos turnos cada fixa cobriu entre si.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-5 p-6 lg:p-7">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-pink-600" />
                    <h3 className="text-lg font-black">Mensagens para o painel do colaborador</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Esses textos aparecem junto da meta no painel do colaborador quando o gatilho for atingido.
                  </p>
                </div>
                <div className="flex max-w-xl flex-wrap gap-2 text-xs">
                  {[
                    '{tierLabel}',
                    '{remainingAmount}',
                    '{currentAmount}',
                    '{thresholdAmount}',
                    '{teamBonus}',
                    '{perCollaboratorBonus}',
                    '{leadershipBonus}',
                  ].map(variable => (
                    <span key={variable} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-slate-600">
                      {variable}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                {draft.incentiveMessages.map((rule, index) => (
                  <div key={rule.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="grid gap-4 md:grid-cols-[1fr_190px_150px]">
                      <div className="space-y-1.5">
                        <Label>Nome interno da mensagem</Label>
                        <Input
                          value={rule.label}
                          disabled={!canManage}
                          onChange={event => updateMessage(index, { label: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gatilho</Label>
                        <Select
                          value={rule.triggerType}
                          disabled={!canManage}
                          onValueChange={value => updateMessage(index, { triggerType: value as GoalIncentiveMessageRule['triggerType'] })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="distance_to_next_tier_percent">Distância em %</SelectItem>
                            <SelectItem value="distance_to_next_tier_amount">Distância em R$</SelectItem>
                            <SelectItem value="tier_reached">Faixa batida</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Tom</Label>
                        <Select
                          value={rule.tone}
                          disabled={!canManage}
                          onValueChange={value => updateMessage(index, { tone: value as GoalIncentiveMessageRule['tone'] })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="info">Informativo</SelectItem>
                            <SelectItem value="warning">Urgente</SelectItem>
                            <SelectItem value="success">Conquista</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr]">
                      <div className="space-y-1.5">
                        <Label>Limite do gatilho</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={rule.triggerType === 'distance_to_next_tier_amount' ? rule.thresholdAmount ?? 0 : rule.thresholdPercent ?? 0}
                          disabled={!canManage || rule.triggerType === 'tier_reached'}
                          onChange={event => {
                            const value = Number(event.target.value) || 0;
                            updateMessage(
                              index,
                              rule.triggerType === 'distance_to_next_tier_amount'
                                ? { thresholdAmount: value }
                                : { thresholdPercent: value }
                            );
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Texto exibido ao colaborador</Label>
                        <Textarea
                          value={rule.message}
                          disabled={!canManage}
                          rows={2}
                          onChange={event => updateMessage(index, { message: event.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="sticky top-4 rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-5 p-5 lg:p-6">
              <div className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-pink-600" />
                <h3 className="text-lg font-black">Simulação do cálculo</h3>
              </div>

              <p className="text-xs text-muted-foreground">
                Use valores de exemplo para testar a regra. Eles não são salvos na forma de meta.
              </p>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Meta exemplo</p>
                <div className="mt-4 grid gap-3">
                  <div className="space-y-2">
                    <Label>Meta alvo</Label>
                    <CurrencyInput value={previewTarget} onChange={setPreviewTarget} />
                  </div>
                  <div className="space-y-2">
                    <Label>Meta UP</Label>
                    <CurrencyInput value={previewUp} onChange={setPreviewUp} />
                  </div>
                  <div className="space-y-2">
                    <Label>Meta TOP</Label>
                    <CurrencyInput value={previewTop} onChange={setPreviewTop} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
                <div className="space-y-2">
                  <Label>Faturamento simulado</Label>
                  <CurrencyInput value={previewRevenue} onChange={setPreviewRevenue} />
                </div>
                {draft.teamBonus.reliefWorker?.enabled ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Elegíveis</p>
                    <p className="mt-1 text-xl font-black">{previewEligibleCount}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Elegíveis</Label>
                    <Input
                      type="number"
                      min={0}
                      value={optionalNumberValue(previewCollaborators)}
                      onChange={event => {
                        setPreviewCollaborators(parseOptionalNumber(event.target.value));
                      }}
                    />
                  </div>
                )}
              </div>

              {draft.teamBonus.reliefWorker?.enabled && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-800">Colaboradores</p>
                  <div className="mt-4 grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Colaboradoras fixas</Label>
                        <Input
                          type="number"
                          min={0}
                          value={optionalNumberValue(previewFixedCollaborators)}
                          onChange={event => setPreviewFixedCollaborators(parseOptionalNumber(event.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Folguistas</Label>
                        <Input
                          type="number"
                          min={0}
                          value={optionalNumberValue(previewReliefWorkerCount)}
                          onChange={event => setPreviewReliefWorkerCount(parseOptionalNumber(event.target.value))}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Total de turnos</Label>
                        <Input
                          type="number"
                          min={0}
                          value={optionalNumberValue(previewTotalTurns)}
                          onChange={event => setPreviewTotalTurns(parseOptionalNumber(event.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Turnos por folguista</Label>
                        <Input
                          type="number"
                          min={0}
                          value={optionalNumberValue(previewReliefCoveredTurns)}
                          onChange={event => setPreviewReliefCoveredTurns(parseOptionalNumber(event.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-blue-800">
                    Exemplo: 30 dias x 2 turnos = 60 turnos possíveis. Se cada folguista cobrir 8, cada uma recebe 8/60 da bonificação da equipe.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Faixas atingidas</p>
                {preview?.achievedTiers.length ? (
                  preview.achievedTiers.map(item => (
                    <div key={item.tier.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold">{item.tier.label}</span>
                        <span className="font-black">R$ {formatCurrencyBRL(item.totalBonusAmount)}</span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        <p>
                          Meta: R$ {formatCurrencyBRL(item.tier.fromAmount)}
                          {item.tier.toAmount ? ` a R$ ${formatCurrencyBRL(item.tier.toAmount)}` : ' em diante'}
                        </p>
                        <p>Excedente: R$ {formatCurrencyBRL(item.excessAmount)}</p>
                        <p>
                          R$ {formatCurrencyBRL(item.excessAmount)} x {item.tier.excessPercent}% = R$ {formatCurrencyBRL(item.variableBonusAmount)}
                        </p>
                        <p>
                          Fixo por ter batido a {item.tier.label}: R$ {formatCurrencyBRL(item.fixedBonusAmount)}
                        </p>
                        <p className="font-semibold text-slate-900">
                          Bonificação dessa faixa de meta: R$ {formatCurrencyBRL(item.fixedBonusAmount)} + R$ {formatCurrencyBRL(item.variableBonusAmount)} = R$ {formatCurrencyBRL(item.totalBonusAmount)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground">
                    Nenhuma faixa atingida nesta simulação.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Resumo</p>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-xl bg-white px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Bonificação da equipe</p>
                      <p className="mt-0.5 text-base font-black">R$ {formatCurrencyBRL(preview?.totalTeamBonus ?? 0)}</p>
                    </div>
                  <div className="rounded-xl bg-white px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">Período</p>
                    <p className="mt-0.5 text-base font-black">{goalPeriodLabel(draft.targetPeriod)}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-950">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Quanto fica para cada</p>
                <div className="mt-3 space-y-2">
                  {previewFixedDistributionRows.length > 0 && (
                    <div className="space-y-2">
                      {previewFixedDistributionRows.map(row => (
                        <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-white/80 px-3 py-2.5">
                          <span className="font-semibold">{row.label}</span>
                          <span className="shrink-0 font-black">R$ {formatCurrencyBRL(row.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {previewReliefDistributionRows.length > 0 && (
                    <div className="space-y-2">
                      {previewReliefDistributionRows.map(row => (
                        <div key={row.label} className="rounded-xl border border-blue-100 bg-white/80 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold">{row.label}</span>
                            <span className="shrink-0 font-black">R$ {formatCurrencyBRL(row.amount)}</span>
                          </div>
                          {preview?.reliefWorkerSplit && (
                            <p className="mt-1 text-xs text-blue-700">
                              {previewReliefCoveredTurns ?? 0} de {preview.reliefWorkerSplit.totalPeriodTurns} turnos possíveis
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <span className="font-semibold">Liderança</span>
                    <span className="shrink-0 font-black">R$ {formatCurrencyBRL(preview?.leadershipBonus ?? 0)}</span>
                  </div>
                </div>

                {preview?.reliefWorkerSplit && (
                  <div className="mt-3 grid gap-2 text-xs text-emerald-800 sm:grid-cols-2">
                    <div className="rounded-xl bg-white/70 px-3 py-2">
                      Folguistas: R$ {formatCurrencyBRL(preview.reliefWorkerSplit.totalReliefWorkerBonus)}
                    </div>
                    <div className="rounded-xl bg-white/70 px-3 py-2">
                      Fixas: R$ {formatCurrencyBRL(preview.reliefWorkerSplit.remainingFixedBonus)}
                    </div>
                  </div>
                )}
              </div>

              {preview?.reliefWorkerSplit && (
                <div className="rounded-2xl border border-emerald-100 bg-white p-4 text-xs text-slate-600">
                  <p className="font-black text-slate-950">Metodologia da divisão</p>
                  <div className="mt-2 grid gap-2">
                    <div>
                      Folguista: {previewReliefCoveredTurns ?? 0} ÷ {preview.reliefWorkerSplit.totalPeriodTurns} x R$ {formatCurrencyBRL(preview.totalTeamBonus)} = R$ {formatCurrencyBRL(preview.reliefWorkerSplit.reliefWorkerBonus)}
                    </div>
                    <div>
                      Restante para fixas: R$ {formatCurrencyBRL(preview.totalTeamBonus)} - R$ {formatCurrencyBRL(preview.reliefWorkerSplit.totalReliefWorkerBonus)}
                    </div>
                    <div>
                      Cada fixa: R$ {formatCurrencyBRL(preview.reliefWorkerSplit.remainingFixedBonus)} ÷ {preview.reliefWorkerSplit.fixedCollaboratorCount}
                    </div>
                  </div>
                </div>
              )}

              {preview?.nextTier && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  <p className="font-bold">Próxima faixa: {preview.nextTier.label}</p>
                  <p>Faltam R$ {formatCurrencyBRL(preview.remainingToNextTier ?? 0)} para entrar nessa faixa.</p>
                </div>
              )}

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
