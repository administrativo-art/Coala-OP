import type {
  HrFormQuestion,
  HrQuestionWeight,
  HrQuestionType,
  RecruitmentQuestionCondition,
  RecruitmentQuestionConditionOperator,
  RecruitmentQuestionScoringConfig,
  RecruitmentQuestionScoringUse,
  RecruitmentScoringSourceLayer,
  RecruitmentFormConfig,
} from "@/types";

export const TALENT_POOL_FORM_ID = "talent_pool";
export const DEFAULT_RECRUITMENT_SECTION_ID = "default";

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

export function makeRecruitmentSectionId(title: string) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || DEFAULT_RECRUITMENT_SECTION_ID;
}

function cleanSectionTitle(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function cleanSectionId(value: unknown, sectionTitle: string) {
  const id = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return id || (sectionTitle ? makeRecruitmentSectionId(sectionTitle) : "");
}

function cleanSectionOrder(value: unknown) {
  const order = Number(value);
  return Number.isInteger(order) && order >= 0 ? order : undefined;
}

function cleanQuestionReferenceId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function cleanSubquestionOrder(value: unknown) {
  const order = Number(value);
  return Number.isInteger(order) && order >= 0 ? order : undefined;
}

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
      active: true,
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
      active: true,
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
      active: true,
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

function cleanWeight(value: unknown): HrQuestionWeight {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : "medium";
}

function cleanScoringUse(value: unknown): RecruitmentQuestionScoringUse | undefined {
  return value === "informational" || value === "scored" || value === "eliminatory" ? value : undefined;
}

function cleanSourceLayer(value: unknown): RecruitmentScoringSourceLayer | undefined {
  return value === "role" || value === "function" || value === "opening" ? value : undefined;
}

function cleanAnswerFactors(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, factor]) => {
      const numeric = Number(factor);
      if (!Number.isFinite(numeric)) return null;
      return [key.trim().slice(0, 160), Math.max(0, Math.min(1, numeric))] as const;
    })
    .filter((entry): entry is readonly [string, number] => !!entry && entry[0].length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function cleanConditionOperator(value: unknown): RecruitmentQuestionConditionOperator | undefined {
  return value === "equals" ||
    value === "not_equals" ||
    value === "includes" ||
    value === "answered" ||
    value === "not_answered"
    ? value
    : undefined;
}

function cleanConditions(value: unknown): RecruitmentQuestionCondition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const conditions = value
    .map((entry): RecruitmentQuestionCondition | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const data = entry as Record<string, unknown>;
      const questionId = typeof data.questionId === "string" ? data.questionId.trim().slice(0, 120) : "";
      const operator = cleanConditionOperator(data.operator);
      if (!questionId || !operator) return null;
      return {
        questionId,
        operator,
        value: data.value,
      };
    })
    .filter((entry): entry is RecruitmentQuestionCondition => entry !== null)
    .slice(0, 5);
  return conditions.length > 0 ? conditions : undefined;
}

function cleanScoring(value: unknown): RecruitmentQuestionScoringConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const scoring: RecruitmentQuestionScoringConfig = {};
  const criterionCode = typeof data.criterionCode === "string" ? data.criterionCode.trim().toUpperCase().slice(0, 80) : "";
  const criterionLabel = typeof data.criterionLabel === "string" ? data.criterionLabel.trim().slice(0, 120) : "";
  const groupId = typeof data.groupId === "string" ? data.groupId.trim().slice(0, 80) : "";
  const groupName = typeof data.groupName === "string" ? data.groupName.trim().slice(0, 80) : "";
  const justification = typeof data.justification === "string" ? data.justification.trim().slice(0, 500) : "";
  if (criterionCode) scoring.criterionCode = criterionCode;
  if (criterionLabel) scoring.criterionLabel = criterionLabel;
  if (
    data.category === "availability" ||
    data.category === "experience" ||
    data.category === "technical" ||
    data.category === "behavioral" ||
    data.category === "interest" ||
    data.category === "retention" ||
    data.category === "differentials"
  ) {
    scoring.category = data.category;
  }
  if (groupId) scoring.groupId = groupId;
  if (groupName) scoring.groupName = groupName;
  const use = cleanScoringUse(data.use);
  if (use) scoring.use = use;
  scoring.importance = cleanWeight(data.importance);
  if (justification) scoring.justification = justification;
  const sourceLayer = cleanSourceLayer(data.sourceLayer);
  if (sourceLayer) scoring.sourceLayer = sourceLayer;
  const answerFactors = cleanAnswerFactors(data.answerFactors);
  if (answerFactors) scoring.answerFactors = answerFactors;
  if (typeof data.finalWeight === "number" && Number.isFinite(data.finalWeight)) {
    scoring.finalWeight = data.finalWeight;
  }
  return Object.keys(scoring).length > 0 ? scoring : undefined;
}

function makeQuestionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeRecruitmentQuestions(value: unknown): HrFormQuestion[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
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
      const scoring = cleanScoring(data.scoring);
      const sectionTitle = cleanSectionTitle(data.sectionTitle);
      const sectionId = cleanSectionId(data.sectionId, sectionTitle);
      const sectionOrder = cleanSectionOrder(data.sectionOrder);
      const parentQuestionId = cleanQuestionReferenceId(data.parentQuestionId);
      const subquestionOrder = cleanSubquestionOrder(data.subquestionOrder);
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
        sectionId: sectionId || undefined,
        sectionTitle: sectionTitle || undefined,
        sectionOrder,
        parentQuestionId: parentQuestionId || undefined,
        subquestionOrder,
        required: data.required === true,
        active: data.active !== false,
        scored: data.scored === true || scoring?.use === "scored",
        weight: cleanWeight(data.weight ?? scoring?.importance),
        eliminatory: data.eliminatory === true || scoring?.use === "eliminatory",
        expectedAnswer: data.expectedAnswer === undefined ? undefined : data.expectedAnswer,
        tags: Array.isArray(data.tags)
          ? data.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
          : [],
        config: Object.keys(config).length > 0 ? config : undefined,
        conditions: cleanConditions(data.conditions),
        scoring,
      };
    })
    .filter((item): item is HrFormQuestion => item !== null)
    .slice(0, 40);

  const indexById = new Map(normalized.map((question, index) => [question.id, index]));
  return normalized.map((question, index) => {
    const parentIndex = question.parentQuestionId ? indexById.get(question.parentQuestionId) : undefined;
    const hasValidParent = parentIndex !== undefined && parentIndex < index;
    const conditions = question.conditions?.filter((condition) => {
      const conditionIndex = indexById.get(condition.questionId);
      return conditionIndex !== undefined && conditionIndex < index;
    });

    return {
      ...question,
      parentQuestionId: hasValidParent ? question.parentQuestionId : undefined,
      subquestionOrder: hasValidParent ? question.subquestionOrder : undefined,
      conditions: conditions && conditions.length > 0 ? conditions : undefined,
    };
  });
}

export type RecruitmentQuestionSection = {
  id: string;
  title: string;
  order: number;
  firstIndex: number;
  isFallback: boolean;
  questions: HrFormQuestion[];
};

export type RecruitmentQuestionTreeNode = {
  question: HrFormQuestion;
  subquestions: RecruitmentQuestionTreeNode[];
};

export function buildRecruitmentQuestionTree(questions: HrFormQuestion[]): RecruitmentQuestionTreeNode[] {
  const nodes = new Map<string, RecruitmentQuestionTreeNode>();
  const indexById = new Map<string, number>();

  questions.forEach((question, index) => {
    nodes.set(question.id, { question, subquestions: [] });
    indexById.set(question.id, index);
  });

  const roots: RecruitmentQuestionTreeNode[] = [];
  questions.forEach((question, index) => {
    const node = nodes.get(question.id);
    if (!node) return;
    const parentId = question.parentQuestionId;
    const parentIndex = parentId ? indexById.get(parentId) : undefined;
    const parent = parentId && parentIndex !== undefined && parentIndex < index
      ? nodes.get(parentId)
      : undefined;

    if (parent) {
      parent.subquestions.push(node);
      return;
    }

    roots.push(node);
  });

  const sortNodes = (items: RecruitmentQuestionTreeNode[]) => {
    items.sort((a, b) => {
      const orderA = a.question.subquestionOrder ?? indexById.get(a.question.id) ?? 0;
      const orderB = b.question.subquestionOrder ?? indexById.get(b.question.id) ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (indexById.get(a.question.id) ?? 0) - (indexById.get(b.question.id) ?? 0);
    });
    items.forEach((item) => sortNodes(item.subquestions));
  };

  sortNodes(roots);
  return roots;
}

export function groupRecruitmentQuestionsBySection(
  questions: HrFormQuestion[],
  fallbackTitle: string
): RecruitmentQuestionSection[] {
  const fallback = fallbackTitle.trim() || "Perguntas";
  const groups = new Map<string, RecruitmentQuestionSection>();
  const questionsById = new Map(questions.map((question) => [question.id, question]));

  questions.forEach((question, index) => {
    const parent = question.parentQuestionId ? questionsById.get(question.parentQuestionId) : undefined;
    const sectionTitle = cleanSectionTitle(question.sectionTitle) || cleanSectionTitle(parent?.sectionTitle);
    const isFallback = !sectionTitle;
    const title = sectionTitle || fallback;
    const id = cleanSectionId(question.sectionId || parent?.sectionId, sectionTitle) || `${DEFAULT_RECRUITMENT_SECTION_ID}-${makeRecruitmentSectionId(fallback)}`;
    const order = question.sectionOrder ?? parent?.sectionOrder ?? index;
    const existing = groups.get(id);

    if (existing) {
      existing.questions.push(question);
      existing.firstIndex = Math.min(existing.firstIndex, index);
      existing.order = Math.min(existing.order, order);
      return;
    }

    groups.set(id, {
      id,
      title,
      order,
      firstIndex: index,
      isFallback,
      questions: [question],
    });
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.firstIndex - b.firstIndex;
  });
}

