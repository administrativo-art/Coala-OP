import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { dbAdmin } from "@/lib/firebase-admin";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { FINANCIAL_DOCUMENT_KINDS, financialDocumentName } from "@/features/documents/central/financial-naming";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; fileId: string }> };
const schema = z.object({ mode: z.enum(["preview", "confirm"]), documentType: z.enum(FINANCIAL_DOCUMENT_KINDS), reference: z.string().trim().min(1).max(80).regex(/[a-zA-Z0-9]/), counterpartyId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(), expectedVersion: z.number().int().min(1).optional(), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: "financial.inbox.document-naming", version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/[id]/files/[fileId]/naming" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-document-naming" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.document-naming", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, z.infer<typeof schema>, { id: string; fileId: string }>({
  id: "financial-document-naming-v1", guarantees: ["authenticated-user", "active-user", "authorization:financial-document-naming", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view || !actor.permissions.financial?.inbox?.link)) throw new AppError({ code: "FINANCIAL_NAMING_FORBIDDEN", kind: "AUTHORIZATION" });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    const params = z.object({ id: z.string().max(256).regex(/^[a-zA-Z0-9_-]+$/), fileId: z.string().max(256).regex(/^[a-zA-Z0-9_-]+$/) }).safeParse(await routeContext.params);
    if (!params.success || !parsed.success || request.nextUrl.searchParams.size || parsed.data.mode === "confirm" && (!parsed.data.expectedVersion || !parsed.data.expectedFingerprint)) throw new AppError({ code: "FINANCIAL_NAMING_INVALID", kind: "VALIDATION" });
    return { actor, input: parsed.data, resource: params.data };
  },
});
const conflict = (safeMessage: string) => new AppError({ code: "FINANCIAL_NAMING_PENDING", kind: "CONFLICT", safeMessage });
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const ref = financialDbAdmin.collection("financialInboxMessages").doc(resource.id);
  const result = await financialDbAdmin.runTransaction(async (tx) => {
    const message = await tx.get(ref);
    if (!message.exists || message.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "FINANCIAL_NAMING_NOT_FOUND", kind: "NOT_FOUND" });
    const expenseId = message.get("linkedExpenseId");
    if (typeof expenseId !== "string" || !expenseId || expenseId.includes("/")) throw conflict("Vincule o documento a uma despesa antes de definir o nome.");
    const expense = await tx.get(financialDbAdmin.collection("expenses").doc(expenseId));
    if (!expense.exists || expense.get("workspaceId") !== actor.workspace_id) throw conflict("A despesa vinculada está indisponível.");
    const supplierId = expense.get("supplierId");
    const linkedCounterparty = typeof supplierId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(supplierId) ? supplierId : null;
    if (input.counterpartyId && !actor.isDefaultAdmin && !actor.permissions.registration?.view) throw new AppError({ code: "FINANCIAL_NAMING_COUNTERPARTY_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "A seleção manual exige acesso aos cadastros." });
    if (linkedCounterparty && input.counterpartyId && linkedCounterparty !== input.counterpartyId) throw conflict("A contraparte escolhida difere do fornecedor vinculado. Confira o vínculo da despesa.");
    const counterpartyId = linkedCounterparty ?? input.counterpartyId;
    if (!counterpartyId) throw conflict("Selecione uma contraparte cadastrada para este documento. A escolha não altera a despesa.");
    const entity = await dbAdmin.collection("entities").doc(counterpartyId).get();
    if (!entity.exists || entity.get("isArchived") || entity.get("isActive") === false || entity.get("status") === "inactive") throw conflict("A contraparte cadastrada está indisponível.");
    const attachments = message.get("attachments") as Array<Record<string, unknown>>;
    const index = attachments.findIndex((item) => item.id === resource.fileId);
    const attachment = attachments[index];
    if (!attachment?.storagePath || typeof attachment.sha256 !== "string") throw conflict("Anexo sem arquivo ou hash confirmado.");
    const extension = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[String(attachment.contentType)];
    if (!extension) throw conflict("Este formato mantém o nome original nesta etapa.");
    const base = { documentType: input.documentType, reference: input.reference, counterpartyId, extension };
    const logicalKey = createHash("sha256").update(JSON.stringify([actor.workspace_id, financialDocumentName({ ...base, version: 1 })])).digest("hex");
    const key = financialDbAdmin.collection("financialDocumentNamingKeys").doc(logicalKey);
    const contentKey = financialDbAdmin.collection("financialDocumentNamingContents").doc(`${logicalKey}-${attachment.sha256}`);
    const [latest, duplicate] = await Promise.all([tx.get(key), tx.get(contentKey)]);
    const version = duplicate.exists ? Number(duplicate.get("version")) : Number(latest.get("version") ?? 0) + 1;
    const name = financialDocumentName({ ...base, version });
    if (name.length > 240) throw conflict("Use uma referência mais curta para compor o nome.");
    const fingerprint = createHash("sha256").update(JSON.stringify([name, expenseId, attachment.sha256, resource.id, resource.fileId, Boolean(linkedCounterparty)])).digest("hex");
    const naming = { ...base, scopeSource: linkedCounterparty ? "expense" : "document_confirmation", version, downloadName: name, logicalKey, expenseId, originalName: attachment.filename, destination: `Financeiro / ${counterpartyId} / ${expenseId} / ${input.reference}` };
    const current = attachment.documentNaming as Record<string, unknown> | undefined;
    if (input.mode === "preview") return { naming, fingerprint, applied: false };
    if (input.expectedFingerprint !== fingerprint) throw conflict("O vínculo, arquivo ou nome mudou. Gere a prévia novamente.");
    if (current?.logicalKey === logicalKey && current.downloadName === name && current.scopeSource === naming.scopeSource) return { naming: current, applied: true };
    if (input.expectedVersion !== version) throw conflict("A versão mudou. Gere a prévia novamente antes de confirmar.");
    const at = new Date().toISOString();
    tx.update(ref, { attachments: attachments.map((item, i) => i === index ? { ...item, documentNaming: { ...naming, confirmedBy: actor.decoded.uid, confirmedAt: at } } : item) });
    if (!duplicate.exists) { tx.set(key, { version }); tx.set(contentKey, { version }); }
    tx.create(ref.collection("audit").doc(), { action: "DOCUMENT_NAMING_CONFIRMED", fileId: resource.fileId, originalName: attachment.filename, appliedName: name, counterpartyId, expenseId, actorId: actor.decoded.uid, at });
    return { naming, applied: true };
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
