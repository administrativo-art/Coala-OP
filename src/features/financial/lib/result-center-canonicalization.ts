type RawRecord = Record<string, unknown>;

export const MAX_EXPENSE_RESULT_CENTER_REFERENCES = 100;

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RawRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function entries(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function canonicalizeEntry(value: unknown, namesById: Record<string, string>) {
  const entry = asRecord(value);
  if (!entry) return value;
  const resultCenterId = text(entry.resultCenterId);
  if (!resultCenterId) return entry;
  return {
    ...entry,
    resultCenterId,
    resultCenterName: namesById[resultCenterId],
  };
}

export function expenseDraftResultCenterIds(value: unknown) {
  const draft = asRecord(value) ?? {};
  const mode = text(draft.mode) || "new";
  if (mode !== "new" && mode !== "split") return [];

  const references: unknown[] = mode === "split"
    ? [...entries(draft.splitExpenses)]
    : [draft];

  if (mode === "new" && draft.isApportioned === true) references.push(...entries(draft.apportionments));
  if (mode === "new" && draft.hasPersonAllocations === true) references.push(...entries(draft.personAllocations));

  return [...new Set(
    references
      .map((entry) => text(asRecord(entry)?.resultCenterId))
      .filter(Boolean),
  )];
}

/**
 * O ID e o nome do centro formam um único vínculo. O cliente pode manter um
 * nome antigo em memória, então o servidor sempre resolve o nome pelo cadastro
 * atual antes de materializar despesa, rateio, individualização ou divisão.
 */
export function canonicalizeExpenseDraftResultCenters(
  value: unknown,
  namesById: Record<string, string>,
) {
  const draft = asRecord(value) ?? {};
  const mode = text(draft.mode) || "new";
  const resultCenterIds = expenseDraftResultCenterIds(draft);

  if (resultCenterIds.length > MAX_EXPENSE_RESULT_CENTER_REFERENCES) {
    throw new Error("RESULT_CENTER_NOT_FOUND");
  }
  if (resultCenterIds.some((resultCenterId) => !text(namesById[resultCenterId]))) {
    throw new Error("RESULT_CENTER_NOT_FOUND");
  }

  const result = mode === "new"
    ? canonicalizeEntry(draft, namesById) as RawRecord
    : { ...draft };
  if (mode === "split" && Array.isArray(draft.splitExpenses)) {
    result.splitExpenses = draft.splitExpenses.map((entry) => canonicalizeEntry(entry, namesById));
  }
  if (mode === "new" && draft.isApportioned === true && Array.isArray(draft.apportionments)) {
    result.apportionments = draft.apportionments.map((entry) => canonicalizeEntry(entry, namesById));
  }
  if (mode === "new" && draft.hasPersonAllocations === true && Array.isArray(draft.personAllocations)) {
    result.personAllocations = draft.personAllocations.map((entry) => canonicalizeEntry(entry, namesById));
  }

  return result;
}
