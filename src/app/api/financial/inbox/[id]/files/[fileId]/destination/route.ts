import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { invoiceReferenceKey, sameInvoiceDestination, type InvoiceDestination } from "@/features/financial/inbox/invoice-destination";
import { disposeNonAssetInvoice } from "@/features/financial/inbox/invoice-disposal.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; fileId: string }> };
const id = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/);
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset_invoice"), assetIds: z.array(id).min(1).max(20), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("non_asset_invoice"), assetIds: z.array(id).length(0), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
type Input = z.infer<typeof schema>;
const contract = defineSecurityContract({ schemaVersion: 1, id: "financial.inbox.invoice-destination", version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/[id]/files/[fileId]/destination" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-invoice-destination" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.invoice-destination", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, { id: string; fileId: string }>({
  id: "financial-invoice-destination-v1", guarantees: ["authenticated-user", "active-user", "authorization:financial-invoice-destination", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const params = z.object({ id, fileId: id }).safeParse(await routeContext.params);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!params.success || !parsed.success || request.nextUrl.searchParams.size) throw new AppError({ code: "INVOICE_DESTINATION_INVALID", kind: "VALIDATION" });
    const permission = parsed.data.kind === "asset_invoice"
      ? actor.permissions.assets?.edit === true && actor.permissions.assets?.view === true && actor.permissions.financial?.inbox?.link === true
      : actor.permissions.financial?.inbox?.discard === true;
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view || !permission)) throw new AppError({ code: "INVOICE_DESTINATION_FORBIDDEN", kind: "AUTHORIZATION" });
    return { actor, input: parsed.data, resource: params.data };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security: { actor, input, resource } }) => {
  const assetIds = [...new Set(input.assetIds)].sort();
  if (assetIds.length !== input.assetIds.length) throw new AppError({ code: "INVOICE_ASSETS_DUPLICATED", kind: "VALIDATION" });
  const assetRefs = assetIds.map((assetId) => dbAdmin.collection("assets").doc(assetId));
  const assets = assetRefs.length ? await dbAdmin.getAll(...assetRefs) : [];
  if (assets.some((asset) => !asset.exists || asset.get("workspaceId") !== actor.workspace_id)) throw new AppError({ code: "INVOICE_ASSET_NOT_FOUND", kind: "NOT_FOUND" });
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(resource.id);
  const result = await financialDbAdmin.runTransaction(async (tx) => {
    const message = await tx.get(messageRef);
    if (!message.exists || message.get("workspaceId") !== actor.workspace_id || message.get("provider") !== "resend") throw new AppError({ code: "INVOICE_MESSAGE_NOT_FOUND", kind: "NOT_FOUND" });
    const attachments = message.get("attachments") as Array<Record<string, unknown>> | undefined;
    const index = attachments?.findIndex((file) => file.id === resource.fileId) ?? -1;
    const file = index >= 0 ? attachments![index] : null;
    if (!file || !file.storagePath || file.sha256 !== input.expectedSha256 || !["application/pdf", "image/jpeg", "image/png", "application/xml", "text/xml"].includes(String(file.contentType))) throw new AppError({ code: "INVOICE_FILE_CHANGED", kind: "CONFLICT", safeMessage: "O anexo mudou ou não está disponível. Atualize a cobrança." });
    const barcode = String(message.get("classification")?.barcode ?? "").replace(/\D/g, "");
    const fileBarcode = String((file.extractedHints as { barcode?: string } | undefined)?.barcode ?? "").replace(/\D/g, "");
    if (input.kind === "non_asset_invoice" && message.get("linkedExpenseId") && barcode && fileBarcode === barcode) throw new AppError({ code: "INVOICE_IS_BOLETO", kind: "CONFLICT", safeMessage: "Este anexo contém o boleto vinculado à despesa." });
    const current = file.destination as InvoiceDestination | undefined;
    if (current && !sameInvoiceDestination(current, input.kind, assetIds, input.expectedSha256)) throw new AppError({ code: "INVOICE_DESTINATION_CONFLICT", kind: "CONFLICT", safeMessage: "O destino deste arquivo já foi confirmado. Revise a decisão registrada." });
    if (current) return current;
    const destination: InvoiceDestination = { kind: input.kind, assetIds, sha256: input.expectedSha256, version: 1, confirmedAt: new Date().toISOString(), confirmedBy: actor.decoded.uid, ...(input.kind === "non_asset_invoice" ? { deletionState: "pending" as const } : {}) };
    tx.update(messageRef, { attachments: attachments!.map((item, position) => position === index ? { ...item, destination } : item), updatedAt: destination.confirmedAt });
    tx.create(messageRef.collection("audit").doc(invoiceReferenceKey(resource.id, resource.fileId).replace(":", "_") + "_destination_v1"), { action: "INVOICE_DESTINATION_CONFIRMED", fileId: resource.fileId, kind: input.kind, assetIds, sha256: input.expectedSha256, actorId: actor.decoded.uid, at: destination.confirmedAt });
    return destination;
  });
  if (result.kind === "asset_invoice") {
    // Both databases have separate transactions. A repeated confirmation repairs a partial projection.
    for (const assetRef of assetRefs) await dbAdmin.runTransaction(async (tx) => {
      const asset = await tx.get(assetRef);
      if (!asset.exists || asset.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "INVOICE_ASSET_CHANGED", kind: "CONFLICT" });
      const refs = Array.isArray(asset.get("inboxInvoiceRefs")) ? asset.get("inboxInvoiceRefs") as Array<Record<string, unknown>> : [];
      const key = invoiceReferenceKey(resource.id, resource.fileId);
      if (refs.some((ref) => ref.key === key)) return;
      tx.update(assetRef, { inboxInvoiceRefs: [...refs, { key, messageId: resource.id, fileId: resource.fileId, sha256: result.sha256, version: result.version, confirmedAt: result.confirmedAt }], inboxInvoiceKeys: FieldValue.arrayUnion(key) });
    });
  }
  const { deletedStoragePath: _path, storageGeneration: _generation, ...safeDestination } = result;
  return NextResponse.json({ destination: safeDestination }, { headers: { "Cache-Control": "private, no-store" } });
});

