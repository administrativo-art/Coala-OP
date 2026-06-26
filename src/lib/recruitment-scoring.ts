import type {
  HrFormQuestion,
  HrQuestionWeight,
  RecruitmentCompositionPreset,
  RecruitmentCriterionCategory,
  RecruitmentEligibilityStatus,
  RecruitmentQuestionScore,
  RecruitmentQuestionScoringConfig,
  RecruitmentQuestionScoringUse,
  RecruitmentScoreResult,
  RecruitmentScoringAlert,
  RecruitmentScoringSnapshot,
  RecruitmentScoringSourceLayer,
} from "@/types";

export const RECRUITMENT_SCORING_VERSION = 1;
export const RECRUITMENT_MAX_QUESTION_POINTS = 20;

export const RECRUITMENT_IMPORTANCE_VALUES: Record<HrQuestionWeight, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const RECRUITMENT_COMPOSITION_PRESETS: Record<RecruitmentCompositionPreset, {
  label: string;
  role: number;
  function: number;
}> = {
  role_100: { label: "Cargo 100%", role: 100, function: 0 },
  role_70_function_30: { label: "Cargo 70% / Função 30%", role: 70, function: 30 },
  role_60_function_40: { label: "Cargo 60% / Função 40%", role: 60, function: 40 },
  role_50_function_50: { label: "Cargo 50% / Função 50%", role: 50, function: 50 },
};

export const RECRUITMENT_CATEGORY_LABELS: Record<RecruitmentCriterionCategory, string> = {
  availability: "Disponibilidade",
  experience: "Experiência",
  technical: "Técnica/Função",
  behavioral: "Comportamental",
  interest: "Interesse",
  retention: "Permanência esperada",
  differentials: "Diferenciais",
};

export const RECRUITMENT_CATEGORY_BASE_WEIGHTS: Record<RecruitmentCriterionCategory, number> = {
  availability: 25,
  experience: 20,
  technical: 20,
  behavioral: 15,
  interest: 10,
  retention: 5,
  differentials: 5,
};

export const RECRUITMENT_CATEGORY_CAPS: Partial<Record<RecruitmentCriterionCategory, number>> = {
  behavioral: 30,
  differentials: 15,
};

export const STANDARD_RECRUITMENT_CRITERIA: Array<{
  code: string;
  label: string;
  category: RecruitmentCriterionCategory;
  allowedUses: RecruitmentQuestionScoringUse[];
}> = [
  { code: "DISP_ESCALA", label: "Disponibilidade para escala", category: "availability", allowedUses: ["eliminatory", "scored", "informational"] },
  { code: "DISP_DOMINGO", label: "Disponibilidade para domingo/feriado", category: "availability", allowedUses: ["eliminatory", "scored", "informational"] },
  { code: "DISP_HORARIO", label: "Disponibilidade para horário da vaga", category: "availability", allowedUses: ["eliminatory", "scored", "informational"] },
  { code: "VIAB_DESLOCAMENTO", label: "Viabilidade de deslocamento", category: "availability", allowedUses: ["eliminatory", "scored", "informational"] },
  { code: "EXP_ATENDIMENTO", label: "Experiência com atendimento", category: "experience", allowedUses: ["scored", "informational"] },
  { code: "EXP_CAIXA", label: "Experiência com caixa", category: "technical", allowedUses: ["scored", "informational"] },
  { code: "EXP_OPERACIONAL", label: "Experiência operacional", category: "experience", allowedUses: ["scored", "informational"] },
  { code: "COMUNICACAO", label: "Comunicação", category: "behavioral", allowedUses: ["scored", "informational"] },
  { code: "INTERESSE", label: "Interesse real na vaga", category: "interest", allowedUses: ["scored", "informational"] },
  { code: "PERMANENCIA_ESPERADA", label: "Aderência à permanência esperada na vaga", category: "retention", allowedUses: ["scored", "informational"] },
  { code: "CONFERENCIA", label: "Atenção e conferência", category: "technical", allowedUses: ["scored", "informational"] },
  { code: "DIFERENCIAL", label: "Diferencial relevante para a vaga", category: "differentials", allowedUses: ["scored", "informational"] },
];

