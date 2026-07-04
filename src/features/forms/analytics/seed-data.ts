import type {
  AnalyticsResultPolarity,
  AnalyticsSeverity,
  AnalyticsTargetType,
} from "./types";

export interface SeedAnalyticsDomain {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  order: number;
}

export const SEED_ANALYTICS_DOMAINS: readonly SeedAnalyticsDomain[] = [
  { id: "seed_dom_manutencao", name: "Manutenção", slug: "manutencao", color: "#E67E22", icon: "wrench", order: 10 },
  { id: "seed_dom_limpeza", name: "Limpeza", slug: "limpeza", color: "#3498DB", icon: "sparkles", order: 20 },
  { id: "seed_dom_uniforme", name: "Uniforme", slug: "uniforme", color: "#9B59B6", icon: "shirt", order: 30 },
  { id: "seed_dom_seguranca", name: "Segurança", slug: "seguranca", color: "#E74C3C", icon: "shield", order: 40 },
  { id: "seed_dom_qualidade", name: "Qualidade", slug: "qualidade", color: "#2ECC71", icon: "badge-check", order: 50 },
  { id: "seed_dom_temperatura", name: "Temperatura", slug: "temperatura", color: "#1ABC9C", icon: "thermometer", order: 60 },
  { id: "seed_dom_atendimento", name: "Atendimento", slug: "atendimento", color: "#F1C40F", icon: "message-circle", order: 70 },
  { id: "seed_dom_estoque", name: "Estoque", slug: "estoque", color: "#95A5A6", icon: "package", order: 80 },
  { id: "seed_dom_patrimonio", name: "Patrimônio", slug: "patrimonio", color: "#34495E", icon: "landmark", order: 90 },
  { id: "seed_dom_processos", name: "Processos", slug: "processos", color: "#7F8C8D", icon: "workflow", order: 100 },
];

export interface SeedAnalyticsResult {
  id: string;
  name: string;
  slug: string;
  polarity: AnalyticsResultPolarity;
  severity?: AnalyticsSeverity;
  counts_as_evaluation: boolean;
  counts_as_occurrence: boolean;
  counts_as_non_conformity: boolean;
  is_closing_result?: boolean;
  color: string;
  order: number;
}

export const SEED_ANALYTICS_RESULTS: readonly SeedAnalyticsResult[] = [
  {
    id: "seed_res_conforme",
    name: "Conforme",
    slug: "conforme",
    polarity: "positive",
    counts_as_evaluation: true,
    counts_as_occurrence: false,
    counts_as_non_conformity: false,
    color: "#2ECC71",
    order: 10,
  },
  {
    id: "seed_res_nao_conforme",
    name: "Não conforme",
    slug: "nao-conforme",
    polarity: "negative",
    counts_as_evaluation: true,
    counts_as_occurrence: true,
    counts_as_non_conformity: true,
    color: "#E74C3C",
    order: 20,
  },
  {
    id: "seed_res_atencao",
    name: "Atenção",
    slug: "atencao",
    polarity: "negative",
    severity: "low",
    counts_as_evaluation: true,
    counts_as_occurrence: true,
    counts_as_non_conformity: false,
    color: "#F39C12",
    order: 30,
  },
  {
    id: "seed_res_critico",
    name: "Crítico",
    slug: "critico",
    polarity: "negative",
    severity: "critical",
    counts_as_evaluation: true,
    counts_as_occurrence: true,
    counts_as_non_conformity: true,
    color: "#C0392B",
    order: 40,
  },
  {
    id: "seed_res_manutencao_necessaria",
    name: "Manutenção necessária",
    slug: "manutencao-necessaria",
    polarity: "corrective",
    severity: "medium",
    counts_as_evaluation: true,
    counts_as_occurrence: true,
    counts_as_non_conformity: true,
    color: "#E67E22",
    order: 50,
  },
  {
    id: "seed_res_fora_da_faixa",
    name: "Fora da faixa",
    slug: "fora-da-faixa",
    polarity: "negative",
    severity: "high",
    counts_as_evaluation: true,
    counts_as_occurrence: true,
    counts_as_non_conformity: true,
    color: "#D35400",
    order: 60,
  },
  {
    id: "seed_res_pendente",
    name: "Pendente",
    slug: "pendente",
    polarity: "neutral",
    counts_as_evaluation: false,
    counts_as_occurrence: true,
    counts_as_non_conformity: false,
    color: "#95A5A6",
    order: 70,
  },
  {
    id: "seed_res_resolvido",
    name: "Resolvido",
    slug: "resolvido",
    polarity: "corrective",
    counts_as_evaluation: false,
    counts_as_occurrence: true,
    counts_as_non_conformity: false,
    is_closing_result: true,
    color: "#27AE60",
    order: 80,
  },
];

