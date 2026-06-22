import type {
  HrFormQuestion,
  HrQuestionType,
  RecruitmentFormConfig,
} from "@/types";

export const TALENT_POOL_FORM_ID = "talent_pool";

export const RECRUITMENT_QUESTION_TYPES: HrQuestionType[] = [
  "text",
  "yes_no",
  "select",
  "multi_select",
  "number_range",
  "date",
  "location",
  "file_upload",
];

const DEFAULT_ROLE_OPTIONS = [
  "Atendente",
  "Operador(a) de loja",
  "Auxiliar de cozinha",
  "Caixa",
  "Gerente de unidade",
  "Estágio · Marketing",
];

export const DEFAULT_TALENT_POOL_FORM: RecruitmentFormConfig = {
  id: TALENT_POOL_FORM_ID,
  kind: "talent_pool",
  title: "Banco de talentos",
  description: "Conte um pouco sobre você para futuras oportunidades.",
  status: "published",
  questions: [
    {
      id: "preferred_role",
      text: "Cargo de interesse",
      type: "select",
      required: false,
      scored: false,
      weight: "medium",
      eliminatory: false,
      tags: ["talent_pool"],
      config: { options: DEFAULT_ROLE_OPTIONS },
    },
    {
      id: "preferred_unit",
      text: "Unidade preferida",
      type: "select",
      required: false,
      scored: false,
      weight: "medium",
      eliminatory: false,
      tags: ["talent_pool"],
      config: { source: "public_units" },
    },
    {
      id: "message",
      text: "Mensagem",
      type: "text",
      required: false,
      scored: false,
      weight: "medium",
      eliminatory: false,
      tags: ["talent_pool"],
      config: { multiline: true, placeholder: "Conta um pouco sobre você..." },
    },
  ],
  consentText: "Autorizo o tratamento dos meus dados para fins de recrutamento, conforme a LGPD.",
  submitLabel: "Enviar cadastro",
  version: 1,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
  publishedAt: new Date(0).toISOString(),
};

function cleanOptions(value: unknown) {
  return Array.isArray(value)
    ? value
      .filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      .map((option) => option.trim().slice(0, 120))
    : [];
}

function makeQuestionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeRecruitmentQuestions(value: unknown): HrFormQuestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): HrFormQuestion | null => {
      if (!item || typeof item !== "object") return null;
      const data = item as Record<string, unknown>;
      const text = typeof data.text === "string" ? data.text.trim().slice(0, 240) : "";
      const type = RECRUITMENT_QUESTION_TYPES.includes(data.type as HrQuestionType)
        ? data.type as HrQuestionType
        : "text";

      if (!text) return null;

      const rawConfig = data.config && typeof data.config === "object" && !Array.isArray(data.config)
        ? data.config as Record<string, unknown>
        : {};
      const options = cleanOptions(rawConfig.options);
      const config: Record<string, unknown> = {};
      if (options.length > 0) config.options = options;
      if (rawConfig.source === "public_units") config.source = "public_units";
      if (rawConfig.multiline === true) config.multiline = true;
      if (typeof rawConfig.placeholder === "string" && rawConfig.placeholder.trim()) {
        config.placeholder = rawConfig.placeholder.trim().slice(0, 180);
      }

      return {
        id: typeof data.id === "string" && data.id.trim() ? data.id.trim().slice(0, 120) : makeQuestionId(),
        text,
        type,
        required: data.required === true,
        scored: false,
        weight: data.weight === "low" || data.weight === "high" ? data.weight : "medium",
        eliminatory: data.eliminatory === true,
        tags: Array.isArray(data.tags)
          ? data.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
          : [],
        config: Object.keys(config).length > 0 ? config : undefined,
      };
    })
    .filter((item): item is HrFormQuestion => item !== null)
    .slice(0, 40);
}

export function normalizeRecruitmentFormConfig(
  value: unknown,
  fallback: RecruitmentFormConfig = DEFAULT_TALENT_POOL_FORM
): RecruitmentFormConfig {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const now = new Date().toISOString();
  const questions = normalizeRecruitmentQuestions(data.questions);

  return {
    id: typeof data.id === "string" && data.id.trim() ? data.id.trim() : fallback.id,
    kind: data.kind === "job_opening" ? "job_opening" : fallback.kind,
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 120) : fallback.title,
    description: typeof data.description === "string" ? data.description.trim().slice(0, 500) : fallback.description,
    status: data.status === "draft" ? "draft" : "published",
    questions: questions.length > 0 ? questions : fallback.questions,
    consentText: typeof data.consentText === "string" && data.consentText.trim()
      ? data.consentText.trim().slice(0, 500)
      : fallback.consentText,
    submitLabel: typeof data.submitLabel === "string" && data.submitLabel.trim()
      ? data.submitLabel.trim().slice(0, 80)
      : fallback.submitLabel,
    version: typeof data.version === "number" && Number.isFinite(data.version) ? data.version : fallback.version,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : fallback.createdAt,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : fallback.updatedBy,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : fallback.publishedAt ?? null,
  };
}

export function getRecruitmentQuestionOptions(question: HrFormQuestion, dynamicOptions?: { units?: string[] }) {
  if (question.config?.source === "public_units") return dynamicOptions?.units ?? [];
  const options = question.config?.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
    : [];
}

export function hasRecruitmentAnswer(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
