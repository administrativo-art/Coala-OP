import type {
  InstagramBusinessSuiteDailyMetrics,
  InstagramBusinessSuiteTotals,
  InstagramInsightStoredDay,
  InstagramInsightsPeriod,
} from "./contracts";

export const businessSuiteMetricFields = [
  "views",
  "reach",
  "contentInteractions",
  "profileVisits",
  "profileLinkClicks",
  "followers",
] as const;

export type InstagramBusinessSuiteMetricField = (typeof businessSuiteMetricFields)[number];

export const businessSuiteExportTitles: Record<InstagramBusinessSuiteMetricField, string> = {
  views: "Visualizações",
  reach: "Alcance",
  contentInteractions: "Interações com o conteúdo",
  profileVisits: "Visitas ao perfil do Instagram",
  profileLinkClicks: "Cliques no link do Instagram",
  followers: "Seguidores no Instagram",
};

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseBusinessSuiteDailyMetrics(value: unknown): InstagramBusinessSuiteDailyMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const parsed = {
    views: finiteNonNegative(data.views),
    reach: finiteNonNegative(data.reach),
    contentInteractions: finiteNonNegative(data.contentInteractions),
    profileVisits: finiteNonNegative(data.profileVisits),
    profileLinkClicks: finiteNonNegative(data.profileLinkClicks),
    followers: finiteNonNegative(data.followers),
  };
  return Object.values(parsed).some((metric) => metric !== null) ? parsed : null;
}

export function aggregateBusinessSuiteHistory(daily: InstagramInsightStoredDay[]): InstagramBusinessSuiteTotals {
  const totals: InstagramBusinessSuiteTotals = {
    views: null,
    reach: null,
    contentInteractions: null,
    profileVisits: null,
    profileLinkClicks: null,
    followers: null,
    coveredDays: 0,
  };
  daily.forEach((day) => {
    if (!day.businessSuite) return;
    totals.coveredDays += 1;
    businessSuiteMetricFields.forEach((field) => {
      const value = day.businessSuite?.[field];
      if (value === null || value === undefined) return;
      totals[field] = (totals[field] ?? 0) + value;
    });
  });
  return totals;
}

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: number("year"), month: number("month"), day: number("day") };
}

export function instagramInsightsPeriodDays(period: InstagramInsightsPeriod, now = new Date()) {
  if (period !== "year") return period;
  const local = localDateParts(now);
  const today = Date.UTC(local.year, local.month - 1, local.day);
  const firstDay = Date.UTC(local.year, 0, 1);
  return Math.floor((today - firstDay) / (24 * 60 * 60 * 1_000)) + 1;
}

export function instagramInsightsYearStartIso(now = new Date()) {
  const local = localDateParts(now);
  return new Date(Date.UTC(local.year, 0, 1, 3)).toISOString();
}

function unquote(value: string) {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/""/g, '"');
}

export function parseBusinessSuiteCsv(text: string, field: InstagramBusinessSuiteMetricField) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (lines[0] !== "sep=,") throw new Error("O CSV não declara o separador esperado.");
  if (unquote(lines[1] ?? "") !== businessSuiteExportTitles[field]) {
    throw new Error(`O arquivo não corresponde à métrica ${businessSuiteExportTitles[field]}.`);
  }
  if (lines[2] !== '"Data","Primary"') throw new Error("O cabeçalho do CSV da Meta é inválido.");

  const values = new Map<string, number>();
  lines.slice(3).forEach((line, index) => {
    const match = line.match(/^"([^"]+)","([^"]+)"$/);
    if (!match) throw new Error(`Linha ${index + 4} inválida no CSV da Meta.`);
    const date = match[1]?.slice(0, 10) ?? "";
    const value = Number(match[2]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00.000Z`))) {
      throw new Error(`Data inválida na linha ${index + 4}.`);
    }
    if (!Number.isInteger(value) || value < 0) throw new Error(`Valor inválido na linha ${index + 4}.`);
    if (values.has(date)) throw new Error(`Data duplicada no CSV: ${date}.`);
    values.set(date, value);
  });
  if (!values.size) throw new Error("O CSV da Meta não contém dados.");
  return values;
}
