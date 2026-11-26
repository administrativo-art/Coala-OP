import { NextResponse, type NextRequest } from "next/server";
import { readDocumentReceiptPaymentStatus, sendDocumentReceiptPayment } from "@/features/financial/payment-requests/document-receipt.server";
import { canSendDocumentReceiptPayment, canViewDocumentReceiptPayment } from "@/features/financial/payment-requests/document-receipt-permissions";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { isInterConfigured } from "@/lib/integrations/inter/config.server";
import { AppError } from "@/lib/observability/app-error";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const contract = defineSecurityContract({
  schemaVersion: 1, id: "documents.generated.receipt.payment", version: 1,
  surface: { method: "POST", path: "/api/documents/generated/[id]/payment" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "receipt-payment-financial-and-document" },
  resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "documents.generated.receipt.payment.id", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, { id: string }, { workspaceId: string }>({
  id: "generated-receipt-payment-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:receipt-payment-financial-and-document", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!canSendDocumentReceiptPayment(actor)) {
      throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão documental e financeira para enviar pagamento." });
    }
    if (request.nextUrl.searchParams.size || (await request.text()).trim()) throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_BODY_INVALID", kind: "VALIDATION", safeMessage: "Esta operação não aceita dados de pagamento enviados pelo navegador." });
    const { id } = await routeContext.params;
    if (!id || id.length > 180 || id.includes("/")) throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_ID_INVALID", kind: "VALIDATION", safeMessage: "Identificador do recibo inválido." });
    return { actor, input: { id }, resource: { workspaceId: actor.workspace_id } };
  },
});
export const POST = secureRoute<Context, ServerUserContext, { id: string }, { workspaceId: string }>({ contract, enforcer }, async ({ security }) => {
  if (!isInterConfigured()) throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_INTER_UNAVAILABLE", kind: "CONFLICT", safeMessage: "O envio ao Inter está disponível somente no ambiente configurado." });
  const actor = security.actor;
  try {
    const result = await sendDocumentReceiptPayment(security.input.id, {
      ...actor, uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username,
    });
    return NextResponse.json(result);
  } catch (cause) {
    throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_NOT_SENT", kind: "CONFLICT", safeMessage: "Não foi possível confirmar o envio. Consulte o estado bancário antes de tentar novamente; confira recibo, favorecido e configuração do pagador.", cause });
  }
});

const readContract = defineSecurityContract({
  schemaVersion: 1, id: "documents.generated.receipt.payment.status", version: 1,
  surface: { method: "GET", path: "/api/documents/generated/[id]/payment" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "receipt-payment-status-financial-and-document" },
  resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "documents.generated.receipt.payment.id", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});
const readEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, { id: string }, { workspaceId: string }>({
  id: "generated-receipt-payment-status-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:receipt-payment-status-financial-and-document", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!canViewDocumentReceiptPayment(actor)) throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_STATUS_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar pagamento do recibo." });
    if (request.nextUrl.searchParams.size) throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_STATUS_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Consulta de pagamento inválida." });
    const { id } = await routeContext.params;
    if (!id || id.length > 180 || id.includes("/")) throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_STATUS_ID_INVALID", kind: "VALIDATION", safeMessage: "Identificador do recibo inválido." });
    return { actor, input: { id }, resource: { workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute<Context, ServerUserContext, { id: string }, { workspaceId: string }>({ contract: readContract, enforcer: readEnforcer }, async ({ security }) => {
  try {
    const request = await readDocumentReceiptPaymentStatus(security.input.id, security.actor);
    return NextResponse.json({ request }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    throw new AppError({ code: "DOCUMENT_RECEIPT_PAYMENT_STATUS_UNAVAILABLE", kind: "CONFLICT", safeMessage: "Não foi possível consultar o estado do pagamento deste recibo.", cause });
  }
});
