import { classifyFinancialEmail } from "./parser";

export function shouldUseFinancialDocumentAi(params: {
  candidate: boolean;
  supported: boolean;
  text: string;
  subject: string;
  senderDomain: string | null;
}) {
  if (!params.candidate || !params.supported) return false;
  const parsed = classifyFinancialEmail({
    subject: params.subject,
    text: "",
    senderDomain: params.senderDomain,
    documentText: params.text,
  }).classification;
  const identity = parsed.billingIdentity;
  const telecomIncomplete = (identity?.serviceType === "mobile" || identity?.serviceType === "landline")
    && !identity.serviceNumbers.length;
  const fiscal = parsed.fiscalIdentity;
  const fiscalIncomplete = Boolean(fiscal && (
    !fiscal.collectorName || !fiscal.taxpayerTaxId || !fiscal.documentNumber
    || fiscal.revenueDescriptions.length === 0 || fiscal.revenueItems.length === 0
  ));
  return !parsed.amountCents || !parsed.dueDate || !parsed.competence
    || !parsed.supplierName || telecomIncomplete || fiscalIncomplete;
}