const deleteSchema = z.object({ expectedSha256: z.string().regex(/^[a-f0-9]{64}$/), expectedVersion: z.number().int().positive(), confirmed: z.literal(true) }).strict();
const deleteContract = defineSecurityContract({ ...contract, id: "financial.inbox.invoice-destination.delete", surface: { method: "DELETE", path: "/api/financial/inbox/[id]/files/[fileId]/destination" }, authorization: { kind: "custom", strategy: "financial-invoice-destination-delete" }, input: { kind: "schema", schema: "financial.invoice-destination-delete", unknownFields: "reject" } });
const deleteEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, z.infer<typeof deleteSchema>, { id: string; fileId: string }>({
  id: "financial-invoice-destination-delete-v1", guarantees: ["authenticated-user", "active-user", "authorization:financial-invoice-destination-delete", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view || !actor.permissions.financial?.inbox?.deleteFiles)) throw new AppError({ code: "INVOICE_DELETE_FORBIDDEN", kind: "AUTHORIZATION" });
    const params = z.object({ id, fileId: id }).safeParse(await routeContext.params);
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !parsed.success || request.nextUrl.searchParams.size) throw new AppError({ code: "INVOICE_DELETE_INVALID", kind: "VALIDATION" });
    return { actor, input: parsed.data, resource: params.data };
  },
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security: { actor, input, resource } }) => {
  const destination = await disposeNonAssetInvoice({ workspaceId: actor.workspace_id, messageId: resource.id, fileId: resource.fileId, expectedSha256: input.expectedSha256, expectedVersion: input.expectedVersion, actorId: actor.decoded.uid });
  return NextResponse.json({ destination }, { headers: { "Cache-Control": "private, no-store" } });
});
