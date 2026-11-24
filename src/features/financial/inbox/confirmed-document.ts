import { CnpjValidator } from "@/lib/company/cnpj-validator";

import { bankSlipAmountCents, maskPaymentBarcode, normalizeBrazilianServiceNumber, normalizePaymentBarcode } from "./parser";
import { governmentCollectionBarcode, validatedCollectionBarcode } from "@/features/financial/payment-requests/inbox-barcode";
import type { FinancialInboxBillingIdentity, FinancialInboxClassification, FinancialInboxFiscalDocumentKind } from "./types";

export function telecomBillingIdentitiesMatch(
  confirmed: FinancialInboxBillingIdentity | null | undefined,
  forecast: FinancialInboxBillingIdentity | null | undefined,
): boolean {
  const confirmedAccount = confirmed?.customerAccount?.replace(/\D/g, "") ?? "";
  const forecastAccount = forecast?.customerAccount?.replace(/\D/g, "") ?? "";
  const confirmedNumbers = (confirmed?.serviceNumbers ?? []).map(normalizeBrazilianServiceNumber).filter(Boolean);
  const forecastNumbers = (forecast?.serviceNumbers ?? []).map(normalizeBrazilianServiceNumber).filter(Boolean);
  return Boolean(confirmedAccount && forecastAccount && confirmedAccount === forecastAccount
    && confirmedNumbers.length && forecastNumbers.length
    && confirmedNumbers.some((number) => forecastNumbers.includes(number)));
}

export type ConfirmedInboxDocumentInput = {
  amountCents: number;
  dueDate: string;
  competence: string;
  barcode: string;
  supplierName: string;
  supplierTaxId?: string | null;
  fiscalIdentity?: {
    documentKind: FinancialInboxFiscalDocumentKind;
    collectorName: string;
    taxpayerName: string;
    taxpayerTaxId: string;
    documentNumber?: string;
    revenueCodes?: string[];
  };
  customerAccount?: string;
  serviceNumbers?: string[];
  serviceType?: "mobile" | "landline";
};

