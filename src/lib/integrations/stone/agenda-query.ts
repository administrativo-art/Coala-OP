import { z } from "zod";
import { AppError } from "../../observability/app-error";
import { parseStoneAgendaXml } from "./agenda-parser";

export const stoneAgendaQuerySchema = z.object({
  stoneCode: z.string().regex(/^\d{1,20}$/),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  transactionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Admin-only preview: deliberately independent of ingestion/persistence.
 * A non-admin reader will need the existing merchant mapping and unit policy. */
export async function queryStoneAgenda(input: unknown, context: { isDefaultAdmin: boolean },
  read: (query: { stoneCode: string; referenceDate: string }) => Promise<string>) {
  if (!context.isDefaultAdmin) {
    throw new AppError({ code: "STONE_AGENDA_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const parsed = stoneAgendaQuerySchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: "STONE_AGENDA_QUERY_INVALID", kind: "VALIDATION" });
  const query = parsed.data;
  const result = parseStoneAgendaXml(await read({ stoneCode: query.stoneCode, referenceDate: query.referenceDate }), query);
  const rows = query.transactionId
    ? result.transactions.filter((row) => row.transactionId === query.transactionId) : result.transactions;
  const end = query.offset + query.limit;
  return { ...result, collectedAt: new Date().toISOString(),
    transactions: rows.slice(query.offset, end),
    totalTransactionsInFile: result.transactions.length,
    matchedTransactions: rows.length, nextOffset: end < rows.length ? end : null,
  };
}
