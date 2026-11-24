import "server-only";

import { reportSystemError } from "@/lib/observability/reporter";
import { latestPublishedDate } from "../receivables/period-review";
import { buildStoneAccountMonth, type StoneAccountDependencies } from "./reconciliation.server";
import { saveStoneReceiptSnapshot } from "./stone-account-snapshot.server";
import { receiptMonthRange, receiptMonthsToRefresh } from "./stone-account";

type DailySource = { workspaceId: string; stoneCode: string; kioskId: string; mappingId: string };
type ReadFile = NonNullable<StoneAccountDependencies["readFile"]>;

/**
 * Rotina diária (chamada após a sincronização da carteira): confere o mês do último arquivo
 * publicado e, nos 7 primeiros dias, o anterior, lendo os arquivos já guardados. Falha de um
 * StoneCode não interrompe os demais; o erro é registrado e a tela mostra a última conferência.
 */
export async function refreshStoneReceiptSnapshots(sources: DailySource[], readFile: ReadFile, now = new Date()) {
  const latest = latestPublishedDate(now);
  const results: Array<{ stoneCode: string; month: string; status: "written" | "unchanged" | "failed" }> = [];
  for (const source of sources) {
    for (const month of receiptMonthsToRefresh(latest)) {
      try {
        const range = receiptMonthRange(month);
        const result = await buildStoneAccountMonth({ view: "month", kioskId: source.kioskId, stoneCode: source.stoneCode, from: range.from, through: range.through },
          source.workspaceId, { readFile, now });
        const saved = await saveStoneReceiptSnapshot({ workspaceId: source.workspaceId, mappingId: result.scope.mappingId, kioskId: result.scope.kioskId, stoneCode: source.stoneCode, month }, result, now);
        results.push({ stoneCode: source.stoneCode, month, status: saved.written ? "written" : "unchanged" });
      } catch (error) {
        reportSystemError({ error, source: "stone-conciliation", operation: "refresh-stone-receipt-snapshot",
          routeOrJob: "/api/financial/stone-portfolio-cron", metadata: { month } });
        results.push({ stoneCode: source.stoneCode, month, status: "failed" });
      }
    }
  }
  return results;
}
