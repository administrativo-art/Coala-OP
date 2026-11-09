import { normalizeBrazilianServiceNumber } from "@/features/financial/inbox/parser";

export type ProvisionSeriesAmountSelection = {
  workspaceId: string;
  seriesKey: string;
  customerAccount: string;
  serviceNumber: string;
  fromCompetence: string;
  expectedAmountCents: number;
};

function cents(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function selectProvisionSeriesAmountTarget(data: Record<string, unknown>, selection: ProvisionSeriesAmountSelection) {
  if (data.workspaceId !== selection.workspaceId || data.provisionSeriesKey !== selection.seriesKey) {
    throw new Error("Série fora do espaço autorizado.");
  }
  const competence = String(data.provisionCompetence ?? "");
  if (competence < selection.fromCompetence) return null;
  if (data.provisionType !== "forecast" || data.status !== "provisioned"
    || data.provisionReconciliationStatus !== "awaiting_actual"
    || data.replacedByExpenseId || data.paymentRequestId) return null;

  const identity = data.billingIdentity as { customerAccount?: unknown; serviceNumbers?: unknown } | undefined;
  const account = String(identity?.customerAccount ?? "").replace(/\D/g, "");
  const numbers = Array.isArray(identity?.serviceNumbers)
    ? identity.serviceNumbers.map(normalizeBrazilianServiceNumber)
    : [];
  const serviceNumber = normalizeBrazilianServiceNumber(selection.serviceNumber);
  if (account !== selection.customerAccount || !serviceNumber || !numbers.includes(serviceNumber)) {
    throw new Error("Identidade da série diverge da conta e linha autorizadas.");
  }
  const installments = data.installments;
  if (cents(data.totalValue) !== selection.expectedAmountCents || !Array.isArray(installments)
    || installments.length !== 1 || cents(installments[0]?.value) !== selection.expectedAmountCents
    || installments[0]?.status !== "pending") {
    throw new Error("Valor ou parcela da provisão mudou; nenhuma provisão foi alterada.");
  }
  return { competence, installments: installments as Array<Record<string, unknown>> };
}
