import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import { getFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";

function downloadName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "arquivo";
}

type Context = { params: Promise<{ id: string; fileId: string }> };
const paramsSchema = z.object({ id: z.string().min(1).max(256).regex(/^[^/]+$/), fileId: z.string().min(1).max(256).regex(/^[^/]+$/) });
const contract = defineSecurityContract({ schemaVersion: 1, id: "financial.inbox.file-access", version: 1,
  surface: { method: "GET", path: "/api/financial/inbox/[id]/files/[fileId]" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-inbox-workspace" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.file-access", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, z.infer<typeof paramsSchema>, undefined>({
  id: "financial-inbox-file-access-v1", guarantees: ["authenticated-user", "active-user", "authorization:financial-inbox-workspace", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view)) {
      throw new AppError({ code: "FINANCIAL_FILE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const parsed = paramsSchema.safeParse(await routeContext.params);
    if (!parsed.success || request.nextUrl.searchParams.size) throw new AppError({ code: "FINANCIAL_FILE_INVALID", kind: "VALIDATION" });
    return { actor, input: parsed.data, resource: undefined };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
    const { actor, input: { id, fileId } } = security;
    const message = await getFinancialInboxMessage(id);
    if (message.workspaceId !== actor.workspace_id) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

    const isRaw = fileId === "raw";
    const attachment = isRaw ? null : message.attachments.find((item) => item.id === fileId);
    const storagePath = isRaw ? message.rawStoragePath : attachment?.storagePath;
    if (!storagePath) return NextResponse.json({ error: "Arquivo não foi arquivado." }, { status: 404 });
    const [contents] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
    const contentType = isRaw ? "message/rfc822" : attachment?.contentType || "application/octet-stream";
    const filename = downloadName(isRaw ? `${message.subject || "email-original"}.eml` : attachment?.documentNaming?.downloadName || attachment?.filename || "arquivo");
    const disposition = contentType === "application/pdf" || contentType.startsWith("image/") ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
});
