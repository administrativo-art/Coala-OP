import "server-only";

import type {
  AiBillingBreakdown,
  AiBillingOverview,
  AiKeyUsage,
  AiModelUsage,
} from "@/features/ai-management/types";
import { budgetAlert, createHourlyCache, nextOpenAiPageToken, openAiBillingWindow, openAiSpendLimitUsd, optionalBillingBuckets, positiveFinite } from "@/features/ai-management/billing-policy";

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
  const seenPages = new Set<string>();
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
    page = nextOpenAiPageToken(payload.has_more, payload.next_page, seenPages);
    if (page) seenPages.add(page);
    buckets.push(...(payload.data || []));
  } while (page);
  return buckets;
}

async function fetchSpendLimit(adminKey: string, projectId: string | null) {
  const path = projectId
    ? `/organization/projects/${encodeURIComponent(projectId)}/spend_limit`
    : "/organization/spend_limit";
  const url = new URL(`${OPENAI_API_URL}${path}`);
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

const cachedOverview = createHourlyCache<AiBillingOverview>((value) => value.connected);

export async function loadOpenAiBillingOverview(now = new Date()): Promise<AiBillingOverview> {
  const adminKey = process.env.OPENAI_ADMIN_KEY?.trim() || "";
  const projectId = process.env.OPENAI_PROJECT_ID?.trim() || "";
  const budget = process.env.OPENAI_MONTHLY_CREDIT_BUDGET_USD?.trim() || "";
  const window = openAiBillingWindow(now);
  return cachedOverview(JSON.stringify([Boolean(adminKey), projectId, budget, window.queryStart, window.endExclusive]), now, () => readOpenAiBillingOverview(now));
}

async function readOpenAiBillingOverview(now: Date): Promise<AiBillingOverview> {
  const adminKey = process.env.OPENAI_ADMIN_KEY?.trim() || "";
  const configuredProjectId = process.env.OPENAI_PROJECT_ID?.trim() || null;
  const budgetInput = process.env.OPENAI_MONTHLY_CREDIT_BUDGET_USD?.trim() || "";
  const configuredMonthlyBudget = positiveFinite(budgetInput);
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
    costs: { currentMonthUsd: null, previousMonthUsd: null, last30DaysUsd: null, daily: [], byLineItem: [], byProject: [], byApiKey: [] },
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, byModel: [], byApiKey: [] },
    configuration: {
      adminKeyConfigured: Boolean(adminKey),
      projectIdConfigured: Boolean(configuredProjectId),
      spendLimitFound: false,
    },
    warnings: adminKey
      ? []
      : ["Configure OPENAI_ADMIN_KEY no servidor para consultar custos e uso oficiais da OpenAI."],
    alert: budgetAlert(null, null, "openai_budget"),
  };
  if (!adminKey) return unavailable;

  const window = openAiBillingWindow(now);
  const previousMonthStart = new Date(`${window.previousMonthStart}T00:00:00.000Z`);
  const currentMonthStart = new Date(`${window.currentMonthStart}T00:00:00.000Z`);
  const last30Start = new Date(`${window.last30DaysStart}T00:00:00.000Z`);
  const queryStart = new Date(`${window.queryStart}T00:00:00.000Z`);
  const queryEnd = new Date(`${window.endExclusive}T00:00:00.000Z`);

  try {
    const [costBuckets, usageResult, keyCosts, keyCompletions] = await Promise.all([
      fetchAllBuckets({
        path: "/organization/costs",
        startTime: unix(queryStart),
        endTime: unix(queryEnd),
        adminKey,
        projectId: configuredProjectId,
        groupBy: ["project_id", "line_item"],
      }),
      optionalBillingBuckets(() => fetchAllBuckets({
        path: "/organization/usage/completions",
        startTime: unix(currentMonthStart),
        endTime: unix(queryEnd),
        adminKey,
        projectId: configuredProjectId,
        groupBy: ["project_id", "model"],
      })),
      optionalBillingBuckets(() => fetchAllBuckets({
        path: "/organization/costs",
        startTime: unix(currentMonthStart),
        endTime: unix(queryEnd),
        adminKey,
        projectId: configuredProjectId,
        groupBy: ["api_key_id"],
      })),
      optionalBillingBuckets(() => fetchAllBuckets({
        path: "/organization/usage/completions",
        startTime: unix(currentMonthStart),
        endTime: unix(queryEnd),
        adminKey,
        projectId: configuredProjectId,
        groupBy: ["api_key_id"],
      })),
    ]);

    const daily = new Map<string, number>();
    const lineItems = new Map<string, number>();
    const projects = new Map<string, number>();
    const apiKeys = new Map<string, number>();
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

    for (const bucket of keyCosts.buckets) {
      for (const result of bucket.results || []) {
        const apiKeyId = String(result.api_key_id || "Sem chave atribuída");
        apiKeys.set(apiKeyId, (apiKeys.get(apiKeyId) || 0) + amountValue(result.amount));
      }
    }

    const modelUsage = new Map<string, AiModelUsage>();
    const keyUsage = new Map<string, AiKeyUsage>();
    for (const bucket of usageResult.buckets) {
      for (const result of bucket.results || []) {
        const model = String(result.model || "Modelo não identificado");
        const current = modelUsage.get(model) || { model, requests: 0, inputTokens: 0, outputTokens: 0 };
        current.requests += number(result.num_model_requests);
        current.inputTokens += number(result.input_tokens);
        current.outputTokens += number(result.output_tokens);
        modelUsage.set(model, current);
      }
    }
    for (const bucket of keyCompletions.buckets) {
      for (const result of bucket.results || []) {
        const key = String(result.api_key_id || "Sem chave atribuída");
        const currentKey = keyUsage.get(key) || { key, label: key, requests: 0, inputTokens: 0, outputTokens: 0 };
        currentKey.requests += number(result.num_model_requests);
        currentKey.inputTokens += number(result.input_tokens);
        currentKey.outputTokens += number(result.output_tokens);
        keyUsage.set(key, currentKey);
      }
    }
    const byModel = [...modelUsage.values()].sort((left, right) => right.requests - left.requests || left.model.localeCompare(right.model));
    const usage = byModel.reduce((total, entry) => ({
      requests: total.requests + entry.requests,
      inputTokens: total.inputTokens + entry.inputTokens,
      outputTokens: total.outputTokens + entry.outputTokens,
    }), { requests: 0, inputTokens: 0, outputTokens: 0 });

    const effectiveProjectId = configuredProjectId;
    const spendLimit = await fetchSpendLimit(adminKey, effectiveProjectId);
    // Spend-limit thresholds are returned in cents; organization costs are returned in dollars.
    const spendLimitUsd = openAiSpendLimitUsd(spendLimit);
    const limitUsd = spendLimitUsd ?? configuredMonthlyBudget;
    const source = spendLimitUsd !== null
      ? (effectiveProjectId ? "project_spend_limit" : "organization_spend_limit")
      : configuredMonthlyBudget !== null
        ? "configured_monthly_budget" as const
        : "unavailable" as const;
    const availableUsd = limitUsd === null ? null : rounded(Math.max(0, limitUsd - currentMonthUsd));
    const alert = budgetAlert(currentMonthUsd, limitUsd, "openai_budget");
    const usedPercent = alert.usedPercent;

    return {
      provider: "openai",
      configured: true,
      connected: true,
      generatedAt,
      scope: { type: effectiveProjectId ? "project" : "organization", projectId: effectiveProjectId },
      credits: {
        source,
        interval: limitUsd === null ? null : "month",
        limitUsd: limitUsd === null ? null : rounded(limitUsd),
        spentUsd: rounded(currentMonthUsd),
        availableUsd,
        usedPercent,
        note: limitUsd === null
          ? "Custos oficiais carregados. Configure um limite de gasto no projeto OpenAI ou OPENAI_MONTHLY_CREDIT_BUDGET_USD para calcular o disponível."
          : "Disponível calculado pelo limite mensal menos o custo oficial acumulado; não representa o saldo pré-pago da conta. Atrasos na contabilização podem alterar o valor.",
      },
      costs: {
        currentMonthUsd: rounded(currentMonthUsd),
        previousMonthUsd: rounded(previousMonthUsd),
        last30DaysUsd: rounded(last30DaysUsd),
        daily: [...daily.entries()].map(([date, costUsd]) => ({ date, costUsd: rounded(costUsd) })).sort((left, right) => left.date.localeCompare(right.date)),
        byLineItem: sortedBreakdown(lineItems, "Outros"),
        byProject: sortedBreakdown(projects, "Organização"),
        byApiKey: sortedBreakdown(apiKeys, "Sem chave atribuída"),
      },
      usage: { ...usage, byModel, byApiKey: [...keyUsage.values()].sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key)) },
      configuration: {
        adminKeyConfigured: true,
        projectIdConfigured: Boolean(configuredProjectId),
        spendLimitFound: spendLimitUsd !== null,
      },
      warnings: [
        ...(usageResult.failed ? ["Os custos foram carregados, mas o detalhamento de tokens não ficou disponível."] : []),
        ...(keyCosts.failed ? ["Os custos totais foram carregados, mas o detalhamento por chave não ficou disponível."] : []),
        ...(keyCompletions.failed ? ["O uso total foi carregado, mas o uso por chave não ficou disponível."] : []),
        ...(budgetInput && configuredMonthlyBudget === null ? ["OPENAI_MONTHLY_CREDIT_BUDGET_USD deve ser um número positivo em USD."] : []),
        ...(spendLimit && spendLimitUsd === null ? ["O limite retornado pela OpenAI não é mensal em USD; ele não foi usado no cálculo."] : []),
      ],
      alert,
    };
  } catch {
    return {
      ...unavailable,
      configured: true,
      warnings: ["Não foi possível consultar os custos da OpenAI. Confira o acesso administrativo e tente novamente."],
    };
  }
}
