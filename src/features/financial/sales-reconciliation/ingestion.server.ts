import { createHash } from "node:crypto";
import { z } from "zod";

import { shiftClosureDate } from "@/features/financial/cash-closures/date";
import {
  pdvPaymentFactId,
  stoneSaleTransactionId,
} from "./identity.server";
import {
  canonicalPdvPaymentImportSchema,
  canonicalSalesImportBatchSchema,
  canonicalStoneSaleImportSchema,
} from "./schemas";
import {
  normalizePdvSaleStatus,
  normalizeReconciliationChannel,
  normalizeSalesIdentifiers,
  normalizeStoneSaleStatus,
  reconciliationBusinessDate,
} from "./normalization";
import type { PdvPaymentFact, StoneSaleTransaction } from "./types";

export class SalesImportValidationError extends Error {
  readonly rowIndex: number | null;
  readonly cause: unknown;

  constructor(message: string, options?: { rowIndex?: number; cause?: unknown }) {
    super(message);
    this.name = "SalesImportValidationError";
    this.rowIndex = options?.rowIndex ?? null;
    this.cause = options?.cause;
  }
}

function canonicalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validatedBusinessDate(soldAt: string, rowIndex: number) {
  try {
    const businessDate = reconciliationBusinessDate(soldAt);
    shiftClosureDate(businessDate, 0);
    return businessDate;
  } catch (cause) {
    throw new SalesImportValidationError("A venda contém data ou horário inválido.", { rowIndex, cause });
  }
}

function ensureExpectedDate(input: {
  businessDate: string;
  period: string;
  expectedBusinessDate?: string;
  rowIndex: number;
}) {
  if (input.businessDate.slice(0, 7) !== input.period) {
    throw new SalesImportValidationError("A venda não pertence à competência informada.", { rowIndex: input.rowIndex });
  }
  if (input.expectedBusinessDate && input.businessDate !== input.expectedBusinessDate) {
    throw new SalesImportValidationError("A venda não pertence ao dia informado.", { rowIndex: input.rowIndex });
  }
}

function deduplicate<T extends { id: string; sourceHash: string }>(rows: T[]) {
  const byId = new Map<string, T>();
  let duplicateCount = 0;
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    duplicateCount++;
    if (existing.sourceHash !== row.sourceHash) {
      throw new SalesImportValidationError("O lote contém duas revisões diferentes para a mesma venda.");
    }
  }
  return { rows: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)), duplicateCount };
}

export function prepareCanonicalSalesImportBatch(raw: unknown): {
  workspaceId: string;
  source: "pdv" | "stone_sales";
  period: string;
  businessDates: string[];
  idempotencyKey: string;
  finalize: boolean;
  rows: Array<PdvPaymentFact | StoneSaleTransaction>;
  duplicateCount: number;
} {
  const batch = canonicalSalesImportBatchSchema.safeParse(raw);
  if (!batch.success) {
    throw new SalesImportValidationError("O lote de vendas não atende ao contrato canônico.", { cause: batch.error });
  }

  const prepared = batch.data.rows.map((row, rowIndex): PdvPaymentFact | StoneSaleTransaction => {
    if (batch.data.source === "pdv") {
      const parsed = canonicalPdvPaymentImportSchema.safeParse(row);
      if (!parsed.success) {
        throw new SalesImportValidationError("Uma linha do PDV não atende ao contrato canônico.", { rowIndex, cause: parsed.error });
      }
      const channel = normalizeReconciliationChannel(parsed.data.channel);
      if (!channel) {
        throw new SalesImportValidationError("A linha do PDV não representa Pix, débito ou crédito.", { rowIndex });
      }
      const businessDate = validatedBusinessDate(parsed.data.soldAt, rowIndex);
      ensureExpectedDate({ businessDate, period: batch.data.period, expectedBusinessDate: batch.data.businessDate, rowIndex });
      const id = pdvPaymentFactId({
        workspaceId: batch.data.workspaceId,
        kioskId: parsed.data.kioskId,
        couponId: parsed.data.couponId,
        paymentIndex: parsed.data.paymentIndex,
      });
      return {
        id,
        workspaceId: batch.data.workspaceId,
        kioskId: parsed.data.kioskId,
        kioskName: parsed.data.kioskName,
        couponId: parsed.data.couponId,
        paymentIndex: parsed.data.paymentIndex,
        soldAt: parsed.data.soldAt,
        businessDate,
        period: batch.data.period,
        channel,
        grossAmountCents: parsed.data.grossAmountCents,
        status: normalizePdvSaleStatus(parsed.data.status),
        operatorId: parsed.data.operatorId,
        identifiers: normalizeSalesIdentifiers(parsed.data.identifiers),
        sourceHash: canonicalHash(parsed.data),
        sourceRevision: parsed.data.sourceRevision,
      };
    }

    const parsed = canonicalStoneSaleImportSchema.safeParse(row);
    if (!parsed.success) {
      throw new SalesImportValidationError("Uma linha Stone não atende ao contrato canônico.", { rowIndex, cause: parsed.error });
    }
    const channel = normalizeReconciliationChannel(parsed.data.channel);
    if (!channel) {
      throw new SalesImportValidationError("A linha Stone não representa Pix, débito ou crédito.", { rowIndex });
    }
    const businessDate = validatedBusinessDate(parsed.data.soldAt, rowIndex);
    ensureExpectedDate({ businessDate, period: batch.data.period, expectedBusinessDate: batch.data.businessDate, rowIndex });
    const id = stoneSaleTransactionId({
      workspaceId: batch.data.workspaceId,
      externalTransactionId: parsed.data.externalTransactionId,
    });
    return {
      id,
      workspaceId: batch.data.workspaceId,
      externalTransactionId: parsed.data.externalTransactionId,
      stoneCode: parsed.data.stoneCode,
      kioskId: parsed.data.kioskId ?? null,
      kioskName: parsed.data.kioskName,
      soldAt: parsed.data.soldAt,
      businessDate,
      period: batch.data.period,
      channel,
      grossAmountCents: parsed.data.grossAmountCents,
      installmentCount: parsed.data.installmentCount,
      brand: parsed.data.brand,
      status: normalizeStoneSaleStatus(parsed.data.status),
      identifiers: normalizeSalesIdentifiers({
        ...parsed.data.identifiers,
        providerTransactionId: parsed.data.identifiers.providerTransactionId
          || parsed.data.externalTransactionId,
      }),
      sourceHash: canonicalHash(parsed.data),
      sourceRevision: parsed.data.sourceRevision,
    };
  });

  const unique = deduplicate(prepared);
  return {
    workspaceId: batch.data.workspaceId,
    source: batch.data.source,
    period: batch.data.period,
    businessDates: [...new Set(unique.rows.map((row) => row.businessDate))].sort(),
    idempotencyKey: batch.data.idempotencyKey,
    finalize: batch.data.finalize,
    rows: unique.rows,
    duplicateCount: unique.duplicateCount,
  };
}

export function explainSalesImportValidation(error: SalesImportValidationError) {
  return {
    message: error.message,
    rowNumber: error.rowIndex === null ? null : error.rowIndex + 1,
    issues: error.cause instanceof z.ZodError
      ? error.cause.issues.slice(0, 10).map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      : [],
  };
}
