import { type NextRequest } from "next/server";

import { type DashboardFilters } from "./dashboard-service";

const MAX_RANGE_DAYS = 366;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export class DashboardFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardFilterError";
  }
}

export function parseDashboardFilters(
  request: NextRequest,
  workspaceId: string
): DashboardFilters {
  const search = request.nextUrl.searchParams;
  const defaults = defaultRange();
  const from = parseDateParam(search.get("from"), defaults.from, "start");
  const to = parseDateParam(search.get("to"), defaults.to, "end");

  if (from.getTime() > to.getTime()) {
    throw new DashboardFilterError(
      "Período inválido: from deve ser menor ou igual a to."
    );
  }

  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_IN_MS) {
    throw new DashboardFilterError(
      `Período inválido: selecione no máximo ${MAX_RANGE_DAYS} dias.`
    );
  }

  return {
    workspaceId,
    from,
    to,
    domainId: textParam(search.get("domain_id")),
    unitId: textParam(search.get("unit_id")),
    criterionId: textParam(search.get("criterion_id")),
    statusGroup: statusGroupParam(search.get("status_group")),
  };
}

export function parsePageSize(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("page_size");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DashboardFilterError("page_size deve ser um número positivo.");
  }
  return parsed;
}

export function dashboardFilterErrorResponse(error: DashboardFilterError) {
  return Response.json({ error: error.message }, { status: 400 });
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from, to };
}

function parseDateParam(
  value: string | null,
  fallback: Date,
  boundary: "start" | "end"
) {
  if (!value) return fallback;

  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = dateOnly
    ? new Date(
        `${trimmed}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`
      )
    : new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    throw new DashboardFilterError(`Data inválida: ${value}.`);
  }

  return parsed;
}

function textParam(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function statusGroupParam(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "resolved" ||
    normalized === "all"
  ) {
    return normalized;
  }
  throw new DashboardFilterError(
    "status_group deve ser open, resolved ou all."
  );
}
