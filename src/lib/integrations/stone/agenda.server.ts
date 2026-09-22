import "server-only";

import { fetchStoneAgendaXml } from "./agenda-transport";

/** Call only after the administrative query policy (or a future mapped unit policy).
 * The secret is injected by App Hosting from Secret Manager, not read by CLI. */
export function readStoneAgendaXml(input: { stoneCode: string; referenceDate: string }) {
  return fetchStoneAgendaXml(input, {
    apiKey: process.env.STONE_CONCILIATION_API_KEY,
  });
}