export const RECRUITMENT_DEFAULT_RUBRICS: Partial<Record<string, RecruitmentQuestionScoringConfig["rubric"]>> = {
  COMUNICACAO: [
    { factor: 0, label: "Insuficiente", description: "Resposta não permite avaliar clareza, cordialidade ou objetividade." },
    { factor: 0.4, label: "Baixa", description: "Comunicação pouco clara ou pouco adequada ao atendimento." },
    { factor: 0.7, label: "Adequada", description: "Comunicação clara, com pequenos pontos de ajuste." },
    { factor: 1, label: "Forte", description: "Comunicação clara, objetiva, cordial e alinhada à rotina da vaga." },
  ],
  INTERESSE: [
    { factor: 0, label: "Sem aderência", description: "Não demonstra interesse real nas condições apresentadas." },
    { factor: 0.4, label: "Baixo", description: "Interesse frágil ou condicionado a pontos centrais da vaga." },
    { factor: 0.7, label: "Adequado", description: "Interesse compatível com a vaga e suas condições." },
    { factor: 1, label: "Forte", description: "Interesse consistente, específico e alinhado ao cargo/função." },
  ],
  PERMANENCIA_ESPERADA: [
    { factor: 0, label: "Incompatível", description: "Não aceita ou não demonstra aderência à permanência mínima esperada." },
    { factor: 0.4, label: "Baixa", description: "Aderência incerta à permanência esperada para a vaga." },
    { factor: 0.7, label: "Adequada", description: "Aderência razoável à permanência esperada." },
    { factor: 1, label: "Forte", description: "Aderência clara à permanência esperada e às condições da vaga." },
  ],
};

const CRITERIA_BY_CODE = new Map(STANDARD_RECRUITMENT_CRITERIA.map((criterion) => [criterion.code, criterion]));

