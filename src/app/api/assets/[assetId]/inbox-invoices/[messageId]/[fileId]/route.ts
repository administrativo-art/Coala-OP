import { getStorage } from "firebase-admin/storage";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { invoiceReferenceKey, type InvoiceDestination } from "@/features/financial/inbox/invoice-destination";

export const runtime = "nodejs";
type Context = { params: Promise<{ assetId: string; messageId: string; fileId: string }> };
const id = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/);
const paramsSchema = z.object({ assetId: id, messageId: id, fileId: id });
const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.inbox-invoice.access", version: 1,
  surface: { method: "GET", path: "/api/assets/[assetId]/inbox-invoices/[messageId]/[fileId]" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "assets.view" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.inbox-invoice-params", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, z.infer<typeof paramsSchema>, undefined>({
  id: "asset-inbox-invoice-access-v1", guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && actor.permissions.assets?.view !== true) throw new AppError({ code: "ASSET_INVOICE_FORBIDDEN", kind: "AUTHORIZATION" });
    const parsed = paramsSchema.safeParse(await routeContext.params);
    if (!parsed.success || request.nextUrl.searchParams.size) throw new AppError({ code: "ASSET_INVOICE_INVALID", kind: "VALIDATION" });
    return { actor, input: parsed.data, resource: undefined };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security: { actor, input } }) => {
  const [asset, message] = await Promise.all([
    dbAdmin.collection("assets").doc(input.assetId).get(),
    financialDbAdmin.collection("financialInboxMessages").doc(input.messageId).get(),
  ]);
  if (!asset.exists || !message.exists || asset.get("workspaceId") !== actor.workspace_id || message.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "ASSET_INVOICE_NOT_FOUND", kind: "NOT_FOUND" });
  const key = invoiceReferenceKey(input.messageId, input.fileId);
  const refs = asset.get("inboxInvoiceRefs") as Array<Record<string, unknown>> | undefined;
  const ref = Array.isArray(refs) ? refs.find((item) => item.key === key) : null;
  const attachments = message.get("attachments") as Array<Record<string, unknown>> | undefined;
  const file = Array.isArray(attachments) ? attachments.find((item) => item.id === input.fileId) : null;
  const destination = file?.destination as InvoiceDestination | undefined;
  if (!ref || !file?.storagePath || !file.sha256 || !destination || ref.sha256 !== file.sha256 || ref.version !== destination.version
    || destination.kind !== "asset_invoice" || !destination.assetIds.includes(input.assetId)) throw new AppError({ code: "ASSET_INVOICE_LINK_NOT_FOUND", kind: "NOT_FOUND" });
  const [contents] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(String(file.storagePath)).download();
  const contentType = String(file.contentType || "application/octet-stream");
  const filename = String(file.filename || "nota-fiscal").replace(/[\r\n"\\/]/g, "_").slice(0, 180);
  return new NextResponse(new Uint8Array(contents), { headers: { "Content-Type": contentType, "Content-Disposition": `${contentType === "application/pdf" || contentType.startsWith("image/") ? "inline" : "attachment"}; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
