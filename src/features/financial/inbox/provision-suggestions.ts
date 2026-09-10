import { extractBillingIdentity } from "./parser";
import type { FinancialInboxBillingIdentity, FinancialInboxClassification, FinancialInboxProvisionSuggestion } from "./types";

export type ProvisionCandidate = {
  id: string;
  description?: string | null;
  supplier?: string | null;
  provisionSeriesKey?: string | null;
  provisionCompetence?: string | null;
  totalValue?: number | null;
  dueDate?: unknown;
  notes?: string | null;
  billingIdentity?: FinancialInboxBillingIdentity | null;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dateKey(value: unknown) {
  const raw = value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  return raw && !Number.isNaN(raw.getTime()) ? raw.toISOString().slice(0, 10) : null;
}

function typeTokens(classification: FinancialInboxClassification) {
  const byType: Record<FinancialInboxClassification["documentType"], string[]> = {
    fgts: ["fgts", "guia fgts"],
    inss_darf: ["inss", "darf", "dctfweb"],
    accounting_fee: ["honorario contabil", "contabilidade"],
    tax: ["das", "dare", "imposto", "tributo", "simples nacional", "icms", "iss"],
    utility_bill: ["internet", "energia", "agua", "telefone", "vivo"],
    charge: ["boleto", "cobranca", "fatura"],
    other: [],
  };
  return byType[classification.documentType];
}

export function scoreProvisionCandidate(
  classification: FinancialInboxClassification,
  candidate: ProvisionCandidate,
) {
  let score = 30;
  const reasons = ["mesma competência"];
  const candidateAmountCents = Math.round((Number(candidate.totalValue) || 0) * 100);
  if (classification.amountCents != null && candidateAmountCents > 0) {
    const difference = Math.abs(classification.amountCents - candidateAmountCents);
    const ratio = difference / Math.max(classification.amountCents, candidateAmountCents);
    if (difference <= 1) {
      score += 45;
      reasons.push("mesmo valor");
    } else if (ratio <= 0.03) {
      score += 32;
      reasons.push("valor muito próximo");
    } else if (ratio <= 0.15) {
      score += 15;
      reasons.push("valor compatível com variação");
    }
  }

  const description = normalize(`${candidate.description ?? ""} ${candidate.provisionSeriesKey ?? ""}`);
  if (typeTokens(classification).some((token) => description.includes(normalize(token)))) {
    score += 20;
    reasons.push("tipo da cobrança compatível");
  }

  const supplier = normalize(candidate.supplier);
  const classifiedSupplier = normalize(classification.supplierName);
  if (supplier && classifiedSupplier && (
    supplier.includes(classifiedSupplier) || classifiedSupplier.includes(supplier)
  )) {
    score += 12;
    reasons.push("mesmo fornecedor");
  }

  if (classification.dueDate && dateKey(candidate.dueDate) === classification.dueDate) {
    score += 10;
    reasons.push("mesmo vencimento");
  }
  const sourceIdentity = classification.billingIdentity;
  const embeddedIdentity = extractBillingIdentity(`${candidate.description ?? ""}\n${candidate.supplier ?? ""}\n${candidate.notes ?? ""}`);
  const targetIdentity = candidate.billingIdentity ?? embeddedIdentity;
  if (sourceIdentity?.serviceNumbers.length && targetIdentity.serviceNumbers.length
    && sourceIdentity.serviceNumbers.some((number) => targetIdentity.serviceNumbers.includes(number))) {
    score += 35;
    reasons.push("mesma linha telefônica");
  } else if (sourceIdentity?.customerAccount && targetIdentity.customerAccount
    && normalize(sourceIdentity.customerAccount) === normalize(targetIdentity.customerAccount)) {
    score += 30;
    reasons.push("mesma conta do cliente");
  } else if (sourceIdentity?.contractNumber && targetIdentity.contractNumber
    && normalize(sourceIdentity.contractNumber) === normalize(targetIdentity.contractNumber)) {
    score += 30;
    reasons.push("mesmo contrato");
  }
  return { score, reasons };
}

export function chooseProvisionSuggestion(
  classification: FinancialInboxClassification,
  candidates: ProvisionCandidate[],
  checkedAt = new Date().toISOString(),
): FinancialInboxProvisionSuggestion {
  const scored = candidates
    .filter((candidate) => candidate.provisionCompetence === classification.competence)
    .filter((candidate) => {
      const source = classification.billingIdentity;
      if (source?.serviceType !== "mobile" && source?.serviceType !== "landline") return true;
      const target = candidate.billingIdentity
        ?? extractBillingIdentity(`${candidate.description ?? ""}\n${candidate.supplier ?? ""}\n${candidate.notes ?? ""}`);
      const serviceNumberMatches = Boolean(source.serviceNumbers.length
        && target.serviceNumbers.some((number) => source.serviceNumbers.includes(number)));
      const customerAccountMatches = Boolean(source.customerAccount
        && target.customerAccount
        && normalize(source.customerAccount) === normalize(target.customerAccount));
      const contractNumberMatches = Boolean(source.contractNumber
        && target.contractNumber
        && normalize(source.contractNumber) === normalize(target.contractNumber));
      return serviceNumberMatches || customerAccountMatches || contractNumberMatches;
    })
    .map((candidate) => ({ candidate, ...scoreProvisionCandidate(classification, candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const first = scored[0];
  const second = scored[1];
  const ambiguous = Boolean(first && second && first.score - second.score < 12);
  const acceptable = Boolean(first && first.score >= 50);
  const status = !acceptable ? "not_found" : ambiguous ? "ambiguous" : "suggested";
  return {
    status,
    provisionExpenseId: status === "suggested" ? first!.candidate.id : null,
    confidence: status === "suggested" ? (first!.score >= 80 ? "high" : "medium") : null,
    score: first?.score ?? null,
    reasons: first?.reasons ?? [],
    description: first?.candidate.description ?? null,
    supplier: first?.candidate.supplier ?? null,
    competence: classification.competence,
    dueDate: first ? dateKey(first.candidate.dueDate) : null,
    provisionedAmountCents: first ? Math.round((Number(first.candidate.totalValue) || 0) * 100) : null,
    billingIdentity: first
      ? first.candidate.billingIdentity
        ?? extractBillingIdentity(`${first.candidate.description ?? ""}\n${first.candidate.supplier ?? ""}\n${first.candidate.notes ?? ""}`)
      : null,
    checkedAt,
  };
}
