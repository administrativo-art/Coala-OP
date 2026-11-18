import { AppError } from "@/lib/observability/app-error";

const SCALE = BigInt("1000000000000");
const CENT = SCALE / BigInt(100);
export function feeUnits(value: string) {
  if (!/^\d{1,15}(?:\.\d{1,12})?$/.test(value)) throw new AppError({ code: "ACQUIRER_FEE_INVALID_AMOUNT", kind: "DATA_INTEGRITY" });
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"));
}
export function feeTotalCents(values: string[]) {
  const units = values.reduce((sum, item) => sum + feeUnits(item), BigInt(0));
  const rounded = (units + CENT / BigInt(2)) / CENT;
  if (rounded > BigInt(100_000_000)) throw new AppError({ code: "ACQUIRER_FEE_AMOUNT_LIMIT", kind: "DATA_INTEGRITY" });
  return Number(rounded);
}
