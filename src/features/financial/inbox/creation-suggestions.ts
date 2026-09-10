import type {
  FinancialInboxClassification,
  FinancialInboxCreationSuggestion,
  FinancialInboxExpenseSuggestion,
  FinancialInboxProvisionSuggestion,
} from "./types";

function isTelecomService(classification: FinancialInboxClassification) {
  return classification.billingIdentity?.serviceType === "mobile"
    || classification.billingIdentity?.serviceType === "landline";
}

export function chooseCreationSuggestion(params: {
  subject: string;
  classification: FinancialInboxClassification;
  existingExpenseSuggestion: FinancialInboxExpenseSuggestion;
  provisionSuggestion: FinancialInboxProvisionSuggestion;
}): FinancialInboxCreationSuggestion {
  const { classification, existingExpenseSuggestion, provisionSuggestion } = params;
  const billingIdentity = classification.billingIdentity ?? null;
  const base = {
    description: params.subject.trim() || "Cobrança recebida",
    supplier: classification.supplierName,
    amountCents: classification.amountCents,
    dueDate: classification.dueDate,
    competence: classification.competence,
    billingIdentity,
  };
  if (!classification.financeLikely) {
    return { ...base, status: "not_applicable", missingFields: [], reasons: [] };
  }
  if (existingExpenseSuggestion.status === "suggested" || provisionSuggestion.status === "suggested") {
    return {
      ...base,
      status: "not_applicable",
      missingFields: [],
      reasons: ["já existe uma sugestão de vínculo"],
    };
  }
  if (existingExpenseSuggestion.status === "ambiguous" || provisionSuggestion.status === "ambiguous") {
    return {
      ...base,
      status: "blocked_by_ambiguity",
      missingFields: [],
      reasons: ["há mais de uma despesa compatível; confira antes de criar outra"],
    };
  }

  const missingFields = [
    ...(!classification.supplierName ? ["fornecedor"] : []),
    ...(classification.amountCents == null || classification.amountCents <= 0 ? ["valor"] : []),
    ...(!classification.dueDate ? ["vencimento"] : []),
    ...(!classification.competence ? ["competência"] : []),
    ...(isTelecomService(classification)
      && !(billingIdentity?.serviceNumbers.length)
      ? ["número da linha"]
      : []),
  ];
  if (missingFields.length) {
    return {
      ...base,
      status: "incomplete",
      missingFields,
      reasons: ["complete os dados antes de registrar uma nova despesa"],
    };
  }
  return {
    ...base,
    status: "suggested",
    missingFields: [],
    reasons: ["nenhuma despesa ou previsão compatível foi encontrada", "dados suficientes para preparar um cadastro"],
  };
}