export function mergeRecruitmentQuestionModels(
  roleQuestions: unknown,
  functionQuestions?: unknown
) {
  const merged = normalizeRecruitmentQuestions(roleQuestions).map(question => ({
    ...question,
    tags: Array.from(new Set([...(question.tags ?? []), "role"])),
    scoring: { ...(question.scoring ?? {}), sourceLayer: question.scoring?.sourceLayer ?? "role" as const },
  }));
  const functionModel = normalizeRecruitmentQuestions(functionQuestions).map(question => ({
    ...question,
    tags: Array.from(new Set([...(question.tags ?? []), "function"])),
    scoring: { ...(question.scoring ?? {}), sourceLayer: question.scoring?.sourceLayer ?? "function" as const },
  }));

  for (const question of functionModel) {
    const existingIndex = merged.findIndex(item => item.id === question.id);
    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        ...question,
        tags: Array.from(new Set([...(existing.tags ?? []), ...(question.tags ?? [])])),
      };
    } else {
      merged.push(question);
    }
  }

  return normalizeRecruitmentQuestions(merged);
}

export function resolveJobOpeningQuestions(
  openingQuestions: unknown,
  roleQuestions: unknown,
  functionQuestions?: unknown
) {
  const customQuestions = normalizeRecruitmentQuestions(openingQuestions);
  return customQuestions.length > 0
    ? customQuestions
    : mergeRecruitmentQuestionModels(roleQuestions, functionQuestions);
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

export function hydrateRecruitmentQuestionDynamicOptions(
  questions: HrFormQuestion[],
  dynamicOptions?: { units?: string[] }
) {
  return questions.map((question) => {
    if (question.config?.source !== "public_units") return question;
    return {
      ...question,
      config: {
        ...(question.config ?? {}),
        options: dynamicOptions?.units ?? [],
      },
    };
  });
}

function filterQuestionsWithVisibleParents(questions: HrFormQuestion[]) {
  const visibleIds = new Set<string>();
  const visibleQuestions: HrFormQuestion[] = [];

  for (const question of questions) {
    if (question.parentQuestionId && !visibleIds.has(question.parentQuestionId)) continue;
    visibleQuestions.push(question);
    visibleIds.add(question.id);
  }

  return visibleQuestions;
}

export function getPublicRecruitmentQuestions(questions: HrFormQuestion[]) {
  return filterQuestionsWithVisibleParents(questions.filter((question) => question.active !== false));
}

function hasConditionalAnswer(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizedConditionValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  return value;
}

function answerMatchesCondition(answer: unknown, condition: RecruitmentQuestionCondition) {
  const expected = normalizedConditionValue(condition.value);
  if (condition.operator === "answered") return hasConditionalAnswer(answer);
  if (condition.operator === "not_answered") return !hasConditionalAnswer(answer);
  if (condition.operator === "includes") {
    const values = Array.isArray(answer) ? answer.map(normalizedConditionValue) : [normalizedConditionValue(answer)];
    return values.some((value) => value === expected);
  }
  const actual = normalizedConditionValue(answer);
  const matches = actual === expected;
  return condition.operator === "not_equals" ? !matches : matches;
}

export function questionConditionsMatch(
  question: HrFormQuestion,
  answers: Record<string, unknown>,
  questionIndexById?: Map<string, number>
) {
  const conditions = question.conditions ?? [];
  if (conditions.length === 0) return true;
  const currentIndex = questionIndexById?.get(question.id);
  if (
    currentIndex !== undefined &&
    conditions.some((condition) => {
      const conditionIndex = questionIndexById?.get(condition.questionId);
      return conditionIndex === undefined || conditionIndex >= currentIndex;
    })
  ) {
    return false;
  }
  return conditions.every((condition) => answerMatchesCondition(answers[condition.questionId], condition));
}

export function getConditionallyVisibleRecruitmentQuestions(
  questions: HrFormQuestion[],
  answers: Record<string, unknown>
) {
  const questionIndexById = new Map(questions.map((question, index) => [question.id, index]));
  return filterQuestionsWithVisibleParents(
    getPublicRecruitmentQuestions(questions).filter((question) => questionConditionsMatch(question, answers, questionIndexById))
  );
}

export function hasRecruitmentAnswer(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
