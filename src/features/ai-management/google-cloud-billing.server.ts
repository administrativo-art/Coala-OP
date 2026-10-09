import "server-only";

import { adminApp } from "@/lib/firebase-admin";
import type { AppCostBreakdown, AppCostOverview } from "@/features/ai-management/types";
import { appendCompletedQueryPage, collectCatalogPages, type BigQueryQueryPage, type CollectedQueryRows } from "@/features/ai-management/bigquery-query-pages";
import {
  BIGQUERY_MONTHLY_FREE_BYTES,
  belemBillingWindow,
  budgetAlert,
  createHourlyCache,
  dryRunBytes,
  googleBillingExportCoverage,
  maximumBytesBilled,
  projectPanelMonthlyBytes,
  queryWithinLimit,
} from "@/features/ai-management/billing-policy";

const BIGQUERY_API_URL = "https://bigquery.googleapis.com/bigquery/v2";
// O export padrão é suficiente para o painel e custa menos para consultar que o detalhado.
const BILLING_TABLE_PREFIXES = ["gcp_billing_export_v1_", "gcp_billing_export_resource_v1_"];

type BigQueryDatasetList = {
  datasets?: Array<{ datasetReference?: { projectId?: string; datasetId?: string } }>;
  nextPageToken?: string;
  error?: { message?: string };
};

type BigQueryTableList = {
  tables?: Array<{ tableReference?: { projectId?: string; datasetId?: string; tableId?: string } }>;
  nextPageToken?: string;
  error?: { message?: string };
};

type BigQueryQueryResponse = BigQueryQueryPage & {
  error?: { message?: string };
  totalBytesProcessed?: string;
  jobReference?: { projectId?: string; jobId?: string; location?: string };
  location?: string;
};

type BillingTable = {
  projectId: string;
  datasetId: string;
  tableId: string;
  detectedAutomatically: boolean;
};

type CostRow = {
  usageDate: string;
  service: string;
  sku: string;
  currency: string;
  grossCost: number;
  credits: number;
  netCost: number;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function consoleUrl(projectId: string) {
  return `https://console.cloud.google.com/billing/export?project=${encodeURIComponent(projectId)}`;
}

function blankOverview(params: {
  projectId: string;
  exportProjectId: string;
  generatedAt: string;
  configured: boolean;
  table?: BillingTable | null;
  bytesPerQuery?: number | null;
  warnings: string[];
}): AppCostOverview {
  const coverage = googleBillingExportCoverage([], new Date(params.generatedAt));
  return {
    provider: "google_cloud_billing",
    configured: params.configured,
    connected: false,
    generatedAt: params.generatedAt,
    projectId: params.projectId,
    currency: "USD",
    export: {
      projectId: params.table?.projectId || params.exportProjectId,
      datasetId: params.table?.datasetId || null,
      tableId: params.table?.tableId || null,
      detectedAutomatically: params.table?.detectedAutomatically || false,
    },
    coverage: { ...coverage, status: "unavailable" },
    costs: {
      currentMonth: null,
      previousMonth: null,
      last30Days: null,
      grossCurrentMonth: null,
      creditsCurrentMonth: null,
      daily: [],
      byService: [],
      bySku: [],
    },
    setup: {
      billingExportFound: Boolean(params.table),
      consoleUrl: consoleUrl(params.projectId),
      requiredRoles: ["roles/bigquery.jobUser", "roles/bigquery.dataViewer"],
    },
    queryEstimate: queryEstimate(params.bytesPerQuery ?? null, new Date(params.generatedAt)),
    alert: budgetAlert(null, null, "bigquery_panel_estimate"),
    warnings: params.warnings,
  };
}

function queryEstimate(bytesPerQuery: number | null, now: Date): AppCostOverview["queryEstimate"] {
  return {
    bytesPerQuery,
    maximumBytesBilled: maximumBytesBilled(process.env.GOOGLE_CLOUD_BILLING_MAX_BYTES_PER_QUERY),
    monthlyPanelBytesAtHourlyRefresh: bytesPerQuery === null ? null : projectPanelMonthlyBytes(bytesPerQuery, now),
    monthlyFreeBytes: BIGQUERY_MONTHLY_FREE_BYTES,
    note: "Estimativa somente deste painel em uma instância do servidor, com até 24 consultas horárias mais uma na virada de cada dia, mantendo o volume do dry run. Mais instâncias ou outros usos do BigQuery elevam o total; a franquia de 1 TiB é compartilhada pela conta.",
  };
}

async function accessToken() {
  const credential = adminApp.options.credential;
  if (!credential) throw new Error("A credencial Google do servidor não está disponível.");
  const token = await credential.getAccessToken();
  if (!token.access_token) throw new Error("Não foi possível autenticar no Google Cloud.");
  return token.access_token;
}

async function googleJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `O Google Cloud respondeu com HTTP ${response.status}.`);
  return payload;
}

