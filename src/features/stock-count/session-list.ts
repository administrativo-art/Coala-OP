import { z } from "zod";

import {
  STOCK_COUNT_HISTORY_MAX_DAYS,
  STOCK_COUNT_SESSION_PAGE_SIZE,
} from "./lib/visibility";

const civilDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const stockCountSessionListQuerySchema = z.object({
  view: z.enum(["open", "history"]).default("open"),
  kioskId: z.string().trim().min(1).max(160).optional(),
  status: z.enum(["all", "pending_review", "completed"]).default("all"),
  from: civilDateSchema.optional(),
  to: civilDateSchema.optional(),
  cursorStartedAt: z.string().datetime().optional(),
  cursorId: z.string().trim().min(1).max(256).optional(),
  pageSize: z.coerce.number().int().min(10).max(STOCK_COUNT_SESSION_PAGE_SIZE).default(STOCK_COUNT_SESSION_PAGE_SIZE),
}).strict().superRefine((input, context) => {
  if ((input.cursorStartedAt && !input.cursorId) || (!input.cursorStartedAt && input.cursorId)) {
    context.addIssue({ code: "custom", message: "Cursor incompleto." });
  }
  if (input.view !== "history") return;
  if (!input.from || !input.to) {
    context.addIssue({ code: "custom", message: "O histórico exige período inicial e final." });
    return;
  }
  const from = new Date(`${input.from}T00:00:00.000Z`);
  const to = new Date(`${input.to}T23:59:59.999Z`);
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > STOCK_COUNT_HISTORY_MAX_DAYS) {
    context.addIssue({
      code: "custom",
      message: `O período deve conter entre 1 e ${STOCK_COUNT_HISTORY_MAX_DAYS} dias.`,
    });
  }
});

export type StockCountSessionListQuery = z.infer<typeof stockCountSessionListQuerySchema>;

export function stockCountHistoryBounds(from: string, to: string) {
  return {
    fromIso: `${from}T00:00:00.000Z`,
    toIso: `${to}T23:59:59.999Z`,
  };
}
