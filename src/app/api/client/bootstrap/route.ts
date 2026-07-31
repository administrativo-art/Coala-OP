import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { canViewPurchasing } from "@/lib/purchasing-permissions";
import {
  canAccessUnit,
  canAccessUserByUnit,
  filterUnitsByAccess,
  type UnitAccessUser,
} from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BootstrapCollection =
  | "currentUser"
  | "profiles"
  | "users"
  | "kiosks"
  | "products"
  | "baseProducts"
  | "lots"
  | "goals";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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

export async function GET(request: NextRequest) {
  let context: ServerUserContext;
  try {
    context = await requireUser(request);
  } catch {
    return jsonError("Não autorizado.", 401);
  }

  const collections = parseCollections(request);
  if (collections.length === 0) {
    return jsonError("Informe ao menos uma coleção.", 400);
  }

  const unsupported = collections.filter(
    (name) =>
      ![
        "currentUser",
        "profiles",
        "users",
        "kiosks",
        "products",
        "baseProducts",
        "lots",
        "goals",
      ].includes(name)
  );
  if (unsupported.length > 0) {
    return jsonError(`Coleção não suportada: ${unsupported.join(", ")}.`, 404);
  }

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
          const users = await rawCollectionData("users");
          payload.users = users
            .filter((user) => user.id === context.userDoc.id || canAccessUserByUnit(
              context.userDoc,
              user as UnitAccessUser,
              { isDefaultAdmin: context.isDefaultAdmin }
            ))
            .map(serializeValue);
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
  } catch (error) {
    console.error("[client/bootstrap]", error);
    return jsonError("Falha ao carregar dados do servidor.", 500);
  }
}
