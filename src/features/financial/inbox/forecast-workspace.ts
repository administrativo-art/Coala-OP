import { WORKSPACE_ID } from "@/lib/workspace";

export function forecastWorkspaceMatches(
  forecast: Record<string, unknown>, expectedWorkspaceId: string, verifiedTelecomIdentity: boolean,
  confirmedFiscalKind?: string | null,
): boolean {
  if (forecast.workspaceId === expectedWorkspaceId) return true;
  if (forecast.workspaceId != null) return false;
  if (verifiedTelecomIdentity) return true;
  // The original DAS series predates workspaceId and unitId. Require its
  // exact series and a confirmed DAS document in the original workspace.
  if (expectedWorkspaceId === WORKSPACE_ID
    && forecast.sourceType === "das_forecast"
    && forecast.provisionSeriesKey === "das-simples-nacional"
    && confirmedFiscalKind === "das") return true;
  // Recurring forecasts created before workspaceId belong to the original deployment.
  // Keep the legacy exception limited to that source, a recorded unit, and its default workspace.
  return expectedWorkspaceId === WORKSPACE_ID
    && forecast.sourceType === "recurring_expense_forecast"
    && typeof forecast.unitId === "string" && forecast.unitId.trim().length > 0;
}
