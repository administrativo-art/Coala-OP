import "server-only";

import type {
  AiBillingBreakdown,
  AiBillingOverview,
  AiModelUsage,
} from "@/features/ai-management/types";

const OPENAI_API_URL = "https://api.openai.com/v1";

type OpenAiPage = {
  data?: Array<{
    start_time?: number;
    end_time?: number;
    results?: Array<Record<string, unknown>>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
  error?: { message?: string };
};

function rounded(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountValue(value: unknown) {
  if (typeof value === "number") return number(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return number(record.value ?? record.amount ?? record.threshold_amount);
  }
  return 0;
}

function unix(value: Date) {
  return Math.floor(value.getTime() / 1000);
}

function utcDate(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month, day, 0, 0, 0));
}

async function fetchOpenAiJson<T>(url: URL, adminKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || `A OpenAI respondeu com HTTP ${response.status}.`);
  }
  return payload;
}

async function fetchAllBuckets(params: {
  path: string;
  startTime: number;
  endTime: number;
  adminKey: string;
  projectId: string | null;
  groupBy: string[];
}) {
  const buckets: NonNullable<OpenAiPage["data"]> = [];
  let page: string | null = null;
  do {
    const url = new URL(`${OPENAI_API_URL}${params.path}`);
    url.searchParams.set("start_time", String(params.startTime));
    url.searchParams.set("end_time", String(params.endTime));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "180");
    params.groupBy.forEach((group) => url.searchParams.append("group_by", group));
    if (params.projectId) url.searchParams.append("project_ids", params.projectId);
    if (page) url.searchParams.set("page", page);
    const payload = await fetchOpenAiJson<OpenAiPage>(url, params.adminKey);
    buckets.push(...(payload.data || []));
    page = payload.has_more && payload.next_page ? payload.next_page : null;
  } while (page);
  return buckets;
}

async function fetchProjectSpendLimit(adminKey: string, projectId: string | null) {
  if (!projectId) return null;
  const url = new URL(`${OPENAI_API_URL}/organization/projects/${encodeURIComponent(projectId)}/spend_limit`);
  try {
    return await fetchOpenAiJson<Record<string, unknown>>(url, adminKey);
  } catch {
    return null;
  }
}

function sortedBreakdown(values: Map<string, number>, fallbackLabel: string): AiBillingBreakdown[] {
  return [...values.entries()]
    .map(([key, costUsd]) => ({ key, label: key || fallbackLabel, costUsd: rounded(costUsd) }))
    .sort((left, right) => right.costUsd - left.costUsd || left.label.localeCompare(right.label));
}

