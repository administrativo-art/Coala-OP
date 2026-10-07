import { CnpjValidator } from "@/lib/company/cnpj-validator";

import { bankSlipAmountCents, maskPaymentBarcode, normalizePaymentBarcode } from "./parser";
import type { FinancialInboxClassification } from "./types";

export type ConfirmedInboxDocumentInput = {
  amountCents: number;
  dueDate: string;
  competence: string;
  barcode: string;
  supplierName: string;
  supplierTaxId: string;
};

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
  if (!barcode || barcode.length !== 47 || bankSlipAmountCents(barcode) !== input.amountCents) {
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
  const supplierDocument = CnpjValidator.validate(input.supplierTaxId);
  if (!supplierDocument.valid) throw new Error("Confirme um CNPJ válido para o fornecedor.");
  const currentSupplierTaxId = current.billingIdentity?.supplierTaxId;
  if (currentSupplierTaxId
    && CnpjValidator.clean(currentSupplierTaxId) !== supplierDocument.clean) {
    throw new Error("O CNPJ confirmado diverge do documento analisado.");
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
    billingIdentity: {
      supplierTaxId: supplierDocument.clean,
      customerAccount: current.billingIdentity?.customerAccount ?? null,
      contractNumber: current.billingIdentity?.contractNumber ?? null,
      serviceType: current.billingIdentity?.serviceType ?? null,
      serviceNumbers: current.billingIdentity?.serviceNumbers ?? [],
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
