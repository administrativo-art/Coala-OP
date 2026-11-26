import { calculateTieredGoalBonus, DEFAULT_KIOSK_MEDIUM_GOAL_METHOD } from '@/lib/goal-methods';

/** Dados didáticos do guia. Nenhum valor daqui é gravado como meta ou pagamento. */
export interface MetaConfig {
  nome: string;
  valor: number;
  premiacao: number;
  percentual: number;
}

export interface ConfigBonificacao {
  metas: MetaConfig[];
  divisorLideranca: number;
}

export const CONFIG_PADRAO: ConfigBonificacao = {
  metas: [
    { nome: 'Meta Alvo', valor: 29000, premiacao: 100, percentual: 8 },
    { nome: 'Meta UP', valor: 32000, premiacao: 100, percentual: 10 },
    { nome: 'Meta TOP', valor: 35000, premiacao: 100, percentual: 12 },
  ],
  divisorLideranca: 3,
};

export interface EntradaSimulacao {
  faturamento: number;
  diasMes: number;
  diasFolguista: number;
  pessoasFixas: number;
}

export interface ResultadoMeta {
  nome: string;
  valor: number;
  percentual: number;
  atingida: boolean;
  faltam: number;
  inicio: number;
  fim: number | null;
  vendidoNoPedaco: number;
  pedacoCompleto: boolean;
  premiacaoConfig: number;
  premiacao: number;
  extra: number;
  total: number;
}

export interface ResultadoSimulacao {
  faturamento: number;
  metas: ResultadoMeta[];
  metasAtingidas: number;
  proximaMeta: { nome: string; valor: number; faltam: number } | null;
  premioEquipe: number;
  adicionalLideranca: number;
  diasMes: number;
  diasFolguista: number;
  valorPorDia: number;
  folguista: number;
  sobra: number;
  pessoasFixas: number;
  porFixa: number;
  totalPago: number;
  diferencaArredondamento: number;
}

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const integerBetween = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(Number(value) || 0)));

/** Adapta o exemplo interativo ao mesmo motor usado no fechamento oficial. */
export function calcularBonificacao(
  entrada: EntradaSimulacao,
  config: ConfigBonificacao = CONFIG_PADRAO,
): ResultadoSimulacao {
  const faturamento = Math.max(0, money(entrada.faturamento));
  const diasMes = integerBetween(entrada.diasMes, 1, 31);
  const diasFolguista = integerBetween(entrada.diasFolguista, 0, diasMes);
  const pessoasFixas = integerBetween(entrada.pessoasFixas, 0, 99);
  const metasConfig = [...config.metas].sort((a, b) => a.valor - b.valor);
  const method = {
    ...DEFAULT_KIOSK_MEDIUM_GOAL_METHOD,
    tiers: metasConfig.map((meta, index) => ({
      id: `guide-${index}`,
      label: meta.nome,
      fromAmount: meta.valor,
      toAmount: metasConfig[index + 1]?.valor ?? null,
      displayTargetAmount: meta.valor,
      fixedBonusAmount: meta.premiacao,
      excessPercent: meta.percentual,
    })),
    leadershipBonus: {
      ...DEFAULT_KIOSK_MEDIUM_GOAL_METHOD.leadershipBonus,
      factorDenominator: Math.max(1, Number(config.divisorLideranca) || 3),
    },
  };
  const official = calculateTieredGoalBonus(method, faturamento, pessoasFixas + 1, {
    fixedCollaboratorCount: pessoasFixas,
    reliefWorkerCount: 1,
    reliefWorkerBasis: 'days',
    reliefWorkerCoveredDaysByPerson: [diasFolguista],
    totalPeriodDays: diasMes,
  });
  if (!official) throw new Error('Método de bonificação indisponível.');
  const achieved = new Map(official.achievedTiers.map((item) => [item.tier.id, item]));
  const metas: ResultadoMeta[] = metasConfig.map((meta, index) => {
    const next = metasConfig[index + 1];
    const item = achieved.get(`guide-${index}`);
    return {
      nome: meta.nome,
      valor: meta.valor,
      percentual: meta.percentual,
      atingida: Boolean(item),
      faltam: money(Math.max(meta.valor - faturamento, 0)),
      inicio: meta.valor,
      fim: next?.valor ?? null,
      vendidoNoPedaco: item?.excessAmount ?? 0,
      pedacoCompleto: Boolean(next && faturamento >= next.valor),
      premiacaoConfig: meta.premiacao,
      premiacao: item?.fixedBonusAmount ?? 0,
      extra: item?.variableBonusAmount ?? 0,
      total: item?.totalBonusAmount ?? 0,
    };
  });
  const premioEquipe = official.totalTeamBonus;
  const folguista = official.reliefWorkerSplit?.reliefWorkerBonus ?? 0;
  const sobra = money(premioEquipe - folguista);
  const porFixa = pessoasFixas ? official.reliefWorkerSplit?.perFixedCollaboratorBonus ?? 0 : 0;
  const next = metas.find((meta) => !meta.atingida);
  return {
    faturamento,
    metas,
    metasAtingidas: metas.filter((meta) => meta.atingida).length,
    proximaMeta: next ? { nome: next.nome, valor: next.valor, faltam: next.faltam } : null,
    premioEquipe,
    adicionalLideranca: official.leadershipBonus,
    diasMes,
    diasFolguista,
    valorPorDia: money(premioEquipe / diasMes),
    folguista,
    sobra,
    pessoasFixas,
    porFixa,
    totalPago: money(premioEquipe + official.leadershipBonus),
    diferencaArredondamento: money(premioEquipe - folguista - porFixa * pessoasFixas),
  };
}

export function formatarReais(value: number, options: { sempreDuasCasas?: boolean } = {}) {
  return money(value).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: options.sempreDuasCasas ? 2 : 0,
    maximumFractionDigits: 2,
  }).replace(/\u00a0/g, ' ');
}
