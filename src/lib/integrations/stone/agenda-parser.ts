import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { AppError } from "../../observability/app-error";
import { STONE_AGENDA_MAX_BYTES } from "./agenda-transport";

const text = z.string().trim().min(1).max(128);
const decimal = z.string().regex(/^-?\d{1,15}(?:\.\d{1,12})?$/);
const integer = z.string().regex(/^\d{1,9}$/);
const date = z.string().regex(/^\d{8}$/).refine((value) => {
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
});
const timestamp = z.string().regex(/^\d{8}([01]\d|2[0-3])[0-5]\d[0-5]\d$/)
  .refine((value) => date.safeParse(value.slice(0, 8)).success);
const optionalDate = date.optional();
const events = z.object({
  Captures: integer, Payments: integer, Cancellations: integer,
  CancellationCharges: integer, Chargebacks: integer, ChargebackRefunds: integer,
});
const installment = z.object({
  InstallmentNumber: integer,
  GrossAmount: decimal,
  NetAmount: decimal,
  PrevisionPaymentDate: optionalDate,
  PaymentDate: optionalDate,
  OriginalPaymentDate: optionalDate,
  PaymentId: text.optional(),
  MdrAmount: decimal.optional(),
  SaleFee: decimal.optional(),
  SuspendedByChargeback: z.enum(["True", "False", "true", "false"]).optional(),
});
const transaction = z.object({
  AcquirerTransactionKey: text,
  AuthorizationDateTime: timestamp.optional(),
  CaptureLocalDateTime: timestamp.optional(),
  AccountType: text.optional(),
  BrandId: text.optional(),
  FeeType: text.optional(),
  NumberOfInstallments: integer.optional(),
  AuthorizationCurrencyCode: z.literal("986").optional(),
  CapturedAmount: decimal.optional(),
  CanceledAmount: decimal.optional(),
  Events: events,
  Installments: z.union([z.literal(""), z.object({ Installment: z.array(installment).max(99) })]).optional(),
});
const section = z.union([z.literal(""), z.object({
  Transaction: z.array(transaction).max(5000), "#text": z.never().optional(),
})]);
const fileSchema = z.object({
  Conciliation: z.object({
    Header: z.object({
      StoneCode: z.string().regex(/^\d{1,20}$/), ReferenceDate: date,
      LayoutVersion: z.literal("2.2"), FileId: text,
      GenerationDateTime: timestamp,
    }),
    FinancialTransactions: section,
    FinancialTransactionsAccounts: section,
  }),
});

function invalid(): never {
  throw new AppError({
    code: "STONE_AGENDA_INVALID_FILE", kind: "PERMANENT_EXTERNAL",
    safeMessage: "O arquivo da Stone não corresponde ao contrato esperado.",
  });
}
const civil = (value: string | undefined) => value
  ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;

/** Allowlisted view, not a ledger import. Preserve provider decimal precision;
 * never use the Pix CSV cents parser for XML amounts or infer contractual MDR. */
export function parseStoneAgendaXml(xml: string, expected: { stoneCode: string; referenceDate: string }) {
  if (Buffer.byteLength(xml, "utf8") > STONE_AGENDA_MAX_BYTES || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) invalid();
  let raw: unknown;
  try {
    if (XMLValidator.validate(xml) !== true) invalid();
    raw = new XMLParser({
      parseTagValue: false, ignoreAttributes: true, processEntities: false,
      isArray: (name) => name === "Transaction" || name === "Installment",
    }).parse(xml);
  } catch { invalid(); }
  const validated = fileSchema.safeParse(raw);
  if (!validated.success) invalid();
  const file = validated.data.Conciliation;
  if (file.Header.StoneCode.replace(/^0+(?=\d)/, "") !== expected.stoneCode.replace(/^0+(?=\d)/, "") ||
      civil(file.Header.ReferenceDate) !== expected.referenceDate) {
    throw new AppError({ code: "STONE_AGENDA_SCOPE_MISMATCH", kind: "DATA_INTEGRITY" });
  }
  const sections = [
    ["FinancialTransactions", file.FinancialTransactions],
    ["FinancialTransactionsAccounts", file.FinancialTransactionsAccounts],
  ] as const;
  const transactions = sections.flatMap(([sourceSection, values]) => {
    const seen = new Set<string>();
    return (values === "" ? [] : values.Transaction).map((row) => {
      if (seen.has(row.AcquirerTransactionKey)) invalid();
      seen.add(row.AcquirerTransactionKey);
      const installments = typeof row.Installments === "object" ? row.Installments.Installment : [];
      const numbers = installments.map((item) => Number(item.InstallmentNumber));
      if (new Set(numbers).size !== numbers.length || numbers.some((value) => value < 1 || value > 99)) invalid();
      return {
        sourceSection,
        transactionId: row.AcquirerTransactionKey,
        captureLocalDateTime: row.CaptureLocalDateTime ?? null,
        authorizationDateTimeUtc: row.AuthorizationDateTime ?? null,
        accountTypeCode: row.AccountType ?? null,
        brandCode: row.BrandId ?? null,
        feeTypeCode: row.FeeType ?? null,
        currencyCode: row.AuthorizationCurrencyCode ?? null,
        installmentCount: row.NumberOfInstallments ? Number(row.NumberOfInstallments) : null,
        capturedAmount: row.CapturedAmount ?? null,
        canceledAmount: row.CanceledAmount ?? null,
        events: Object.fromEntries(Object.entries(row.Events).map(([key, value]) => [key, Number(value)])),
        installments: installments.map((item) => ({
          number: Number(item.InstallmentNumber),
          grossAmount: item.GrossAmount, netAmount: item.NetAmount,
          expectedPaymentDate: civil(item.PrevisionPaymentDate),
          paymentDate: civil(item.PaymentDate),
          originalPaymentDate: civil(item.OriginalPaymentDate),
          paymentId: item.PaymentId ?? null,
          mdrAmount: item.MdrAmount ?? null, saleFee: item.SaleFee ?? null,
          suspendedByChargeback: item.SuspendedByChargeback?.toLowerCase() === "true",
        })),
      };
    });
  });
  return {
    source: "stone_daily_conciliation_file" as const,
    coverage: "transaction_events_only_not_full_cash_statement" as const,
    stoneCode: file.Header.StoneCode, referenceDate: civil(file.Header.ReferenceDate),
    layout: file.Header.LayoutVersion, fileId: file.Header.FileId,
    generatedAtProvider: file.Header.GenerationDateTime,
    amountFormat: "provider_decimal_not_integer_cents" as const,
    bankReceiptConfirmed: false,
    transactions,
  };
}
