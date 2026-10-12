import { z } from "zod";

/** Days of PDV history the app may list, whatever the cutoff says. One PDV request per day. */
export const LOCAL_PURCHASE_WITHDRAWAL_MAX_DAYS = 14;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Dates the app lists, newest first. The cutoff hides sangrias older than the
 * go-live of the app flow; the day limit bounds the PDV fan-out.
 */
export function localPurchaseWithdrawalDates(today: string, cutoff?: string | null) {
  const validCutoff = cutoff && isoDate.safeParse(cutoff).success ? cutoff : null;
  const dates: string[] = [];
  for (let offset = 0; offset < LOCAL_PURCHASE_WITHDRAWAL_MAX_DAYS; offset += 1) {
    const date = shiftDate(today, -offset);
    if (validCutoff && date < validCutoff) break;
    dates.push(date);
  }
  return dates;
}

/** Compra em dinheiro registrada sem sangria; o operador a concilia quando a sangria aparecer. */
export type AwaitingLocalPurchase = { id: string; unitId: string; supplierName: string; purchaseDate: string; totalCents: number };

export type OpenLocalPurchaseWithdrawal = {
  sourceId: string;
  unitId: string;
  unitName: string;
  date: string;
  time: string | null;
  amountCents: number;
  operatorName: string | null;
};
