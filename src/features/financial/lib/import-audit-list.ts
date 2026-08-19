import type { ImportSessionItem, ImportSessionSummary } from "@/features/financial/types/import";

export type ImportAuditDayGroup = {
  date: string;
  label: string;
  weekday: string;
  netAmount: number;
  items: ImportSessionItem[];
};

const SOURCE_BALANCE_KEYS = new Set([
  "saldo",
  "balance",
  "saldocontabil",
  "saldodisponivel",
  "saldoaposlancamento",
  "saldoaposmovimentacao",
  "balanceafter",
  "runningbalance",
]);

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function parseSourceMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const compact = value
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (!compact) return null;

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const normalized = lastComma >= 0 && lastDot >= 0
    ? lastComma > lastDot
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "")
    : lastComma >= 0
    ? compact.replace(",", ".")
    : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findSourceBalance(value: unknown, depth = 0): number | null {
  if (!value || typeof value !== "object" || depth > 5) return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findSourceBalance(entry, depth + 1);
      if (match !== null) return match;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (!SOURCE_BALANCE_KEYS.has(normalizeKey(key))) continue;
    const parsed = parseSourceMoney(entry);
    if (parsed !== null) return parsed;
  }

  for (const entry of Object.values(record)) {
    const match = findSourceBalance(entry, depth + 1);
    if (match !== null) return match;
  }
  return null;
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toLocaleUpperCase("pt-BR")}${value.slice(1)}` : value;
}

export function getImportAuditSourceBalance(item: ImportSessionItem) {
  return findSourceBalance(item.bankStatementData);
}

export function groupImportAuditItems(items: ImportSessionItem[]): ImportAuditDayGroup[] {
  const groups = new Map<string, ImportAuditDayGroup>();

  for (const item of items) {
    const date = new Date(`${item.date}T12:00:00`);
    const validDate = !Number.isNaN(date.getTime());
    const label = validDate
      ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date)
      : item.date || "Sem data";
    const weekday = validDate
      ? capitalize(new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(date))
      : "Data não identificada";
    const key = item.date || "__without_date__";
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      existing.netAmount += item.amount;
      continue;
    }

    groups.set(key, {
      date: item.date,
      label,
      weekday,
      netAmount: item.amount,
      items: [item],
    });
  }

  return [...groups.values()];
}

export function getImportAuditProgress(summary: ImportSessionSummary) {
  const total = Math.max(Number(summary.total) || 0, 0);
  const treated = Math.min(
    total,
    Math.max(
      (Number(summary.audited) || 0) +
        (Number(summary.completed) || 0) +
        (Number(summary.ignored) || 0),
      0,
    ),
  );

  return {
    total,
    treated,
    percentage: total > 0 ? Math.round((treated / total) * 100) : 0,
  };
}
