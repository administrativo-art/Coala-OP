import { toRouteAccessError } from "@/lib/security/route-access.server";
import { NextResponse, type NextRequest } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { canViewPurchasing } from "@/lib/purchasing-permissions";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import {
  canAccessUnit,
  canAccessUserByUnit,
  filterUnitsByAccess,
  type UnitAccessUser,
} from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_COLLECTIONS = ["currentUser", "profiles", "users", "kiosks", "products", "baseProducts", "lots", "goals"];

type BootstrapCollection =
  | "currentUser"
  | "profiles"
  | "users"
  | "kiosks"
  | "products"
  | "baseProducts"
  | "lots"
  | "goals";

function serializeValue(value: unknown): unknown {
  if (!value) return value;
  if (typeof value !== "object") return value;

  const maybeTimestamp = value as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  if (
    typeof maybeTimestamp.toDate === "function" &&
    typeof maybeTimestamp.seconds === "number" &&
    typeof maybeTimestamp.nanoseconds === "number"
  ) {
    return {
      __type: "firestore-timestamp",
      seconds: maybeTimestamp.seconds,
      nanoseconds: maybeTimestamp.nanoseconds,
    };
  }

  if (Array.isArray(value)) return value.map(serializeValue);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      serializeValue(entry),
    ])
  );
}

async function collectionData(collectionName: string) {
  const snap = await dbAdmin.collection(collectionName).get();
  return snap.docs.map((doc) => serializeValue({ id: doc.id, ...doc.data() }));
}

async function rawCollectionData(
  collectionName: string
): Promise<Array<{ id: string } & Record<string, unknown>>> {
  const snap = await dbAdmin.collection(collectionName).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function canReadUsers(context: ServerUserContext) {
  const permissions = context.permissions;
  return (
    context.isDefaultAdmin ||
    permissions.settings.manageUsers ||
    permissions.dp?.collaborators?.view === true ||
    permissions.dp?.collaborators?.edit === true ||
    permissions.dp?.collaborators?.terminate === true
  );
}

function canReadLots(context: ServerUserContext) {
  const permissions = context.permissions;
  return (
    context.isDefaultAdmin ||
    permissions.stock?.inventoryControl?.view === true ||
    permissions.stock?.stockCount?.perform === true ||
    permissions.stock?.stockCount?.approve === true ||
    canViewPurchasing(permissions)
  );
}

function canReadGoals(context: ServerUserContext) {
  const permissions = context.permissions;
  return (
    context.isDefaultAdmin ||
    permissions.goals?.view === true ||
    permissions.goals?.manage === true ||
    permissions.settings.manageUsers === true
  );
}

function parseCollections(request: NextRequest): BootstrapCollection[] {
  const raw = request.nextUrl.searchParams.get("collections") ?? "";
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean) as BootstrapCollection[]
    )
  );
}

type StaticRouteContext = { params: Promise<Record<string, never>> };

