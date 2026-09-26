import { createHash } from "node:crypto";
import { z } from "zod";
import type { BankPaymentRequest } from "./types";

// Missing or masked documents are insufficient to clear a previous divergence.
const completeDocument = z.string().trim().regex(/^[\d.\-/\s]+$/)
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => value.length === 11 || value.length === 14);
const statementEvidenceSchema = z.object({
  type: z.literal("expense_payment"),
  direction: z.literal("out"),
  importSource: z.literal("inter_api"),
  importedFrom: z.literal("bank_statement"),
  auditStatus: z.literal("resolved"),
  reversed: z.literal(false).optional(),
  expenseId: z.string().min(1),
  linkedExpenseId: z.string().min(1),
  amount: z.number().finite().positive(),
  bankStatementData: z.object({
    tipoOperacao: z.literal("D"),
    tipoTransacao: z.literal("PIX"),
    detalhes: z.object({
      codigoSolicitacao: z.string().min(1),
      endToEndId: z.string().optional(),
      cpfCnpjRecebedor: completeDocument,
    }),
  }),
});

export function canRevalidatePaidBeneficiary(request: BankPaymentRequest) {
  return request.status === "paid"
    && request.paymentRail !== "barcode"
    && request.statementReconciliationStatus === "matched"
    && request.beneficiaryVerificationStatus === "divergent"
    && request.bankReconciliationDivergenceField === "receiver"
    && Boolean(request.statementTransactionId && request.expenseId && request.interRequestId);
}

/** Revalidates identity only; never settles, resubmits, or modifies a payment. */
export function planPaidBeneficiaryReview(input: {
  request: BankPaymentRequest;
  statementTransactionId: string;
  statement: unknown;
  observedAt: string;
}) {
  const { request } = input;
  if (!canRevalidatePaidBeneficiary(request) || request.paymentRail === "barcode") return null;
  if (request.statementTransactionId !== input.statementTransactionId) return null;
  const parsed = statementEvidenceSchema.safeParse(input.statement);
  if (!parsed.success) return null;
  const statement = parsed.data;
  const receiver = statement.bankStatementData.detalhes;
  if (statement.expenseId !== request.expenseId || statement.linkedExpenseId !== request.expenseId) return null;
  if (!Number.isFinite(request.amount) || Math.round(request.amount * 100) !== Math.round(statement.amount * 100)) return null;
  if (receiver.codigoSolicitacao !== request.interRequestId) return null;
  if (request.endToEndId && receiver.endToEndId !== request.endToEndId) return null;
  const snapshotHash = request.beneficiarySnapshot?.documentHash;
  if (!snapshotHash || !/^[a-f0-9]{64}$/.test(snapshotHash)) return null;
  if (createHash("sha256").update(receiver.cpfCnpjRecebedor).digest("hex") !== snapshotHash) return null;

  return {
    patch: {
      beneficiaryVerificationStatus: "verified" as const,
      beneficiaryVerificationWarning: null,
      beneficiaryVerificationObservedAt: input.observedAt,
      bankReconciliationDivergenceField: null,
      updatedAt: input.observedAt,
    },
    event: {
      type: "BENEFICIARY_VERIFIED_FROM_STATEMENT",
      at: input.observedAt,
      actorId: "system:bank-reconciliation",
      actorEmail: null,
      statementTransactionId: input.statementTransactionId,
      expenseId: request.expenseId!,
      previousVerificationStatus: request.beneficiaryVerificationStatus!,
      previousWarning: request.beneficiaryVerificationWarning ?? null,
      evidence: "linked_inter_pix_receiver_document_hash",
    },
  };
}
