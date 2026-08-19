import "server-only";

import { adminApp } from "@/lib/firebase-admin";
import type { AppCostBreakdown, AppCostOverview } from "@/features/ai-management/types";

const BIGQUERY_API_URL = "https://bigquery.googleapis.com/bigquery/v2";
// O export padrão é suficiente para o painel e custa menos para consultar que o detalhado.
const BILLING_TABLE_PREFIXES = ["gcp_billing_export_v1_", "gcp_billing_export_resource_v1_"];
const DEFAULT_MAXIMUM_BYTES_BILLED = 250_000_000;

type BigQueryDatasetList = {
  datasets?: Array<{ datasetReference?: { projectId?: string; datasetId?: string } }>;
  error?: { message?: string };
};

type BigQueryTableList = {
  tables?: Array<{ tableReference?: { projectId?: string; datasetId?: string; tableId?: string } }>;
  error?: { message?: string };
};

type BigQueryQueryResponse = {
  jobComplete?: boolean;
  schema?: { fields?: Array<{ name?: string }> };
  rows?: Array<{ f?: Array<{ v?: unknown }> }>;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
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

function unixDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month, day, 0, 0, 0));
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
  warnings: string[];
}): AppCostOverview {
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
    warnings: params.warnings,
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
  const datasets = await googleJson<BigQueryDatasetList>(
    `${BIGQUERY_API_URL}/projects/${encodeURIComponent(exportProjectId)}/datasets?all=true&maxResults=1000`,
    token,
  );
  const candidates: BillingTable[] = [];
  for (const dataset of (datasets.datasets || []).slice(0, 100)) {
    const datasetId = dataset.datasetReference?.datasetId;
    if (!datasetId) continue;
    const tables = await googleJson<BigQueryTableList>(
      `${BIGQUERY_API_URL}/projects/${encodeURIComponent(exportProjectId)}/datasets/${encodeURIComponent(datasetId)}/tables?maxResults=1000`,
      token,
    );
    for (const table of tables.tables || []) {
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
  const response = await googleJson<BigQueryQueryResponse>(
    `${BIGQUERY_API_URL}/projects/${encodeURIComponent(params.table.projectId)}/queries`,
    params.token,
    {
      method: "POST",
      body: JSON.stringify({
        query: querySql(params.table),
        useLegacySql: false,
        timeoutMs: 30_000,
        maximumBytesBilled: String(
          Math.max(10_000_000, number(process.env.GOOGLE_CLOUD_BILLING_MAX_BYTES_PER_QUERY) || DEFAULT_MAXIMUM_BYTES_BILLED),
        ),
        parameterMode: "NAMED",
        queryParameters: [
          { name: "projectId", parameterType: { type: "STRING" }, parameterValue: { value: params.targetProjectId } },
          { name: "startDate", parameterType: { type: "DATE" }, parameterValue: { value: params.startDate } },
          { name: "endDate", parameterType: { type: "DATE" }, parameterValue: { value: params.endDate } },
        ],
      }),
    },
  );
  if (!response.jobComplete) throw new Error("A consulta de billing excedeu 30 segundos. Tente atualizar novamente.");
  if (response.errors?.length) throw new Error(response.errors[0]?.message || "A consulta de billing falhou.");
  const names = (response.schema?.fields || []).map((field) => field.name || "");
  return (response.rows || []).map((row): CostRow => {
    const values = new Map(names.map((name, index) => [name, row.f?.[index]?.v]));
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
}

function breakdown(map: Map<string, number>): AppCostBreakdown[] {
  return [...map.entries()]
    .map(([key, cost]) => ({ key, label: key, cost: rounded(cost) }))
    .sort((left, right) => right.cost - left.cost || left.label.localeCompare(right.label));
}

export async function loadGoogleCloudCostOverview(now = new Date()): Promise<AppCostOverview> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
    || "smart-converter-752gf";
  const exportProjectId = process.env.GOOGLE_CLOUD_BILLING_EXPORT_PROJECT_ID?.trim() || projectId;
  const generatedAt = now.toISOString();
  const explicitTable = configuredTable();

  try {
    const token = await accessToken();
    const table = explicitTable || await discoverBillingTable(exportProjectId, token);
    if (!table) {
      return blankOverview({
        projectId,
        exportProjectId,
        generatedAt,
        configured: false,
        warnings: ["Nenhuma tabela de exportação do Cloud Billing foi encontrada no BigQuery."],
      });
    }

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const previousMonthStart = utcDate(year, month - 1, 1);
    const currentMonthStart = utcDate(year, month, 1);
    const queryEnd = new Date(now.getTime() + 86_400_000);
    const last30Start = new Date(now.getTime() - 30 * 86_400_000);
    const rows = await queryCosts({
      table,
      targetProjectId: projectId,
      startDate: unixDate(previousMonthStart),
      endDate: unixDate(queryEnd),
      token,
    });

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
      const date = new Date(`${row.usageDate}T00:00:00.000Z`);
      currencies.add(row.currency);
      daily.set(row.usageDate, (daily.get(row.usageDate) || 0) + row.netCost);
      if (date >= currentMonthStart && date < queryEnd) {
        currentMonth += row.netCost;
        grossCurrentMonth += row.grossCost;
        creditsCurrentMonth += row.credits;
        services.set(row.service, (services.get(row.service) || 0) + row.netCost);
        skus.set(row.sku, (skus.get(row.sku) || 0) + row.netCost);
      }
      if (date >= previousMonthStart && date < currentMonthStart) previousMonth += row.netCost;
      if (date >= last30Start && date < queryEnd) last30Days += row.netCost;
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
      costs: {
        currentMonth: rounded(currentMonth),
        previousMonth: rounded(previousMonth),
        last30Days: rounded(last30Days),
        grossCurrentMonth: rounded(grossCurrentMonth),
        creditsCurrentMonth: rounded(creditsCurrentMonth),
        daily: [...daily.entries()].map(([date, cost]) => ({ date, cost: rounded(cost) })).sort((left, right) => left.date.localeCompare(right.date)),
        byService: breakdown(services),
        bySku: breakdown(skus),
      },
      setup: {
        billingExportFound: true,
        consoleUrl: consoleUrl(projectId),
        requiredRoles: ["roles/bigquery.jobUser", "roles/bigquery.dataViewer"],
      },
      warnings: currencies.size > 1 ? ["O export retornou mais de uma moeda; confira o detalhamento no Cloud Billing."] : [],
    };
  } catch (error) {
    return blankOverview({
      projectId,
      exportProjectId,
      generatedAt,
      configured: Boolean(explicitTable),
      table: explicitTable,
      warnings: [error instanceof Error ? error.message : "Não foi possível consultar os custos do Google Cloud."],
    });
  }
}
