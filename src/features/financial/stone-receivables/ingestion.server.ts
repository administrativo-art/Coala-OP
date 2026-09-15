import { createHash } from "node:crypto";

import {
  stoneFinancialImportBatchSchema,
  stoneReceivableImportSchema,
  stoneSettlementImportSchema,
} from "./schemas";
import { stoneReceivableId, stoneSettlementId } from "./identity.server";
import type { StoneReceivable, StoneSettlement } from "./types";

export class StoneFinancialImportValidationError extends Error {
  constructor(message: string, readonly rowNumber?: number) {
    super(message);
    this.name = "StoneFinancialImportValidationError";
  }
}

function canonicalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validCivilDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function prepareStoneFinancialImport(raw: unknown): {
  workspaceId: string;
  source: "stone_receivables" | "stone_settlements";
  idempotencyKey: string;
  rows: Array<StoneReceivable | StoneSettlement>;
  duplicateCount: number;
} {
  const batch = stoneFinancialImportBatchSchema.safeParse(raw);
  if (!batch.success) throw new StoneFinancialImportValidationError("O lote financeiro Stone é inválido.");
  const rows = batch.data.rows.map((rawRow, index): StoneReceivable | StoneSettlement => {
    if (batch.data.source === "stone_receivables") {
      const parsed = stoneReceivableImportSchema.safeParse(rawRow);
      if (!parsed.success) throw new StoneFinancialImportValidationError(parsed.error.issues[0]?.message ?? "Recebível inválido.", index + 1);
      if (!validCivilDate(parsed.data.originalExpectedDate) || !validCivilDate(parsed.data.currentExpectedDate)) {
        throw new StoneFinancialImportValidationError("A data prevista é inválida.", index + 1);
      }
      const row = parsed.data;
      return {
        ...row,
        id: stoneReceivableId({ workspaceId: batch.data.workspaceId, receivableKey: row.receivableKey }),
        workspaceId: batch.data.workspaceId,
        kioskId: row.kioskId ?? null,
        sourceHash: canonicalHash(row),
      };
    }
    const parsed = stoneSettlementImportSchema.safeParse(rawRow);
    if (!parsed.success) throw new StoneFinancialImportValidationError(parsed.error.issues[0]?.message ?? "Liquidação inválida.", index + 1);
    const row = parsed.data;
    return {
      ...row,
      id: stoneSettlementId({ workspaceId: batch.data.workspaceId, externalSettlementId: row.externalSettlementId }),
      workspaceId: batch.data.workspaceId,
      sourceHash: canonicalHash(row),
    };
  });
  const unique = new Map<string, StoneReceivable | StoneSettlement>();
  for (const row of rows) {
    const previous = unique.get(row.id);
    if (previous && previous.sourceHash !== row.sourceHash) {
      throw new StoneFinancialImportValidationError("O lote contém revisões conflitantes para a mesma identidade.");
    }
    unique.set(row.id, row);
  }
  return {
    workspaceId: batch.data.workspaceId,
    source: batch.data.source,
    idempotencyKey: batch.data.idempotencyKey,
    rows: [...unique.values()],
    duplicateCount: rows.length - unique.size,
  };
}
