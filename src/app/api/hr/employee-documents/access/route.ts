import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { canViewHr, type HrAccess } from "@/features/hr/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { getUserDisplayName } from "@/lib/user-display";
import { z } from "zod";
import { employeeDocumentDownloadName } from "@/lib/hr/employee-document-planning";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { canAccessDocument } from "@/lib/hr/employee-document-access";
import { assertEmployeeUnitAccess, buildEmployeeDocumentAccessSubject, loadEmployeeDocumentAccessSettings } from "@/features/hr/lib/employee-document-access-server";

export const runtime = "nodejs";
const schema = z.object({ id: z.string().trim().min(1).max(256).regex(/^[^/]+$/), action: z.enum(["view", "download"]).default("view") }).strict();
const contract = defineSecurityContract({
  schemaVersion: 1, id: "hr.employee-documents.access", version: 1,
  surface: { method: "POST", path: "/api/hr/employee-documents/access" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "employee-document-policy-and-unit" },
  resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "hr.employee-documents.access", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, HrAccess, z.infer<typeof schema>, { workspaceId: string }>({
  id: "employee-document-access-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:employee-document-policy-and-unit", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!canViewHr(actor.permissions, actor.isDefaultAdmin)) throw new AppError({ code: "EMPLOYEE_DOCUMENT_ACCESS_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar documentos." });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || request.nextUrl.searchParams.size) throw new AppError({ code: "EMPLOYEE_DOCUMENT_ACCESS_INVALID", kind: "VALIDATION", safeMessage: "Documento ou ação inválida." });
    const access: HrAccess = { ...actor, workspaceId: actor.workspace_id, actorName: getUserDisplayName(actor.userDoc, actor.decoded.uid), canView: true, canManageCatalog: false, lookupError: null };
    return { actor: access, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
    const access = security.actor;
    const { id, action } = security.input;
    const ref = hrDbAdmin.collection("employeeDocuments").doc(String(id ?? ""));
    const snap = await ref.get();
    if (!snap.exists || snap.get("deletedAt")) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    await assertEmployeeUnitAccess(access, String(snap.get("employeeId") ?? "")).catch(() => {
      throw new AppError({ code: "EMPLOYEE_DOCUMENT_UNIT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Documento indisponível para seu acesso." });
    });

    // Enforce a política de sigilo do documento no backend (nunca no cliente).
    const accessSettings = await loadEmployeeDocumentAccessSettings(access);
    const subject = buildEmployeeDocumentAccessSubject(access, accessSettings, String(snap.get("employeeId") ?? ""));
    const { allowed, policy } = canAccessDocument(
      { documentTypeCode: snap.get("documentTypeCode"), category: snap.get("category"), accessLevel: snap.get("accessLevel") },
      subject,
      accessSettings.visibilityConfig,
    );
    if (!allowed) {
      await ref.collection("audit").add({
        action: "ACCESS_DENIED",
        actorId: access.decoded.uid,
        actorName: access.actorName,
        policy,
        requestedAction: action === "download" ? "download" : "view",
        at: Timestamp.now(),
      });
      return NextResponse.json({ error: "Você não tem autorização para acessar este documento." }, { status: 403 });
    }

    const path = snap.get("storagePath");
    if (typeof path !== "string") return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
    let contents: Buffer;
    try {
      [contents] = await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .file(path)
        .download();
    } catch (cause) {
      console.error("[employee-documents/access] Falha ao ler arquivo privado.", cause);
      return NextResponse.json(
        { error: "Não foi possível abrir o arquivo agora. Tente novamente em instantes." },
        { status: 503 },
      );
    }
    const at = Timestamp.now();
    await Promise.all([
      ref.update({ accessCount: FieldValue.increment(1), lastAccessedAt: at }),
      ref.collection("audit").add({ action: action === "download" ? "downloaded" : "viewed", actorId: access.decoded.uid, actorName: access.actorName, at }),
    ]);
    const downloadName = employeeDocumentDownloadName({ storedName: snap.get("storedName"), originalName: snap.get("originalName"), mimeType: snap.get("mimeType") });
    const safeName = downloadName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const disposition = action === "download" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(downloadName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "Content-Type": String(snap.get("mimeType") || "application/octet-stream"),
        "X-Content-Type-Options": "nosniff",
      },
    });
});