export async function loadOpenAiBillingOverview(now = new Date()): Promise<AiBillingOverview> {
  const adminKey = process.env.OPENAI_ADMIN_KEY?.trim() || "";
  const configuredProjectId = process.env.OPENAI_PROJECT_ID?.trim() || null;
  const configuredMonthlyBudget = number(process.env.OPENAI_MONTHLY_CREDIT_BUDGET_USD);
  const generatedAt = now.toISOString();
  const unavailable: AiBillingOverview = {
    provider: "openai",
    configured: Boolean(adminKey),
    connected: false,
    generatedAt,
    scope: { type: configuredProjectId ? "project" : "organization", projectId: configuredProjectId },
    credits: {
      source: "unavailable",
      interval: null,
      limitUsd: null,
      spentUsd: null,
      availableUsd: null,
      usedPercent: null,
      note: "A API oficial informa custos e limites, mas não expõe o saldo exato de créditos pré-pagos da conta.",
    },
    costs: { currentMonthUsd: null, previousMonthUsd: null, last30DaysUsd: null, daily: [], byLineItem: [], byProject: [] },
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, byModel: [] },
    configuration: {
      adminKeyConfigured: Boolean(adminKey),
      projectIdConfigured: Boolean(configuredProjectId),
      spendLimitFound: false,
    },
    warnings: adminKey
      ? []
      : ["Configure OPENAI_ADMIN_KEY no servidor para consultar custos e uso oficiais da OpenAI."],
  };
  if (!adminKey) return unavailable;

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const previousMonthStart = utcDate(year, month - 1, 1);
  const currentMonthStart = utcDate(year, month, 1);
  const nextMonthStart = utcDate(year, month + 1, 1);
  const last30Start = new Date(now.getTime() - 30 * 86_400_000);
  const queryEnd = now < nextMonthStart ? new Date(now.getTime() + 86_400_000) : nextMonthStart;

  try {
    const [costBuckets, usageResult] = await Promise.all([
      fetchAllBuckets({
        path: "/organization/costs",
        startTime: unix(previousMonthStart),
        endTime: unix(queryEnd),
        adminKey,
        projectId: configuredProjectId,
        groupBy: ["project_id", "line_item"],
      }),
      fetchAllBuckets({
        path: "/organization/usage/completions",
        startTime: unix(currentMonthStart),
        endTime: unix(queryEnd),
        adminKey,
        projectId: configuredProjectId,
        groupBy: ["project_id", "model"],
      }).catch(() => []),
    ]);

    const daily = new Map<string, number>();
    const lineItems = new Map<string, number>();
    const projects = new Map<string, number>();
    let currentMonthUsd = 0;
    let previousMonthUsd = 0;
    let last30DaysUsd = 0;
    for (const bucket of costBuckets) {
      const date = new Date(number(bucket.start_time) * 1000);
      const dateKey = date.toISOString().slice(0, 10);
      for (const result of bucket.results || []) {
        const cost = amountValue(result.amount);
        daily.set(dateKey, (daily.get(dateKey) || 0) + cost);
        if (date >= currentMonthStart && date < queryEnd) {
          const lineItem = String(result.line_item || "Outros");
          const project = String(result.project_id || configuredProjectId || "Organização");
          lineItems.set(lineItem, (lineItems.get(lineItem) || 0) + cost);
          projects.set(project, (projects.get(project) || 0) + cost);
          currentMonthUsd += cost;
        }
        if (date >= previousMonthStart && date < currentMonthStart) previousMonthUsd += cost;
        if (date >= last30Start && date < queryEnd) last30DaysUsd += cost;
      }
    }

    const modelUsage = new Map<string, AiModelUsage>();
    for (const bucket of usageResult) {
      for (const result of bucket.results || []) {
        const model = String(result.model || "Modelo não identificado");
        const current = modelUsage.get(model) || { model, requests: 0, inputTokens: 0, outputTokens: 0 };
        current.requests += number(result.num_model_requests);
        current.inputTokens += number(result.input_tokens);
        current.outputTokens += number(result.output_tokens);
        modelUsage.set(model, current);
      }
    }
    const byModel = [...modelUsage.values()].sort((left, right) => right.requests - left.requests || left.model.localeCompare(right.model));
    const usage = byModel.reduce((total, entry) => ({
      requests: total.requests + entry.requests,
      inputTokens: total.inputTokens + entry.inputTokens,
      outputTokens: total.outputTokens + entry.outputTokens,
    }), { requests: 0, inputTokens: 0, outputTokens: 0 });

    const inferredProjectIds = [...projects.keys()].filter((key) => key.startsWith("proj_"));
    const effectiveProjectId = configuredProjectId || (inferredProjectIds.length === 1 ? inferredProjectIds[0]! : null);
    const spendLimit = await fetchProjectSpendLimit(adminKey, effectiveProjectId);
    const spendLimitValue = amountValue(spendLimit?.threshold_amount ?? spendLimit?.amount);
    const limitUsd = spendLimitValue > 0 ? spendLimitValue : configuredMonthlyBudget > 0 ? configuredMonthlyBudget : null;
    const source = spendLimitValue > 0
      ? "project_spend_limit" as const
      : configuredMonthlyBudget > 0
        ? "configured_monthly_budget" as const
        : "unavailable" as const;
    const availableUsd = limitUsd === null ? null : rounded(Math.max(0, limitUsd - currentMonthUsd));
    const usedPercent = limitUsd === null ? null : rounded(Math.min(100, (currentMonthUsd / limitUsd) * 100), 2);

    return {
      provider: "openai",
      configured: true,
      connected: true,
      generatedAt,
      scope: { type: effectiveProjectId ? "project" : "organization", projectId: effectiveProjectId },
      credits: {
        source,
        interval: String(spendLimit?.interval || "monthly"),
        limitUsd: limitUsd === null ? null : rounded(limitUsd),
        spentUsd: rounded(currentMonthUsd),
        availableUsd,
        usedPercent,
        note: limitUsd === null
          ? "Custos oficiais carregados. Configure um limite de gasto no projeto OpenAI ou OPENAI_MONTHLY_CREDIT_BUDGET_USD para calcular o disponível."
          : "Disponível calculado pelo limite mensal menos o custo oficial acumulado; não representa o saldo pré-pago da conta.",
      },
      costs: {
        currentMonthUsd: rounded(currentMonthUsd),
        previousMonthUsd: rounded(previousMonthUsd),
        last30DaysUsd: rounded(last30DaysUsd),
        daily: [...daily.entries()].map(([date, costUsd]) => ({ date, costUsd: rounded(costUsd) })).sort((left, right) => left.date.localeCompare(right.date)),
        byLineItem: sortedBreakdown(lineItems, "Outros"),
        byProject: sortedBreakdown(projects, "Organização"),
      },
      usage: { ...usage, byModel },
      configuration: {
        adminKeyConfigured: true,
        projectIdConfigured: Boolean(configuredProjectId),
        spendLimitFound: spendLimitValue > 0,
      },
      warnings: usageResult.length === 0 ? ["Os custos foram carregados, mas o detalhamento de tokens não ficou disponível."] : [],
    };
  } catch (error) {
    return {
      ...unavailable,
      configured: true,
      warnings: [error instanceof Error ? error.message : "Não foi possível consultar o billing da OpenAI."],
    };
  }
}
