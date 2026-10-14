import { NextRequest } from "next/server";

import {
  authenticateCollaboratorRequestUser,
  collaboratorRequestOperationError,
  collaboratorRequestRouteSchema,
  requireCollaboratorRequestResource,
} from "@/features/hr/requests/security.server";
import { loadRequestDocument } from "@/features/hr/requests/service.server";
import type { ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };
type DocumentInput = { wantsPdf: boolean };
type RequestResource = { requestId: string; employeeId: string; owner: boolean };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "collaborator.requests.document.read",
  version: 1,
  surface: { method: "GET", path: "/api/collaborator/requests/[requestId]/document" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "collaborator-request-document" },
  resourceScope: { kind: "custom", strategy: "collaborator-request" },
  input: { kind: "schema", schema: "collaborator-request-document", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, DocumentInput, RequestResource>({
  id: "collaborator-request-document-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:collaborator-request-document", "scope:collaborator-request", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await authenticateCollaboratorRequestUser(request);
    const parsedParams = collaboratorRequestRouteSchema.safeParse(await routeContext.params);
    const format = request.nextUrl.searchParams.get("format");
    if (!parsedParams.success || (format !== null && format !== "pdf" && format !== "docx")) {
      throw new AppError({ code: "COLLABORATOR_REQUEST_DOCUMENT_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Documento solicitado inválido.", reportable: false });
    }
    const resource = await requireCollaboratorRequestResource(actor, parsedParams.data.requestId);
    return { actor, input: { wantsPdf: format === "pdf" }, resource };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  try {
    const document = await loadRequestDocument(security.actor, security.resource.requestId, security.input.wantsPdf);
    return new Response(new Uint8Array(document.buffer), {
      headers: {
        "Content-Type": document.contentType,
        "Content-Disposition": `${security.input.wantsPdf ? "inline" : "attachment"}; filename="${document.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (cause) {
    throw collaboratorRequestOperationError(cause, "Falha ao abrir o termo.");
  }
});
