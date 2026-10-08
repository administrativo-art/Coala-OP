import { NextRequest, NextResponse } from "next/server";

import { cancelRepositionRequestSchema, type CancelRepositionRequestInput } from "@/features/reposition-requests/lib/security";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { canAccessUnit } from "@/lib/unit-access";
import { type RepositionRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };
type RequestResource = { ref: FirebaseFirestore.DocumentReference; request: RepositionRequest };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "stock.reposition-request.cancel",
  version: 1,
  surface: { method: "PATCH", path: "/api/stock/reposition-requests/[requestId]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "stock.reposition-request.cancel" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "stock.reposition-request.cancel-input", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, CancelRepositionRequestInput, RequestResource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => { throw new AppError({ code: "REPOSITION_REQUEST_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); }),
  async parseInput({ request }) {
    const parsed = cancelRepositionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: "REPOSITION_REQUEST_CANCEL_INVALID", kind: "VALIDATION", safeMessage: "Somente o cancelamento explícito é permitido." });
    return parsed.data;
  },
  async loadResource({ routeContext }) {
    const { requestId } = await routeContext.params;
    if (!requestId || requestId.includes("/")) throw new AppError({ code: "REPOSITION_REQUEST_ID_INVALID", kind: "VALIDATION", safeMessage: "Identificador inválido." });
    const ref = dbAdmin.collection("repositionRequests").doc(requestId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new AppError({ code: "REPOSITION_REQUEST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Solicitação de reposição não encontrada." });
    return { ref, request: { id: snapshot.id, ...(snapshot.data() as Omit<RepositionRequest, "id">) } };
  },
  authorize({ actor }) {
    if (!actor.isDefaultAdmin && !actor.permissions?.stock?.analysis?.restock) throw new AppError({ code: "REPOSITION_REQUEST_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para cancelar solicitações." });
  },
  assertScope({ actor, resource }) {
    if (!canAccessUnit(actor.userDoc, resource.request.kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: "REPOSITION_REQUEST_UNIT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Solicitação fora do seu escopo." });
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const now = new Date().toISOString();
  const updated = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(security.resource.ref);
    if (!snapshot.exists) throw new AppError({ code: "REPOSITION_REQUEST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Solicitação não encontrada." });
    const current = { id: snapshot.id, ...(snapshot.data() as Omit<RepositionRequest, "id">) };
    if (current.status !== "Pendente") throw new AppError({ code: "REPOSITION_REQUEST_CANCEL_CONFLICT", kind: "CONFLICT", safeMessage: "Somente solicitações pendentes podem ser canceladas." });
    const update = {
      status: security.input.status,
      updatedAt: now,
      reviewedAt: now,
      reviewedBy: { userId: security.actor.userDoc.id, username: security.actor.userDoc.username },
    } as const;
    transaction.update(security.resource.ref, update);
    return { ...current, ...update };
  });
  return NextResponse.json({ request: updated });
});
