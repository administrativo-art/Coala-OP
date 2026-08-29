import { canAccessUnit, type UnitAccessUser } from "@/lib/unit-access";
import { type StockAuditSession } from "@/types";

export const OWN_OPEN_STOCK_COUNT_SESSION_LIMIT = 25;
export const STOCK_COUNT_SESSION_PAGE_SIZE = 100;
export const STOCK_COUNT_SESSION_MAX_UNIT_FILTERS = 90;
export const STOCK_COUNT_HISTORY_MAX_DAYS = 366;

export type StockCountSessionSummary = Pick<
  StockAuditSession,
  "id" | "kioskId" | "kioskName" | "status" | "auditedBy" | "startedAt" | "completedAt" | "taskId" | "workspaceId"
>;

export type StockCountVisibilityContext = {
  user: UnitAccessUser | null | undefined;
  canView: boolean;
  isDefaultAdmin?: boolean;
};

export function canViewOpenStockCountSession(
  session: Pick<StockAuditSession, "kioskId" | "status">,
  context: StockCountVisibilityContext,
) {
  return session.status === "pending_review" &&
    context.canView &&
    !!context.user &&
    canAccessUnit(context.user, session.kioskId, {
      isDefaultAdmin: context.isDefaultAdmin,
    });
}

export function filterVisibleOpenStockCountSessions<
  T extends Pick<StockAuditSession, "kioskId" | "status">
>(
  sessions: T[],
  context: StockCountVisibilityContext,
) {
  return sessions.filter((session) => canViewOpenStockCountSession(session, context));
}

export function isStockCountSessionOwnedByUser(
  session: Pick<StockAuditSession, "auditedBy">,
  userId: string | null | undefined,
) {
  return !!userId && session.auditedBy?.userId === userId;
}
