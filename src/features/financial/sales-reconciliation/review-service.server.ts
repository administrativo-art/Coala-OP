import "server-only";
import { fetchPdvCouponsReadOnly } from "@/lib/integrations/pdv-coupon-read";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { queryDailySales } from "./query";
import { readSalesReviewBinding } from "./mapping.server";
import { readPixSalesSource } from "./pix-source.server";
import { saveDailySalesReview } from "./review-state.server";

export async function collectDailySalesReview(input: unknown, context: { isDefaultAdmin: boolean; workspace_id: string },
  actorId: string, signal?: AbortSignal) {
  const result = await queryDailySales(input, context, {
    signal,
    resolveBinding: readSalesReviewBinding,
    readPix: readPixSalesSource,
    readPdv: query => fetchPdvCouponsReadOnly(query, { signal, credentials: {
      company: process.env.PDVLEGAL_COD_EMPRESA,
      token: process.env.PDVLEGAL_TOKEN,
      username: process.env.PDVLEGAL_USERNAME,
      password: process.env.PDVLEGAL_PASSWORD,
    } }),
    readStone: query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }),
  });
  const review = await saveDailySalesReview(result, actorId);
  return { ...result, review };
}
