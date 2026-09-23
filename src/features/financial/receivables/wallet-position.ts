import { AppError } from "@/lib/observability/app-error";
import { stoneAgendaQuerySchema } from "@/lib/integrations/stone/agenda-query";
import { parseStoneWalletPosition } from "@/lib/integrations/stone/wallet-position-parser";
import { latestPublishedDate } from "./period-review";

export const walletPositionQuerySchema = stoneAgendaQuerySchema
  .pick({ stoneCode: true, referenceDate: true, offset: true, limit: true }).strict();

/** Administrative source inspection, with explicit StoneCode and no inferred unit. */
export async function queryStoneWalletPosition(input: unknown, context: { isDefaultAdmin: boolean }, deps: {
  read: (scope: { stoneCode: string; referenceDate: string }) => Promise<string>;
  now?: Date;
}) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_WALLET_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = walletPositionQuerySchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: "STONE_WALLET_QUERY_INVALID", kind: "VALIDATION" });
  const query = parsed.data;
  if (query.referenceDate > latestPublishedDate(deps.now ?? new Date())) {
    throw new AppError({ code: "STONE_WALLET_NOT_PUBLISHED", kind: "VALIDATION",
      safeMessage: "Consulte uma data já disponibilizada pela Stone após as 05h do dia seguinte." });
  }
  const result = parseStoneWalletPosition(await deps.read({ stoneCode: query.stoneCode, referenceDate: query.referenceDate }), query);
  const end = query.offset + query.limit;
  return { ...result, collectedAt: new Date().toISOString(), totalRowsInFile: result.rows.length,
    rows: result.rows.slice(query.offset, end), nextOffset: end < result.rows.length ? end : null };
}
