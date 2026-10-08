export type AiBillingBreakdown = {
  key: string;
  label: string;
  costUsd: number;
};

export type BillingAlert = {
  level: "none" | "warning" | "critical" | "unavailable";
  basis: "openai_budget" | "bigquery_panel_estimate";
  usedPercent: number | null;
};

export type AiKeyUsage = {
  key: string;
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

export type AiBillingDailyCost = {
  date: string;
  costUsd: number;
};

export type AiModelUsage = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

export type AiBillingOverview = {
  provider: "openai";
  configured: boolean;
  connected: boolean;
  generatedAt: string;
  scope: {
    type: "organization" | "project";
    projectId: string | null;
  };
  credits: {
    source: "project_spend_limit" | "organization_spend_limit" | "configured_monthly_budget" | "unavailable";
    interval: string | null;
    limitUsd: number | null;
    spentUsd: number | null;
    availableUsd: number | null;
    usedPercent: number | null;
    note: string;
  };
  costs: {
    currentMonthUsd: number | null;
    previousMonthUsd: number | null;
    last30DaysUsd: number | null;
    daily: AiBillingDailyCost[];
    byLineItem: AiBillingBreakdown[];
    byProject: AiBillingBreakdown[];
    byApiKey: AiBillingBreakdown[];
  };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    byModel: AiModelUsage[];
    byApiKey: AiKeyUsage[];
  };
  configuration: {
    adminKeyConfigured: boolean;
    projectIdConfigured: boolean;
    spendLimitFound: boolean;
  };
  warnings: string[];
  alert: BillingAlert;
};

export type AppCostBreakdown = {
  key: string;
  label: string;
  cost: number;
};

export type AppCostDaily = {
  date: string;
  cost: number;
};

export type AppCostOverview = {
  provider: "google_cloud_billing";
  configured: boolean;
  connected: boolean;
  generatedAt: string;
  projectId: string;
  currency: string;
  export: {
    projectId: string;
    datasetId: string | null;
    tableId: string | null;
    detectedAutomatically: boolean;
  };
  costs: {
    currentMonth: number | null;
    previousMonth: number | null;
    last30Days: number | null;
    grossCurrentMonth: number | null;
    creditsCurrentMonth: number | null;
    daily: AppCostDaily[];
    byService: AppCostBreakdown[];
    bySku: AppCostBreakdown[];
  };
  setup: {
    billingExportFound: boolean;
    consoleUrl: string;
    requiredRoles: string[];
  };
  queryEstimate: {
    bytesPerQuery: number | null;
    maximumBytesBilled: number;
    monthlyPanelBytesAtHourlyRefresh: number | null;
    monthlyFreeBytes: number;
    note: string;
  };
  alert: BillingAlert;
  warnings: string[];
};