/**
 * A porta de entrada garante usuário ativo e coleções conhecidas. O que cada pessoa enxerga de cada coleção é
 * filtrado abaixo, por permissão e unidade; por isso o contrato não declara uma permissão única.
 */
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "client.bootstrap.read",
  version: 1,
  surface: { method: "GET", path: "/api/client/bootstrap" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "none" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "client.bootstrap.collections", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

export const GET = secureRoute({
  contract,
  enforcer: createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, BootstrapCollection[]>(contract, {
    authenticate: ({ request }) => requireUser(request).catch((cause) => {
      const mapped = toRouteAccessError(cause, "CLIENT_BOOTSTRAP");
      if (mapped.kind === "AUTHENTICATION") throw new AppError({ code: "CLIENT_BOOTSTRAP_UNAUTHORIZED", kind: "AUTHENTICATION", safeMessage: "Não autorizado.", cause });
      throw mapped;
    }),
    parseInput: ({ request }) => {
      if ([...request.nextUrl.searchParams.keys()].some(key => key !== 'collections') || request.nextUrl.searchParams.getAll('collections').length > 1) {
        throw new AppError({ code: "CLIENT_BOOTSTRAP_QUERY_INVALID", kind: "VALIDATION" });
      }
      const collections = parseCollections(request);
      if (collections.length === 0) {
        throw new AppError({ code: "CLIENT_BOOTSTRAP_COLLECTIONS_REQUIRED", kind: "VALIDATION", safeMessage: "Informe ao menos uma coleção." });
      }
      const unsupported = collections.filter((name) => !SUPPORTED_COLLECTIONS.includes(name));
      if (unsupported.length > 0) {
        throw new AppError({ code: "CLIENT_BOOTSTRAP_COLLECTION_UNSUPPORTED", kind: "NOT_FOUND", safeMessage: "Coleção não suportada." });
      }
      return collections;
    },
  }),
}, async ({ security: { actor: context, input: collections } }) => {
  const payload: Record<string, unknown> = {};

  try {
    await Promise.all(
      collections.map(async (collectionName) => {
        if (collectionName === "currentUser") {
          payload.currentUser = serializeValue(context.userDoc);
          return;
        }

        if (collectionName === "profiles") {
          payload.profiles = await collectionData("profiles");
          return;
        }

        if (collectionName === "users") {
          if (!canReadUsers(context)) {
            payload.users = [serializeValue(context.userDoc)];
            return;
          }
          try {
            const users = await rawCollectionData("users");
            payload.users = users
              .filter((user) => user.id === context.userDoc.id || canAccessUserByUnit(
                context.userDoc,
                user as UnitAccessUser,
                { isDefaultAdmin: context.isDefaultAdmin }
              ))
              .map(serializeValue);
          } catch (error) {
            // O diretório é auxiliar: uma falha transitória não deve derrubar
            // a autenticação nem impedir o restante da aplicação de carregar.
            console.error("[client/bootstrap:users]", error);
            payload.users = [serializeValue(context.userDoc)];
          }
          return;
        }

        if (collectionName === "kiosks") {
          const kiosks = await rawCollectionData("kiosks");
          payload.kiosks = filterUnitsByAccess(kiosks, context.userDoc, {
            isDefaultAdmin: context.isDefaultAdmin,
          }).map(serializeValue);
          return;
        }

        if (collectionName === "products") {
          payload.products = await collectionData("products");
          return;
        }

        if (collectionName === "baseProducts") {
          payload.baseProducts = await collectionData("baseProducts");
          return;
        }

        if (collectionName === "lots") {
          if (!canReadLots(context)) {
            payload.lots = [];
            return;
          }
          const lots = await rawCollectionData("lots");
          payload.lots = lots
            .filter((lot) => canAccessUnit(context.userDoc, String(lot["kioskId"] ?? ""), {
              isDefaultAdmin: context.isDefaultAdmin,
            }))
            .map(serializeValue);
          return;
        }

        if (collectionName === "goals") {
          if (!canReadGoals(context)) {
            payload.goalTemplates = [];
            payload.goalPeriods = [];
            payload.employeeGoals = [];
            return;
          }

          const [templates, periods, employeeGoals] = await Promise.all([
            rawCollectionData("goalTemplates"),
            rawCollectionData("goalPeriods"),
            rawCollectionData("employeeGoals"),
          ]);
          const visibleTemplates = templates.filter((template) => canAccessUnit(
            context.userDoc,
            String(template["kioskId"] ?? ""),
            { isDefaultAdmin: context.isDefaultAdmin }
          ));
          const visiblePeriods = periods.filter((period) => canAccessUnit(
            context.userDoc,
            String(period["kioskId"] ?? ""),
            { isDefaultAdmin: context.isDefaultAdmin }
          ));
          const visiblePeriodIds = new Set(visiblePeriods.map((period) => period.id));
          payload.goalTemplates = visibleTemplates.map(serializeValue);
          payload.goalPeriods = visiblePeriods.map(serializeValue);
          payload.employeeGoals = employeeGoals
            .filter((goal) => visiblePeriodIds.has(String(goal["periodId"] ?? "")))
            .map(serializeValue);
        }
      })
    );

    return NextResponse.json(payload);
  } catch (cause) {
    throw new AppError({ code: "CLIENT_BOOTSTRAP_LOAD_FAILED", kind: "UNEXPECTED_APPLICATION", safeMessage: "Falha ao carregar dados do servidor.", cause });
  }
});