function configuredTable(): BillingTable | null {
  const raw = process.env.GOOGLE_CLOUD_BILLING_EXPORT_TABLE?.trim() || "";
  const match = raw.match(/^([a-z][a-z0-9-]{4,61}[a-z0-9])\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)$/);
  if (!match) return null;
  return { projectId: match[1]!, datasetId: match[2]!, tableId: match[3]!, detectedAutomatically: false };
}

async function discoverBillingTable(exportProjectId: string, token: string): Promise<BillingTable | null> {
  const datasets = await collectCatalogPages(async (pageToken) => {
    const url = new URL(`${BIGQUERY_API_URL}/projects/${encodeURIComponent(exportProjectId)}/datasets`);
    url.searchParams.set("all", "true");
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleJson<BigQueryDatasetList>(url.toString(), token);
    return { items: page.datasets || [], nextPageToken: page.nextPageToken };
  });
  const candidates: BillingTable[] = [];
  for (const dataset of datasets) {
    const datasetId = dataset.datasetReference?.datasetId;
    if (!datasetId) continue;
    const tables = await collectCatalogPages(async (pageToken) => {
      const url = new URL(`${BIGQUERY_API_URL}/projects/${encodeURIComponent(exportProjectId)}/datasets/${encodeURIComponent(datasetId)}/tables`);
      url.searchParams.set("maxResults", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const page = await googleJson<BigQueryTableList>(url.toString(), token);
      return { items: page.tables || [], nextPageToken: page.nextPageToken };
    });
    for (const table of tables) {
      const tableId = table.tableReference?.tableId || "";
      if (BILLING_TABLE_PREFIXES.some((prefix) => tableId.startsWith(prefix))) {
        candidates.push({ projectId: exportProjectId, datasetId, tableId, detectedAutomatically: true });
      }
    }
  }
  return candidates.sort((left, right) => {
    const leftDetailed = left.tableId.startsWith(BILLING_TABLE_PREFIXES[0]!) ? 0 : 1;
    const rightDetailed = right.tableId.startsWith(BILLING_TABLE_PREFIXES[0]!) ? 0 : 1;
    return leftDetailed - rightDetailed || left.tableId.localeCompare(right.tableId);
  })[0] || null;
}

function querySql(table: BillingTable) {
  return `
    SELECT
      FORMAT_DATE('%F', DATE(usage_start_time, 'America/Belem')) AS usage_date,
      COALESCE(service.description, 'Serviço não identificado') AS service,
      COALESCE(sku.description, 'SKU não identificado') AS sku,
      COALESCE(currency, 'USD') AS currency,
      SUM(cost) AS gross_cost,
      SUM(IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS credits,
      SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS net_cost
    FROM \`${table.projectId}.${table.datasetId}.${table.tableId}\`
    WHERE project.id = @projectId
      AND DATE(usage_start_time, 'America/Belem') >= @startDate
      AND DATE(usage_start_time, 'America/Belem') < @endDate
    GROUP BY usage_date, service, sku, currency
    ORDER BY usage_date ASC
  `;
}

async function queryCosts(params: {
  table: BillingTable;
  targetProjectId: string;
  startDate: string;
  endDate: string;
  token: string;
}) {
  const maxBytes = maximumBytesBilled(process.env.GOOGLE_CLOUD_BILLING_MAX_BYTES_PER_QUERY);
  const requestBody = {
    query: querySql(params.table),
    useLegacySql: false,
    timeoutMs: 30_000,
    maximumBytesBilled: String(maxBytes),
    parameterMode: "NAMED",
    queryParameters: [
      { name: "projectId", parameterType: { type: "STRING" }, parameterValue: { value: params.targetProjectId } },
      { name: "startDate", parameterType: { type: "DATE" }, parameterValue: { value: params.startDate } },
      { name: "endDate", parameterType: { type: "DATE" }, parameterValue: { value: params.endDate } },
    ],
  };
  const endpoint = `${BIGQUERY_API_URL}/projects/${encodeURIComponent(params.table.projectId)}/queries`;
  const dryRun = await googleJson<BigQueryQueryResponse>(endpoint, params.token, {
    method: "POST",
    // An unlimited dry run is free and reveals when the real query would exceed our hard cap.
    body: JSON.stringify({ ...requestBody, maximumBytesBilled: undefined, dryRun: true }),
  });
  const estimatedBytes = dryRunBytes(dryRun.totalBytesProcessed);
  if (estimatedBytes === null) {
    throw new Error("O dry run não retornou uma estimativa válida de bytes; a consulta foi cancelada.");
  }
  if (!queryWithinLimit(estimatedBytes, maxBytes)) {
    return { rows: null, estimatedBytes };
  }
  const response = await googleJson<BigQueryQueryResponse>(
    endpoint,
    params.token,
    {
      method: "POST",
      body: JSON.stringify(requestBody),
    },
  );
  const collected = await collectQueryRows(response, params.table.projectId, params.token);
  const rows = collected.rows.map((row): CostRow => {
    const values = new Map(collected.fieldNames.map((name, index) => [name, row.f?.[index]?.v]));
    return {
      usageDate: String(values.get("usage_date") || ""),
      service: String(values.get("service") || "Serviço não identificado"),
      sku: String(values.get("sku") || "SKU não identificado"),
      currency: String(values.get("currency") || "USD"),
      grossCost: number(values.get("gross_cost")),
      credits: number(values.get("credits")),
      netCost: number(values.get("net_cost")),
    };
  });
  return { rows, estimatedBytes };
}

async function collectQueryRows(initial: BigQueryQueryResponse, fallbackProjectId: string, token: string) {
  const job = initial.jobReference;
  let page = initial;
  let collected: CollectedQueryRows | null = null;
  let incompleteAttempts = 0;
  let requestedPageToken: string | null = null;
  const seenTokens = new Set<string>();
  const getResults = async (pageToken: string | null) => {
    if (!job?.jobId) throw new Error("O BigQuery não retornou a referência do job para continuar a consulta.");
    const projectId = job.projectId || fallbackProjectId;
    const url = new URL(`${BIGQUERY_API_URL}/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(job.jobId)}`);
    const location = job.location || initial.location;
    if (location) url.searchParams.set("location", location);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    url.searchParams.set("timeoutMs", "30000");
    return googleJson<BigQueryQueryResponse>(url.toString(), token);
  };

  while (true) {
    if (!page.jobComplete) {
      if (++incompleteAttempts > 3) throw new Error("A consulta do BigQuery não terminou no prazo.");
      page = await getResults(requestedPageToken);
      continue;
    }
    collected = appendCompletedQueryPage(collected, page);
    const nextToken = collected.nextPageToken;
    if (!nextToken) return collected;
    if (seenTokens.has(nextToken)) throw new Error("O BigQuery repetiu um token de página.");
    seenTokens.add(nextToken);
    requestedPageToken = nextToken;
    page = await getResults(nextToken);
  }
}

function breakdown(map: Map<string, number>): AppCostBreakdown[] {
  return [...map.entries()]
    .map(([key, cost]) => ({ key, label: key, cost: rounded(cost) }))
    .sort((left, right) => right.cost - left.cost || left.label.localeCompare(right.label));
}

const cachedOverview = createHourlyCache<AppCostOverview>((value) => value.connected);

export async function loadGoogleCloudCostOverview(now = new Date()): Promise<AppCostOverview> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "";
  const exportProjectId = process.env.GOOGLE_CLOUD_BILLING_EXPORT_PROJECT_ID?.trim() || "";
  const table = process.env.GOOGLE_CLOUD_BILLING_EXPORT_TABLE?.trim() || "";
  const maxBytes = process.env.GOOGLE_CLOUD_BILLING_MAX_BYTES_PER_QUERY?.trim() || "";
  const window = belemBillingWindow(now);
  return cachedOverview(JSON.stringify([projectId, exportProjectId, table, maxBytes, window.queryStart, window.endExclusive]), now, () => readGoogleCloudCostOverview(now));
}

