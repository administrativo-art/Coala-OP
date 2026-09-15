export type StoneMerchantMappingStatus = "active" | "inactive";

export type StoneMerchantMapping = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  accountId: string;
  accountName: string;
  stoneCodes: string[];
  terminalIds: string[];
  legalEntityDocument?: string | null;
  merchantName?: string | null;
  secretReference?: string | null;
  status: StoneMerchantMappingStatus;
  validFrom: string;
  validTo?: string | null;
  notes?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type StoneMerchantMappingDraft = Pick<
  StoneMerchantMapping,
  | "kioskId"
  | "accountId"
  | "stoneCodes"
  | "terminalIds"
  | "legalEntityDocument"
  | "merchantName"
  | "secretReference"
  | "status"
  | "validFrom"
  | "validTo"
  | "notes"
>;

export type StoneIngestionRun = {
  id: string;
  source: "pdv" | "stone_sales" | "stone_receivables" | "stone_settlements";
  status: "processing" | "completed" | "failed";
  period?: string | null;
  rowCount: number;
  duplicateCount: number;
  attemptCount: number;
  finalize?: boolean;
  actorId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  result?: {
    importedCount?: number;
    duplicateCount?: number;
    source?: string;
  } | null;
};

function intersects(left: string[], right: string[]) {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

export function normalizeStoneMappingCodes(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))].sort();
}

export function stoneMappingsOverlap(
  left: Pick<StoneMerchantMapping, "status" | "stoneCodes" | "terminalIds">,
  right: Pick<StoneMerchantMapping, "status" | "stoneCodes" | "terminalIds">,
) {
  if (left.status !== "active" || right.status !== "active") return false;
  const leftCodes = normalizeStoneMappingCodes(left.stoneCodes);
  const rightCodes = normalizeStoneMappingCodes(right.stoneCodes);
  if (!intersects(leftCodes, rightCodes)) return false;
  const leftTerminals = normalizeStoneMappingCodes(left.terminalIds);
  const rightTerminals = normalizeStoneMappingCodes(right.terminalIds);
  return leftTerminals.length === 0
    || rightTerminals.length === 0
    || intersects(leftTerminals, rightTerminals);
}
