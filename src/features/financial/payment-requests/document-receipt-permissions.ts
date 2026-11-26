import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import type { PermissionSet } from "@/types";

type Actor = {
  isDefaultAdmin: boolean;
  permissions: PermissionSet;
};

export function documentReceiptPaymentAction(status?: string | null, canResume = false, statusKnown = true) {
  return {
    enabled: statusKnown && (!status || (status === "ready_to_submit" && canResume)),
    label: status === "ready_to_submit" && canResume ? "Retomar envio ao Inter" : "Enviar pagamento ao Inter",
  };
}

export function canSendDocumentReceiptPayment(actor: Actor) {
  if (!canViewDocumentReceiptPayment(actor)) return false;
  if (actor.isDefaultAdmin) return true;
  const financial = actor.permissions.financial;
  return financial?.view === true
    && financial.paymentRequests?.view === true
    && financial.paymentRequests?.create === true
    && financial.paymentRequests?.authorize === true
    && financial.paymentRequests?.submit === true;
}

export function canViewDocumentReceiptPayment(actor: Actor) {
  if (!hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) return false;
  if (actor.isDefaultAdmin) return true;
  return actor.permissions.financial?.view === true && actor.permissions.financial.paymentRequests?.view === true;
}
