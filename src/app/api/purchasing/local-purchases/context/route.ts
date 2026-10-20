import { NextRequest, NextResponse } from "next/server";

import { listLocalPurchaseAccounts } from "@/features/purchasing/local-purchase-catalog.server";
import { listLocalPurchaseProducts } from "@/features/purchasing/local-purchase-stock.server";
import { localPurchaseUnitRefs } from "@/features/purchasing/local-purchase-units";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { assertMobileAppAttested } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "purchasing.local-purchase.context",
  version: 1,
  surface: { method: "GET", path: "/api/purchasing/local-purchases/context" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.local-purchase.register" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: "purchasing-local-purchase-context-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "LOCAL_PURCHASE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
      throw new AppError({ code: "LOCAL_PURCHASE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para registrar compras locais." });
    }
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const [unitsSnapshot, accounts, products, centersSnapshot] = await Promise.all([
    dbAdmin.collection("kiosks").limit(201).get(),
    listLocalPurchaseAccounts(),
    // Without the stock permission the app offers no product, so every item stays as direct consumption.
    security.actor.isDefaultAdmin || security.actor.permissions.app?.localPurchase?.stockEntry === true ? listLocalPurchaseProducts() : [],
    financialDbAdmin.collection("resultCenters").limit(201).get(),
  ]);
  if (unitsSnapshot.size > 200 || centersSnapshot.size > 200) {
    throw new AppError({ code: "LOCAL_PURCHASE_CONTEXT_LIMIT", kind: "CONFLICT", safeMessage: "Os cadastros excedem o limite do aplicativo. Solicite a revisão do catálogo." });
  }
  const actor = security.actor;
  const accessibleKiosks = unitsSnapshot.docs
    .filter((document) => canAccessUnit(actor.userDoc, document.id, { isDefaultAdmin: actor.isDefaultAdmin }))
    .map((document) => ({
      id: document.id,
      name: String(document.get("name") || document.get("displayName") || document.id),
      structuralUnitId: typeof document.get("pdvLinkManagedByUnitId") === "string" && document.get("pdvLinkManagedByUnitId")
        ? String(document.get("pdvLinkManagedByUnitId"))
        : document.id,
    }));
  const structuralUnitSnapshots = accessibleKiosks.length
    ? await dbAdmin.getAll(...[...new Set(accessibleKiosks.map((unit) => unit.structuralUnitId))]
      .map((id) => dbAdmin.collection("dp_units").doc(id)))
    : [];
  const structuralUnits = structuralUnitSnapshots
    .filter((document) => document.exists && document.get("isArchived") !== true)
    .map((document) => ({
      id: document.id,
      groupId: typeof document.get("groupId") === "string" ? String(document.get("groupId")) : null,
      organizationId: typeof document.get("organizationId") === "string" ? String(document.get("organizationId")) : null,
    }));
  const groupIds = [...new Set(structuralUnits.map((unit) => unit.groupId).filter((id): id is string => Boolean(id)))];
  const groupSnapshots = groupIds.length
    ? await dbAdmin.getAll(...groupIds.map((id) => dbAdmin.collection("dp_unitGroups").doc(id)))
    : [];
  const groups = groupSnapshots.filter((document) => document.exists).map((document) => ({
    id: document.id,
    name: String(document.get("name") || document.id),
    organizationId: typeof document.get("organizationId") === "string" ? String(document.get("organizationId")) : null,
  }));
  const organizationIds = [...new Set([
    ...structuralUnits.map((unit) => unit.organizationId),
    ...groups.map((group) => group.organizationId),
  ].filter((id): id is string => Boolean(id)))];
  const organizationSnapshots = organizationIds.length
    ? await dbAdmin.getAll(...organizationIds.map((id) => dbAdmin.collection("dp_unitOrganizations").doc(id)))
    : [];
  const organizations = organizationSnapshots
    .filter((document) => document.exists && document.get("isArchived") !== true)
    .map((document) => ({ id: document.id, name: String(document.get("name") || document.id) }));
  const units = localPurchaseUnitRefs(accessibleKiosks, structuralUnits, groups, organizations);
  const allowedUnits = new Set(units.map((unit) => unit.id));
  const resultCenters = centersSnapshot.docs.flatMap((document) => {
    const unitIds = document.get("unitIds");
    if (document.get("active") === false || !Array.isArray(unitIds) || unitIds.length !== 1 || !allowedUnits.has(unitIds[0])) return [];
    return [{ id: document.id, name: String(document.get("name") || document.id), unitId: String(unitIds[0]) }];
  }).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  return NextResponse.json({ units, accounts, resultCenters, products });
});