export function assertConfirmedExistingExpense(
  expense: Record<string, unknown>,
  inboxId: string,
  confirmation: ConfirmedInboxDocumentInput,
  accounting: { accountPlanId: string; resultCenterId: string; apportionments?: Array<{ resultCenter: string; percentage: number }> },
) {
  const dateKey = (value: unknown) => {
    const date = value && typeof (value as { toDate?: unknown }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : value ? new Date(value as string | number | Date) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  };
  if (expense.provisionType === "forecast" || expense.status !== "pending"
    || expense.paymentRequestId || expense.bankPaymentTransactionId
    || expense.financialInboxMessageId && expense.financialInboxMessageId !== inboxId) {
    throw new Error("A despesa já possui tratamento financeiro ou não está pendente.");
  }
  const centerId = expense.isApportioned === true
    ? expense.referenceResultCenterId : expense.resultCenterId ?? expense.resultCenter;
  if (String(expense.accountPlan ?? expense.accountId ?? "") !== accounting.accountPlanId
    || String(centerId ?? "") !== accounting.resultCenterId) {
    throw new Error("A classificação contábil da despesa mudou.");
  }
  const actualApportionments = expense.isApportioned === true && Array.isArray(expense.apportionments)
    ? expense.apportionments as Array<{ resultCenter?: unknown; percentage?: unknown }> : [];
  const expectedApportionments = accounting.apportionments ?? [];
  const ordered = (rows: Array<{ resultCenter?: unknown; percentage?: unknown }>) => rows
    .map((row) => ({ resultCenter: String(row.resultCenter ?? "").trim(), percentage: Number(row.percentage) }))
    .sort((left, right) => left.resultCenter.localeCompare(right.resultCenter));
  if (actualApportionments.length !== expectedApportionments.length
    || JSON.stringify(ordered(actualApportionments)) !== JSON.stringify(ordered(expectedApportionments))) {
    throw new Error("O rateio da despesa mudou.");
  }
  if (Math.round(Number(expense.totalValue) * 100) !== confirmation.amountCents
    || dateKey(expense.dueDate) !== confirmation.dueDate
    || String(expense.provisionCompetence ?? dateKey(expense.competenceDate)?.slice(0, 7) ?? "") !== confirmation.competence) {
    throw new Error("Valor, vencimento ou competência da despesa divergem da guia.");
  }
  const installment = Array.isArray(expense.installments) && expense.installments.length === 1
    ? expense.installments[0] as Record<string, unknown> : null;
  if (!installment || installment.status !== "pending"
    || Math.round(Number(installment.value) * 100) !== confirmation.amountCents
    || dateKey(installment.dueDate) !== confirmation.dueDate
    || installment.bankPaymentTransactionId || installment.linkedBankTransactionId
    || installment.financialInboxMessageId && installment.financialInboxMessageId !== inboxId) {
    throw new Error("A parcela diverge da guia ou já teve pagamento/vínculo.");
  }
  if (confirmation.fiscalIdentity
    && (expense.billingIdentity as { supplierTaxId?: unknown } | null | undefined)?.supplierTaxId) {
    throw new Error("A guia pública possui CNPJ de favorecido incompatível na despesa.");
  }
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00-03:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validCompetence(value: string) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return false;
  return true;
}

export function confirmFinancialInboxDocument(
  current: FinancialInboxClassification,
  input: ConfirmedInboxDocumentInput,
): FinancialInboxClassification {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Confirme um valor positivo em centavos para a cobrança.");
  }
  if (!validIsoDate(input.dueDate)) throw new Error("Confirme um vencimento válido para a cobrança.");
  if (!validCompetence(input.competence)) throw new Error("Confirme uma competência válida para a cobrança.");

  const barcode = normalizePaymentBarcode(input.barcode);
  const encodedAmount = barcode?.length === 47
    ? bankSlipAmountCents(barcode)
    : barcode?.length === 48 ? validatedCollectionBarcode(barcode)?.amountCents : null;
  if (!barcode || encodedAmount !== input.amountCents) {
    throw new Error("A linha digitável não é válida ou não corresponde ao valor principal da cobrança.");
  }
  const currentBarcode = normalizePaymentBarcode(current.barcode ?? "");
  if (currentBarcode && currentBarcode !== barcode) {
    throw new Error("A linha digitável confirmada diverge do documento analisado.");
  }
  if (current.amountCents != null && current.amountCents !== input.amountCents) {
    throw new Error("O valor confirmado diverge do documento analisado.");
  }
  if (current.dueDate && current.dueDate !== input.dueDate) {
    throw new Error("O vencimento confirmado diverge do documento analisado.");
  }
  if (current.competence && current.competence !== input.competence) {
    throw new Error("A competência confirmada diverge do documento analisado.");
  }

  const supplierName = input.supplierName.trim();
  if (!supplierName) throw new Error("Confirme o fornecedor da cobrança.");
  const publicCollection = barcode?.length === 48 && governmentCollectionBarcode(barcode) !== null;
  const supplierDocument = input.supplierTaxId ? CnpjValidator.validate(input.supplierTaxId) : null;
  if (!supplierDocument?.valid && !(publicCollection && input.fiscalIdentity)) {
    throw new Error("Confirme um CNPJ válido para o fornecedor ou a identidade da guia pública.");
  }
  const currentSupplierTaxId = current.billingIdentity?.supplierTaxId;
  if (currentSupplierTaxId
    && CnpjValidator.clean(currentSupplierTaxId) !== supplierDocument?.clean) {
    throw new Error("O CNPJ confirmado diverge do documento analisado.");
  }
  let fiscalIdentity = current.fiscalIdentity ?? null;
  if (input.fiscalIdentity) {
    if (!publicCollection || !["tax", "inss_darf", "other", "charge"].includes(current.documentType)
      || !["das", "dare", "darf", "dctfweb", "municipal_tax"].includes(input.fiscalIdentity.documentKind)) {
      throw new Error("A identidade fiscal manual exige uma guia pública compatível.");
    }
    const taxpayer = CnpjValidator.validate(input.fiscalIdentity.taxpayerTaxId);
    if (!taxpayer.valid || !input.fiscalIdentity.collectorName.trim() || !input.fiscalIdentity.taxpayerName.trim()) {
      throw new Error("Confirme arrecadador e CNPJ/nome do contribuinte da guia.");
    }
    if (fiscalIdentity && (fiscalIdentity.documentKind !== input.fiscalIdentity.documentKind
      || fiscalIdentity.taxpayerTaxId && CnpjValidator.clean(fiscalIdentity.taxpayerTaxId) !== taxpayer.clean
      || fiscalIdentity.documentNumber && fiscalIdentity.documentNumber !== (input.fiscalIdentity.documentNumber ?? null)
      || fiscalIdentity.revenueCodes.length && input.fiscalIdentity.revenueCodes?.length
        && !fiscalIdentity.revenueCodes.some((code) => input.fiscalIdentity?.revenueCodes?.includes(code)))) {
      throw new Error("A identidade fiscal confirmada diverge do documento analisado.");
    }
    fiscalIdentity = {
      documentKind: input.fiscalIdentity.documentKind,
      collectorName: input.fiscalIdentity.collectorName.trim(),
      taxpayerName: input.fiscalIdentity.taxpayerName.trim(),
      taxpayerTaxId: taxpayer.clean,
      taxpayerRegistration: fiscalIdentity?.taxpayerRegistration ?? null,
      documentNumber: input.fiscalIdentity.documentNumber?.trim() || null,
      revenueCodes: input.fiscalIdentity.revenueCodes ?? fiscalIdentity?.revenueCodes ?? [],
      revenueDescriptions: fiscalIdentity?.revenueDescriptions ?? [],
      revenueItems: fiscalIdentity?.revenueItems ?? [],
    };
  }
  const customerAccount = input.customerAccount?.replace(/\D/g, "") || current.billingIdentity?.customerAccount || null;
  if (input.customerAccount && (!/^\d{5,20}$/.test(customerAccount ?? "")
    || (current.billingIdentity?.customerAccount
      && current.billingIdentity.customerAccount.replace(/\D/g, "") !== customerAccount))) {
    throw new Error("A conta do cliente confirmada é inválida ou diverge do documento analisado.");
  }
  const serviceNumbers = input.serviceNumbers?.map(normalizeBrazilianServiceNumber) ?? current.billingIdentity?.serviceNumbers ?? [];
  if (serviceNumbers.some((number) => !number)) throw new Error("A linha telefônica confirmada é inválida.");
  if (input.serviceNumbers && current.billingIdentity?.serviceNumbers.length
    && !serviceNumbers.some((number) => current.billingIdentity?.serviceNumbers.includes(number ?? ""))) {
    throw new Error("A linha telefônica confirmada diverge do documento analisado.");
  }
  if (input.serviceType && current.billingIdentity?.serviceType
    && input.serviceType !== current.billingIdentity.serviceType) {
    throw new Error("O tipo de serviço confirmado diverge do documento analisado.");
  }

  return {
    ...current,
    confidence: "high",
    supplierName,
    amountCents: input.amountCents,
    dueDate: input.dueDate,
    competence: input.competence,
    barcode,
    barcodeMasked: maskPaymentBarcode(barcode),
    fiscalIdentity,
    documentType: fiscalIdentity ? (["darf", "dctfweb"].includes(fiscalIdentity.documentKind) ? "inss_darf" : "tax") : current.documentType,
    billingIdentity: {
      supplierTaxId: supplierDocument?.clean ?? null,
      customerAccount,
      contractNumber: current.billingIdentity?.contractNumber ?? null,
      serviceType: input.serviceType ?? current.billingIdentity?.serviceType ?? null,
      serviceNumbers: [...new Set(serviceNumbers as string[])],
    },
  };
}

export function supplierNamesAreCompatible(left: unknown, right: unknown) {
  const normalize = (value: unknown) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\b(?:ltda|sa|s a|eireli|me|epp)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const first = normalize(left);
  const second = normalize(right);
  return Boolean(first && second && (first === second || first.includes(second) || second.includes(first)));
}