const SENSITIVE_PATTERNS = [
  /idade/i,
  /data\s+de\s+nascimento/i,
  /estado\s+civil/i,
  /filh[oa]s?/i,
  /relig/i,
  /apar[eê]ncia/i,
  /g[eê]nero/i,
  /sexo/i,
  /endere[cç]o\s+completo/i,
  /bairro/i,
  /ra[cç]a/i,
  /cor/i,
  /sa[uú]de/i,
  /defici[eê]ncia/i,
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanText(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clampFactor(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeAnswerFactors(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, factor]) => [String(key), clampFactor(factor)] as const)
    .filter(([key]) => key.trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getQuestionLayer(question: HrFormQuestion, fallback: RecruitmentScoringSourceLayer = "role"): RecruitmentScoringSourceLayer {
  if (question.scoring?.sourceLayer) return question.scoring.sourceLayer;
  if (question.tags?.includes("function")) return "function";
  if (question.tags?.includes("role")) return "role";
  if (question.tags?.includes("opening")) return "opening";
  return fallback;
}

function normalizeQuestionUse(question: HrFormQuestion): RecruitmentQuestionScoringUse {
  if (question.eliminatory || question.scoring?.use === "eliminatory") return "eliminatory";
  if (question.scored || question.scoring?.use === "scored") return "scored";
  return question.scoring?.use === "informational" ? "informational" : "informational";
}

export function normalizeQuestionScoring(
  question: HrFormQuestion,
  fallbackLayer: RecruitmentScoringSourceLayer = "role"
): RecruitmentQuestionScoringConfig {
  const use = normalizeQuestionUse(question);
  const rawCode = cleanText(question.scoring?.criterionCode, 80).toUpperCase();
  const criterion = rawCode ? CRITERIA_BY_CODE.get(rawCode) : undefined;
  const category = question.scoring?.category ?? criterion?.category ?? "experience";
  const criterionLabel = cleanText(question.scoring?.criterionLabel, 120) || criterion?.label || "Critério da vaga";
  const groupName = cleanText(question.scoring?.groupName, 80) || RECRUITMENT_CATEGORY_LABELS[category];
  const importance = question.scoring?.importance ?? question.weight ?? "medium";

  return {
    criterionCode: rawCode || undefined,
    criterionLabel,
    category,
    groupId: cleanText(question.scoring?.groupId, 80) || groupName.toLowerCase().replace(/[^a-z0-9]+/gi, "-"),
    groupName,
    use,
    importance,
    justification: cleanText(question.scoring?.justification, 500) || undefined,
    sourceLayer: getQuestionLayer(question, fallbackLayer),
    answerFactors: normalizeAnswerFactors(question.scoring?.answerFactors),
    rubric: Array.isArray(question.scoring?.rubric) ? question.scoring.rubric : RECRUITMENT_DEFAULT_RUBRICS[rawCode],
  };
}

function distributionWithCap(items: Array<{ id: string; value: number }>, total: number, cap: number) {
  const remaining = new Set(items.map((item) => item.id));
  const result = Object.fromEntries(items.map((item) => [item.id, 0])) as Record<string, number>;
  let remainingTotal = total;

  while (remaining.size > 0) {
    const active = items.filter((item) => remaining.has(item.id));
    const valueTotal = active.reduce((sum, item) => sum + item.value, 0) || active.length || 1;
    let cappedThisRound = false;

    for (const item of active) {
      const share = remainingTotal * (item.value / valueTotal);
      if (share > cap) {
        result[item.id] = cap;
        remainingTotal -= cap;
        remaining.delete(item.id);
        cappedThisRound = true;
      }
    }

    if (!cappedThisRound) {
      for (const item of active) {
        result[item.id] = remainingTotal * (item.value / valueTotal);
        remaining.delete(item.id);
      }
    }
  }

  return result;
}

function getPresetWeights(preset: RecruitmentCompositionPreset, hasFunction: boolean) {
  const selected = hasFunction ? RECRUITMENT_COMPOSITION_PRESETS[preset] : RECRUITMENT_COMPOSITION_PRESETS.role_100;
  return {
    role: selected.role,
    function: selected.function,
    opening: 0,
  } satisfies Record<RecruitmentScoringSourceLayer, number>;
}

function dedupeQuestions(questions: HrFormQuestion[], scoringById: Record<string, RecruitmentQuestionScoringConfig>) {
  const byCriterion = new Map<string, HrFormQuestion[]>();
  const activeScored = questions.filter((question) => {
    const scoring = scoringById[question.id];
    return question.active !== false && scoring?.use === "scored" && !!scoring.criterionCode;
  });

  for (const question of activeScored) {
    const code = scoringById[question.id]?.criterionCode;
    if (!code) continue;
    byCriterion.set(code, [...(byCriterion.get(code) ?? []), question]);
  }

  const duplicateOf: Record<string, string> = {};
  const duplicates: RecruitmentScoringSnapshot["duplicateCriteria"] = [];
  const layerPriority: Record<RecruitmentScoringSourceLayer, number> = { opening: 3, function: 2, role: 1 };

  for (const [criterionCode, items] of byCriterion.entries()) {
    if (items.length <= 1) continue;
    const kept = [...items].sort((a, b) => {
      const layerA = scoringById[a.id]?.sourceLayer ?? "role";
      const layerB = scoringById[b.id]?.sourceLayer ?? "role";
      return layerPriority[layerB] - layerPriority[layerA];
    })[0];
    for (const item of items) {
      if (item.id !== kept.id) duplicateOf[item.id] = kept.id;
    }
    duplicates.push({
      criterionCode,
      keptQuestionId: kept.id,
      mergedQuestionIds: items.filter((item) => item.id !== kept.id).map((item) => item.id),
      strategy: "Mantida a versão mais específica; peso da duplicada redistribuído na própria camada/grupo.",
    });
  }

  return { duplicateOf, duplicates };
}

export function applyRecruitmentScoring(
  inputQuestions: HrFormQuestion[],
  preset: RecruitmentCompositionPreset = "role_70_function_30"
): { questions: HrFormQuestion[]; snapshot: RecruitmentScoringSnapshot } {
  const now = new Date().toISOString();
  const questions = inputQuestions.map((question) => ({
    ...question,
    active: question.active !== false,
    scoring: normalizeQuestionScoring(question),
  }));
  const scoringById = Object.fromEntries(questions.map((question) => [question.id, question.scoring!]));
  const { duplicateOf, duplicates } = dedupeQuestions(questions, scoringById);
  const hasFunction = questions.some((question) => question.active !== false && scoringById[question.id]?.sourceLayer === "function");
  const layerWeights = getPresetWeights(preset, hasFunction);
  const questionWeights: RecruitmentScoringSnapshot["questionWeights"] = {};
  const alerts: RecruitmentScoringAlert[] = [];

  const scoredQuestions = questions.filter((question) =>
    question.active !== false &&
    scoringById[question.id]?.use === "scored" &&
    !duplicateOf[question.id]
  );

  for (const question of questions) {
    const scoring = scoringById[question.id];
    if (!scoring) continue;
    if ((scoring.use === "eliminatory" || scoring.importance === "high" || scoring.importance === "critical") && !scoring.justification) {
      alerts.push({
        code: "missing_justification",
        severity: "blocking",
        questionId: question.id,
        criterionCode: scoring.criterionCode,
        message: `Critério ${scoring.criterionLabel ?? question.text} exige justificativa.`,
      });
    }
    if ((scoring.use === "scored" || scoring.use === "eliminatory") && SENSITIVE_PATTERNS.some((pattern) => pattern.test(question.text))) {
      alerts.push({
        code: "sensitive_criterion",
        severity: "blocking",
        questionId: question.id,
        criterionCode: scoring.criterionCode,
        message: `A pergunta "${question.text}" parece usar dado sensível ou discriminatório e não deve pontuar.`,
      });
    }
    const criterion = scoring.criterionCode ? CRITERIA_BY_CODE.get(scoring.criterionCode) : undefined;
    if (criterion && !criterion.allowedUses.includes(scoring.use ?? "informational")) {
      alerts.push({
        code: "criterion_use_not_allowed",
        severity: "blocking",
        questionId: question.id,
        criterionCode: scoring.criterionCode,
        message: `${criterion.label} não permite uso ${scoring.use}.`,
      });
    }
  }

  for (const layer of ["role", "function", "opening"] as RecruitmentScoringSourceLayer[]) {
    const layerQuestions = scoredQuestions.filter((question) => scoringById[question.id]?.sourceLayer === layer);
    const layerTotal = layerWeights[layer];
    if (layerQuestions.length === 0 || layerTotal <= 0) continue;

    const groups = new Map<string, { value: number; questions: HrFormQuestion[] }>();
    for (const question of layerQuestions) {
      const scoring = scoringById[question.id]!;
      const groupKey = `${scoring.category ?? "experience"}:${scoring.groupId ?? scoring.groupName ?? "default"}`;
      const current = groups.get(groupKey) ?? { value: RECRUITMENT_CATEGORY_BASE_WEIGHTS[scoring.category ?? "experience"], questions: [] };
      current.questions.push(question);
      groups.set(groupKey, current);
    }

    const groupValueTotal = Array.from(groups.values()).reduce((sum, group) => sum + group.value, 0) || groups.size || 1;
    for (const group of groups.values()) {
      const groupTotal = layerTotal * (group.value / groupValueTotal);
      const groupWeights = distributionWithCap(
        group.questions.map((question) => ({
          id: question.id,
          value: RECRUITMENT_IMPORTANCE_VALUES[scoringById[question.id]?.importance ?? "medium"],
        })),
        groupTotal,
        RECRUITMENT_MAX_QUESTION_POINTS
      );
      for (const question of group.questions) {
        const scoring = scoringById[question.id]!;
        questionWeights[question.id] = {
          ...scoring,
          finalWeight: round(groupWeights[question.id] ?? 0),
          layerWeight: layerWeights[layer],
          originalLayerWeight: layerWeights[layer],
          duplicateOf: null,
          duplicateStrategy: null,
          alerts: [],
        };
      }
    }
  }

  for (const question of questions) {
    const scoring = scoringById[question.id];
    if (!scoring) continue;
    if (duplicateOf[question.id]) {
      questionWeights[question.id] = {
        ...scoring,
        finalWeight: 0,
        layerWeight: layerWeights[scoring.sourceLayer ?? "role"],
        originalLayerWeight: layerWeights[scoring.sourceLayer ?? "role"],
        duplicateOf: duplicateOf[question.id],
        duplicateStrategy: "Critério duplicado; peso redistribuído.",
        alerts: ["Critério duplicado na composição."],
      };
    } else if (!questionWeights[question.id]) {
      questionWeights[question.id] = {
        ...scoring,
        finalWeight: 0,
        layerWeight: layerWeights[scoring.sourceLayer ?? "role"],
        originalLayerWeight: layerWeights[scoring.sourceLayer ?? "role"],
        duplicateOf: null,
        duplicateStrategy: null,
        alerts: [],
      };
    }
  }

  const categoryTotals: RecruitmentScoringSnapshot["categoryTotals"] = {};
  for (const [questionId, scoring] of Object.entries(questionWeights)) {
    const category = scoring.category;
    if (!category || scoring.finalWeight <= 0) continue;
    categoryTotals[category] = round((categoryTotals[category] ?? 0) + scoring.finalWeight);
    if (scoring.finalWeight > RECRUITMENT_MAX_QUESTION_POINTS) {
      alerts.push({
        code: "question_cap_exceeded",
        severity: "blocking",
        questionId,
        criterionCode: scoring.criterionCode,
        message: `Pergunta ultrapassa ${RECRUITMENT_MAX_QUESTION_POINTS}% da nota.`,
      });
    }
  }

  for (const [category, total] of Object.entries(categoryTotals) as Array<[RecruitmentCriterionCategory, number]>) {
    const cap = RECRUITMENT_CATEGORY_CAPS[category];
    if (cap !== undefined && total > cap) {
      alerts.push({
        code: "category_cap_exceeded",
        severity: "warning",
        message: `${RECRUITMENT_CATEGORY_LABELS[category]} representa ${round(total)} pontos; teto recomendado é ${cap}.`,
      });
    }
  }

  const scoredTotal = Object.values(questionWeights).reduce((sum, item) => sum + item.finalWeight, 0);
  if (scoredQuestions.length > 0 && Math.abs(scoredTotal - 100) > 0.5) {
    alerts.push({
      code: "score_total_not_100",
      severity: "warning",
      message: `Pontuação calculada soma ${round(scoredTotal)} pontos. Verifique perguntas pontuáveis ativas.`,
    });
  }

  const questionsWithSnapshot = questions.map((question) => ({
    ...question,
    scored: questionWeights[question.id]?.finalWeight > 0,
    weight: question.scoring?.importance ?? question.weight ?? "medium",
    eliminatory: question.scoring?.use === "eliminatory" || question.eliminatory,
    scoring: {
      ...question.scoring,
      finalWeight: questionWeights[question.id]?.finalWeight,
    },
  }));

  return {
    questions: questionsWithSnapshot,
    snapshot: {
      version: RECRUITMENT_SCORING_VERSION,
      preset: hasFunction ? preset : "role_100",
      totalPoints: 100,
      layerWeights,
      questionWeights,
      categoryTotals,
      duplicateCriteria: duplicates,
      alerts,
      createdAt: now,
    },
  };
}

export function getRecruitmentScoringBlockMessage(snapshot: RecruitmentScoringSnapshot) {
  const blockingAlert = snapshot.alerts.find((alert) => alert.severity === "blocking");
  return blockingAlert
    ? `Revise a pontuação do formulário: ${blockingAlert.message}`
    : null;
}

function hasAnswer(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function answerKey(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value);
}

function inferOptionFactor(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bnao\b|nenhum|nunca|sem experiencia|nao tenho/.test(normalized)) return 0;
  if (/parcial|pouco|ate 6|menos de/.test(normalized)) return 0.4;
  if (/medio|6 meses|1 ano|sim,? pouco|alguma/.test(normalized)) return 0.7;
  if (/sim|mais de|acima de|plena|total|flexivel|tenho/.test(normalized)) return 1;
  return 1;
}

function factorForAnswer(question: HrFormQuestion, answer: unknown, scoring: RecruitmentQuestionScoringConfig) {
  if (!hasAnswer(answer)) return 0;
  if (question.expectedAnswer !== undefined) {
    return answerKey(answer) === answerKey(question.expectedAnswer) ? 1 : 0;
  }

  const factors = scoring.answerFactors ?? {};
  if (Array.isArray(answer)) {
    if (answer.length === 0) return 0;
    const values = answer.map((entry) => {
      const key = answerKey(entry);
      return factors[key] !== undefined ? clampFactor(factors[key]) : inferOptionFactor(String(key));
    });
    return clampFactor(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  const key = answerKey(answer);
  if (factors[key] !== undefined) return clampFactor(factors[key]);
  if (typeof answer === "boolean") return answer ? 1 : 0;
  if (typeof answer === "string") return inferOptionFactor(answer);
  return 1;
}

function failEliminatory(question: HrFormQuestion, answer: unknown, scoring: RecruitmentQuestionScoringConfig) {
  if (!hasAnswer(answer)) return question.required === true;
  return factorForAnswer(question, answer, scoring) <= 0;
}

export function calculateRecruitmentScore(params: {
  questions: HrFormQuestion[];
  answers: Record<string, unknown>;
  snapshot?: RecruitmentScoringSnapshot | null;
  calculatedAt?: string;
}): RecruitmentScoreResult {
  const calculatedAt = params.calculatedAt ?? new Date().toISOString();
  const scoringSnapshot = params.snapshot ?? applyRecruitmentScoring(params.questions).snapshot;
  const questionScores: RecruitmentQuestionScore[] = [];
  const failedEliminatory: RecruitmentQuestionScore[] = [];

  for (const question of params.questions) {
    if (question.active === false) continue;
    const scoring = scoringSnapshot.questionWeights[question.id] ?? normalizeQuestionScoring(question);
    const answer = params.answers[question.id];
    const isEliminatory = scoring.use === "eliminatory" || question.eliminatory;
    const failed = isEliminatory ? failEliminatory(question, answer, scoring) : false;
    const weight = scoring.use === "scored" ? scoring.finalWeight ?? 0 : 0;
    const factor = weight > 0 ? factorForAnswer(question, answer, scoring) : 0;
    const item: RecruitmentQuestionScore = {
      questionId: question.id,
      criterionCode: scoring.criterionCode,
      category: scoring.category,
      label: scoring.criterionLabel ?? question.text,
      weight,
      factor: round(factor, 4),
      points: round(weight * factor),
      answer,
      eliminatory: isEliminatory,
      failedEliminatory: failed,
    };
    if (weight > 0 || isEliminatory) questionScores.push(item);
    if (failed) failedEliminatory.push(item);
  }

  const maxScore = questionScores.reduce((sum, item) => sum + (item.weight > 0 ? item.weight : 0), 0);
  const score = round(questionScores.reduce((sum, item) => sum + item.points, 0));
  const categoryScores: RecruitmentScoreResult["categoryScores"] = {};
  for (const item of questionScores) {
    if (!item.category || item.weight <= 0) continue;
    const current = categoryScores[item.category] ?? { points: 0, max: 0, percentage: 0 };
    current.points = round(current.points + item.points);
    current.max = round(current.max + item.weight);
    current.percentage = current.max > 0 ? round((current.points / current.max) * 100) : 0;
    categoryScores[item.category] = current;
  }

  const status: RecruitmentEligibilityStatus = failedEliminatory.length > 0
    ? "not_eligible"
    : maxScore > 0
      ? "eligible"
      : "not_evaluated";

  return {
    status,
    rankingEligible: status !== "not_eligible",
    score,
    maxScore: round(maxScore),
    percentage: maxScore > 0 ? round((score / maxScore) * 100) : 0,
    failedEliminatory,
    questionScores,
    categoryScores,
    calculatedAt,
  };
}
