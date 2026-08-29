import {
  CASH_COUNTING_COIN_VALUES_CENTS,
  CASH_COUNTING_DENOMINATION_VALUES_CENTS,
  CASH_COUNTING_NOTE_VALUES_CENTS,
  type CashCountingDenomination,
  type CashCountingDenominationValueCents,
  type CashCountingSessionBag,
} from "./types";

const NOTE_VALUES = new Set<number>(CASH_COUNTING_NOTE_VALUES_CENTS);
const COIN_VALUES = new Set<number>(CASH_COUNTING_COIN_VALUES_CENTS);

export function isCashCountingDenominationValue(value: number): value is CashCountingDenominationValueCents {
  return (CASH_COUNTING_DENOMINATION_VALUES_CENTS as readonly number[]).includes(value);
}

export function normalizeCashCountingDenominations(
  entries: Array<{ valueCents: number; quantity: number }>,
) {
  const quantities = new Map<number, number>();
  for (const entry of entries) {
    if (!isCashCountingDenominationValue(entry.valueCents)) {
      throw new Error(`Denominação inválida: ${entry.valueCents} centavos.`);
    }
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) {
      throw new Error("A quantidade de cada denominação deve ser um inteiro não negativo.");
    }
    if (quantities.has(entry.valueCents)) {
      throw new Error(`A denominação de ${entry.valueCents} centavos foi informada mais de uma vez.`);
    }
    quantities.set(entry.valueCents, entry.quantity);
  }

  const denominations: CashCountingDenomination[] = CASH_COUNTING_DENOMINATION_VALUES_CENTS.map((valueCents) => {
    const quantity = quantities.get(valueCents) ?? 0;
    return {
      valueCents,
      kind: NOTE_VALUES.has(valueCents) ? "note" as const : "coin" as const,
      quantity,
      totalCents: valueCents * quantity,
    };
  });
  const noteTotalCents = denominations
    .filter((entry) => entry.kind === "note")
    .reduce((total, entry) => total + entry.totalCents, 0);
  const coinTotalCents = denominations
    .filter((entry) => entry.kind === "coin")
    .reduce((total, entry) => total + entry.totalCents, 0);
  return {
    denominations,
    noteTotalCents,
    coinTotalCents,
    totalCents: noteTotalCents + coinTotalCents,
  };
}

export function buildCashCountingBags(input: {
  sessionId: string;
  denominations: CashCountingDenomination[];
  maxCents: number;
  source: CashCountingSessionBag["source"];
  startingSequence?: number;
}) {
  if (!Number.isSafeInteger(input.maxCents) || input.maxCents <= 0) {
    throw new Error("Limite de malote inválido.");
  }
  const notes = input.denominations.filter((entry) => entry.kind === "note" && entry.quantity > 0);
  if (notes.some((entry) => !NOTE_VALUES.has(entry.valueCents))) {
    throw new Error("Somente cédulas podem compor um malote antes da troca de moedas.");
  }
  const totalCents = notes.reduce((total, entry) => total + entry.totalCents, 0);
  if (totalCents === 0) return [];
  const bagCount = Math.ceil(totalCents / input.maxCents);
  const bags = Array.from({ length: bagCount }, (_, index) => ({
    id: `${input.sessionId}_bag_${String((input.startingSequence ?? 1) + index).padStart(3, "0")}`,
    sequence: (input.startingSequence ?? 1) + index,
    totalCents: 0,
    quantities: new Map<number, number>(),
  }));

  for (const denomination of notes.sort((left, right) => right.valueCents - left.valueCents)) {
    for (let index = 0; index < denomination.quantity; index++) {
      const target = bags
        .filter((bag) => bag.totalCents + denomination.valueCents <= input.maxCents)
        .sort((left, right) => left.totalCents - right.totalCents || left.sequence - right.sequence)[0];
      if (!target) throw new Error("Não foi possível distribuir as cédulas dentro do limite dos malotes.");
      target.totalCents += denomination.valueCents;
      target.quantities.set(denomination.valueCents, (target.quantities.get(denomination.valueCents) ?? 0) + 1);
    }
  }

  return bags.map((bag): CashCountingSessionBag => ({
    id: bag.id,
    sequence: bag.sequence,
    totalCents: bag.totalCents,
    denominations: CASH_COUNTING_NOTE_VALUES_CENTS.map((valueCents) => {
      const quantity = bag.quantities.get(valueCents) ?? 0;
      return {
        valueCents,
        kind: "note",
        quantity,
        totalCents: valueCents * quantity,
      };
    }),
    batchId: null,
    source: input.source,
  }));
}

export function cashCountingDenominationKind(valueCents: number) {
  if (NOTE_VALUES.has(valueCents)) return "note" as const;
  if (COIN_VALUES.has(valueCents)) return "coin" as const;
  return null;
}