export interface SeedAnalyticsCriterion {
  id: string;
  domain_id: string;
  name: string;
  slug: string;
  target_type?: AnalyticsTargetType;
  default_severity?: AnalyticsSeverity;
  default_result_positive_id: string;
  default_result_negative_id: string;
  order: number;
}

const POSITIVE_RESULT_ID = "seed_res_conforme";
const NEGATIVE_RESULT_ID = "seed_res_nao_conforme";
const MAINTENANCE_RESULT_ID = "seed_res_manutencao_necessaria";

function criterion(
  domainKey: string,
  slug: string,
  name: string,
  order: number,
  opts: Partial<
    Pick<
      SeedAnalyticsCriterion,
      "target_type" | "default_severity" | "default_result_negative_id"
    >
  > = {}
): SeedAnalyticsCriterion {
  return {
    id: `seed_crit_${domainKey}_${slug.replace(/-/g, "_")}`,
    domain_id: `seed_dom_${domainKey}`,
    name,
    slug,
    order,
    default_result_positive_id: POSITIVE_RESULT_ID,
    default_result_negative_id:
      opts.default_result_negative_id ?? NEGATIVE_RESULT_ID,
    target_type: opts.target_type,
    default_severity: opts.default_severity,
  };
}

export const SEED_ANALYTICS_CRITERIA: readonly SeedAnalyticsCriterion[] = [
  criterion("uniforme", "uniforme-completo", "Uniforme completo", 10, { target_type: "collaborator" }),
  criterion("uniforme", "camisa", "Camisa", 20, { target_type: "collaborator" }),
  criterion("uniforme", "calca", "Calça", 30, { target_type: "collaborator" }),
  criterion("uniforme", "avental", "Avental", 40, { target_type: "collaborator" }),
  criterion("uniforme", "touca", "Touca", 50, { target_type: "collaborator", default_severity: "high" }),
  criterion("uniforme", "sapato", "Sapato", 60, { target_type: "collaborator" }),
  criterion("uniforme", "cracha", "Crachá", 70, { target_type: "collaborator" }),
  criterion("uniforme", "estado-de-conservacao", "Estado de conservação", 80, { target_type: "collaborator" }),
  criterion("uniforme", "higiene-do-uniforme", "Higiene do uniforme", 90, { target_type: "collaborator", default_severity: "high" }),
  criterion("limpeza", "superficie-limpa", "Superfície limpa", 10, { target_type: "location" }),
  criterion("limpeza", "residuo-aparente", "Resíduo aparente", 20, { target_type: "location" }),
  criterion("limpeza", "organizacao", "Organização", 30, { target_type: "location" }),
  criterion("limpeza", "lixeira", "Lixeira", 40, { target_type: "location" }),
  criterion("limpeza", "vidro", "Vidro", 50, { target_type: "location" }),
  criterion("limpeza", "balcao", "Balcão", 60, { target_type: "location" }),
  criterion("limpeza", "piso", "Piso", 70, { target_type: "location" }),
  criterion("limpeza", "banheiro", "Banheiro", 80, { target_type: "location", default_severity: "high" }),
  criterion("limpeza", "odor", "Odor", 90, { target_type: "location" }),
  criterion("manutencao", "porta", "Porta", 10, { target_type: "location", default_result_negative_id: MAINTENANCE_RESULT_ID }),
  criterion("manutencao", "borracha-de-vedacao", "Borracha de vedação", 20, { target_type: "asset", default_result_negative_id: MAINTENANCE_RESULT_ID }),
  criterion("manutencao", "motor", "Motor", 30, { target_type: "asset", default_result_negative_id: MAINTENANCE_RESULT_ID, default_severity: "high" }),
  criterion("manutencao", "sensor", "Sensor", 40, { target_type: "asset", default_result_negative_id: MAINTENANCE_RESULT_ID }),
  criterion("manutencao", "iluminacao", "Iluminação", 50, { target_type: "location", default_result_negative_id: MAINTENANCE_RESULT_ID }),
  criterion("manutencao", "vazamento", "Vazamento", 60, { target_type: "asset", default_result_negative_id: MAINTENANCE_RESULT_ID, default_severity: "high" }),
  criterion("manutencao", "ruido", "Ruído", 70, { target_type: "asset", default_result_negative_id: MAINTENANCE_RESULT_ID }),
  criterion("manutencao", "painel-eletrico", "Painel elétrico", 80, { target_type: "asset", default_result_negative_id: MAINTENANCE_RESULT_ID, default_severity: "critical" }),
  criterion("manutencao", "estrutura", "Estrutura", 90, { target_type: "location", default_result_negative_id: MAINTENANCE_RESULT_ID }),
  criterion("temperatura", "fora-da-faixa", "Fora da faixa", 10, {
    target_type: "asset",
    default_severity: "critical",
    default_result_negative_id: "seed_res_fora_da_faixa",
  }),
];