async function readGoogleCloudCostOverview(now: Date): Promise<AppCostOverview> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
    || "smart-converter-752gf";
  const exportProjectId = process.env.GOOGLE_CLOUD_BILLING_EXPORT_PROJECT_ID?.trim() || projectId;
  const generatedAt = now.toISOString();
  const explicitTable = configuredTable();
  let detectedTable = explicitTable;

  try {
    const token = await accessToken();
    const table = explicitTable || await discoverBillingTable(exportProjectId, token);
    detectedTable = table;
    if (!table) {
      return blankOverview({
        projectId,
        exportProjectId,
        generatedAt,
        configured: false,
        warnings: ["Nenhuma tabela de exportação do Cloud Billing foi encontrada no BigQuery."],
      });
    }

    const window = belemBillingWindow(now);
    const result = await queryCosts({
      table,
      targetProjectId: projectId,
      startDate: window.queryStart,
      endDate: window.endExclusive,
      token,
    });
    const estimate = queryEstimate(result.estimatedBytes, now);
    if (!result.rows) {
      return blankOverview({
        projectId, exportProjectId, generatedAt, configured: true, table,
        bytesPerQuery: result.estimatedBytes,
        warnings: [`O dry run estimou ${result.estimatedBytes.toLocaleString("pt-BR")} bytes, acima do teto de ${estimate.maximumBytesBilled.toLocaleString("pt-BR")}; a consulta foi cancelada.`],
      });
    }
    const rows = result.rows;
    const coverage = googleBillingExportCoverage(rows.map((row) => row.usageDate), now);
    const exportIsCurrent = coverage.status === "current";

    let currentMonth = 0;
    let previousMonth = 0;
    let last30Days = 0;
    let grossCurrentMonth = 0;
    let creditsCurrentMonth = 0;
    const daily = new Map<string, number>();
    const services = new Map<string, number>();
    const skus = new Map<string, number>();
    const currencies = new Set<string>();
    for (const row of rows) {
      currencies.add(row.currency);
      daily.set(row.usageDate, (daily.get(row.usageDate) || 0) + row.netCost);
      if (row.usageDate >= window.currentMonthStart && row.usageDate < window.endExclusive) {
        currentMonth += row.netCost;
        grossCurrentMonth += row.grossCost;
        creditsCurrentMonth += row.credits;
        services.set(row.service, (services.get(row.service) || 0) + row.netCost);
        skus.set(row.sku, (skus.get(row.sku) || 0) + row.netCost);
      }
      if (row.usageDate >= window.previousMonthStart && row.usageDate < window.currentMonthStart) previousMonth += row.netCost;
      if (row.usageDate >= window.last30DaysStart && row.usageDate < window.endExclusive) last30Days += row.netCost;
    }

    const currency = currencies.size === 1 ? [...currencies][0]! : "USD";
    return {
      provider: "google_cloud_billing",
      configured: true,
      connected: true,
      generatedAt,
      projectId,
      currency,
      export: {
        projectId: table.projectId,
        datasetId: table.datasetId,
        tableId: table.tableId,
        detectedAutomatically: table.detectedAutomatically,
      },
      coverage,
      costs: {
        currentMonth: exportIsCurrent ? rounded(currentMonth) : null,
        previousMonth: exportIsCurrent ? rounded(previousMonth) : null,
        last30Days: exportIsCurrent ? rounded(last30Days) : null,
        grossCurrentMonth: exportIsCurrent ? rounded(grossCurrentMonth) : null,
        creditsCurrentMonth: exportIsCurrent ? rounded(creditsCurrentMonth) : null,
        daily: [...daily.entries()].map(([date, cost]) => ({ date, cost: rounded(cost) })).sort((left, right) => left.date.localeCompare(right.date)),
        byService: breakdown(services),
        bySku: breakdown(skus),
      },
      setup: {
        billingExportFound: true,
        consoleUrl: consoleUrl(projectId),
        requiredRoles: ["roles/bigquery.jobUser", "roles/bigquery.dataViewer"],
      },
      queryEstimate: estimate,
      alert: budgetAlert(estimate.monthlyPanelBytesAtHourlyRefresh, BIGQUERY_MONTHLY_FREE_BYTES, "bigquery_panel_estimate"),
      warnings: [
        ...(coverage.status === "empty" ? ["O export do projeto ainda não retornou nenhum dia de uso."] : []),
        ...(coverage.status === "backfilling" ? [`O export do projeto ainda está em preenchimento: há dados somente até ${coverage.lastUsageDate}. Os totais permanecem indisponíveis para não apresentar zero ou valor parcial como consolidado.`] : []),
        ...(currencies.size > 1 ? ["O export retornou mais de uma moeda; confira o detalhamento no Cloud Billing."] : []),
      ],
    };
  } catch {
    return blankOverview({
      projectId,
      exportProjectId,
      generatedAt,
      configured: Boolean(detectedTable),
      table: detectedTable,
      warnings: ["Não foi possível consultar os custos do Google Cloud. Confira o export e as permissões do BigQuery."],
    });
  }
}
