import { NextRequest, NextResponse } from "next/server";

import { createRepositionRequestSchema, type CreateRepositionRequestInput } from "@/features/reposition-requests/lib/security";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { canAccessUnit, resolveUnitAccess, type UnitAccessResolution } from "@/lib/unit-access";
import { type RepositionRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VISIBLE_REQUESTS = 250;
const FIRESTORE_IN_LIMIT = 30;
type StaticRouteContext = { params: Promise<Record<string, never>> };

function requireRepositionPermission(context: ServerUserContext) {
  if (!context.isDefaultAdmin && !context.permissions?.stock?.analysis?.restock) {
    throw new AppError({ code: "REPOSITION_REQUEST_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para operar solicitações de reposição." });
  }
}

async function authenticate(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw new AppError({ code: "REPOSITION_REQUEST_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
}

async function parseCreateInput(request: NextRequest) {
  const parsed = createRepositionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({ code: "REPOSITION_REQUEST_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Payload inválido para solicitação de reposição." });
  }
  return parsed.data;
}

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: "stock.reposition-request.list",
  version: 1,
  surface: { method: "GET", path: "/api/stock/reposition-requests" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "stock.reposition-request.view" },
  resourceScope: { kind: "unit" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: "stock.reposition-request.create",
  version: 1,
  surface: { method: "POST", path: "/api/stock/reposition-requests" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "stock.reposition-request.create" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "stock.reposition-request.create-input", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, undefined, UnitAccessResolution>(listContract, {
  authenticate: ({ request }) => authenticate(request),
  loadResource: ({ actor }) => resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }),
  authorize: ({ actor }) => requireRepositionPermission(actor),
  assertScope: () => undefined,
});

type KioskResource = { id: string; name: string };

const createEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, CreateRepositionRequestInput, KioskResource>(createContract, {
  authenticate: ({ request }) => authenticate(request),
  parseInput: ({ request }) => parseCreateInput(request),
  async loadResource({ input }) {
    const kiosk = await dbAdmin.collection("kiosks").doc(input.kioskId).get();
    if (!kiosk.exists) throw new AppError({ code: "REPOSITION_REQUEST_UNIT_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Unidade não encontrada." });
    return { id: kiosk.id, name: String(kiosk.get("name") ?? kiosk.id) };
  },
  authorize: ({ actor }) => requireRepositionPermission(actor),
  assertScope: ({ actor, resource }) => {
    if (!canAccessUnit(actor.userDoc, resource.id, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: "REPOSITION_REQUEST_UNIT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Unidade fora do seu escopo." });
    }
  },
});

async function listVisibleRequests(access: UnitAccessResolution) {
  if (access.allUnits) return (await dbAdmin.collection("repositionRequests").orderBy("createdAt", "desc").limit(MAX_VISIBLE_REQUESTS).get()).docs;
  if (access.unitIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < access.unitIds.length; index += FIRESTORE_IN_LIMIT) chunks.push(access.unitIds.slice(index, index + FIRESTORE_IN_LIMIT));
  const snapshots = await Promise.all(chunks.map((unitIds) => dbAdmin.collection("repositionRequests").where("kioskId", "in", unitIds).limit(MAX_VISIBLE_REQUESTS).get()));
  const byId = new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((document) => [document.id, document]));
  return [...byId.values()].sort((left, right) => String(right.get("createdAt") ?? "").localeCompare(String(left.get("createdAt") ?? ""))).slice(0, MAX_VISIBLE_REQUESTS);
}

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  const docs = await listVisibleRequests(security.resource);
  return NextResponse.json({ requests: docs.map((document) => ({ id: document.id, ...(document.data() as Omit<RepositionRequest, "id">) })) });
});

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const now = new Date().toISOString();
  const ref = dbAdmin.collection("repositionRequests").doc();
  const payload: RepositionRequest = {
    id: ref.id,
    status: "Pendente",
    kioskId: resource.id,
    kioskName: resource.name,
    items: input.items,
    notes: input.notes ?? "",
    requestedBy: { userId: actor.userDoc.id, username: actor.userDoc.username },
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(payload);
  return NextResponse.json({ request: payload }, { status: 201 });
});
