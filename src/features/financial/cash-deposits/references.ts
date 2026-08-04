import type { CashDepositBatch, CashDepositBatchItem, CashDepositBatchItemSource } from "./types";

const KNOWN_KIOSK_CODES: Record<string, string> = {
  "joao-paulo": "JPA",
  tirirical: "TRI",
  matriz: "MAT",
};

function normalizeReferencePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function fallbackKioskCode(kioskId: string) {
  const normalized = normalizeReferencePart(kioskId);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0].slice(0, 1)}${words[1].slice(0, 2)}`.padEnd(3, "X").slice(0, 3);
  }
  if (words[0]?.length >= 3) return words[0].slice(0, 3);

  let hash = 0;
  for (const char of normalized || kioskId) hash = (hash * 31 + char.charCodeAt(0)) % 46_656;
  return hash.toString(36).toUpperCase().padStart(3, "0").slice(-3);
}

export function cashDepositKioskCode(kioskId: string) {
  const normalizedId = kioskId.trim().toLowerCase();
  return KNOWN_KIOSK_CODES[normalizedId] ?? fallbackKioskCode(normalizedId);
}

export function cashDepositBatchReference(input: Pick<CashDepositBatch, "kioskId" | "sequence">) {
  return `DEP-${cashDepositKioskCode(input.kioskId)}-${String(input.sequence).padStart(6, "0")}`;
}

export function cashDepositBatchReferenceFromId(kioskId: string, batchId: string) {
  const sequenceMatch = batchId.match(/_(\d+)$/);
  if (!sequenceMatch) return `DEP-${cashDepositKioskCode(kioskId)}-${batchId}`;
  return cashDepositBatchReference({ kioskId, sequence: Number(sequenceMatch[1]) });
}

export const CASH_DEPOSIT_SOURCE_LABEL: Record<CashDepositBatchItemSource, string> = {
  cash_counted: "Fechamento aprovado",
  cash_adjustment: "Ajuste de fechamento",
  manual_split: "Divisão manual",
};

export type CashDepositDayComposition = {
  date: string;
  amountCents: number;
  closureIds: string[];
  sources: CashDepositBatchItemSource[];
  itemCount: number;
};

export function groupCashDepositItemsByDay(items: CashDepositBatchItem[]): CashDepositDayComposition[] {
  const byDate = new Map<string, CashDepositDayComposition>();

  for (const item of items) {
    const current = byDate.get(item.closureDate) ?? {
      date: item.closureDate,
      amountCents: 0,
      closureIds: [],
      sources: [],
      itemCount: 0,
    };
    current.amountCents += item.amountCents;
    current.itemCount += 1;
    if (!current.closureIds.includes(item.closureId)) current.closureIds.push(item.closureId);
    if (!current.sources.includes(item.source)) current.sources.push(item.source);
    byDate.set(item.closureDate, current);
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}
