import { WORKSPACE_ID } from "@/lib/workspace";

export function forecastWorkspaceMatches(
  forecast: Record<string, unknown>, expectedWorkspaceId: string, verifiedTelecomIdentity: boolean,
): boolean {
  if (forecast.workspaceId === expectedWorkspaceId) return true;
  if (forecast.workspaceId != null) return false;
  if (verifiedTelecomIdentity) return true;
  // Recurring forecasts created before workspaceId belong to the original deployment.
  // Keep the legacy exception limited to that source, a recorded unit, and its default workspace.
  return expectedWorkspaceId === WORKSPACE_ID
    && forecast.sourceType === "recurring_expense_forecast"
    && typeof forecast.unitId === "string" && forecast.unitId.trim().length > 0;
}
