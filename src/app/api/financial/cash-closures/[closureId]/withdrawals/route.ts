import { NextRequest, NextResponse } from "next/server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { withdrawalClassificationSchema, type WithdrawalClassificationInput } from "@/features/financial/cash-closures/withdrawal-classification";
import { assertWithdrawalAccess, classifyCashWithdrawal, listWithdrawalClassifications } from "@/features/financial/cash-closures/withdrawal-classification.server";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract, type RouteSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

type Context = { params: Promise<{ closureId: string }> };
type ClosureResource = NonNullable<Awaited<ReturnType<typeof getCashClosure>>>;
const route = "/api/financial/cash-closures/[closureId]/withdrawals";

function authenticate(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_WITHDRAWAL_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
}

function contract(method: "GET" | "PATCH", id: string, input: RouteSecurityContract["input"], mode: "read" | "write") {
  return defineSecurityContract({
    schemaVersion: 1,
    id,
    version: 1,
    surface: { method, path: route },
    exposure: "authenticated",
    identity: { kind: "active-user" },
    authorization: { kind: "permission", action: method === "GET" ? "financial.cash-withdrawals.view" : "financial.cash-withdrawals.classify" },
    resourceScope: { kind: "unit" },
    input,
    effects: { mode, audit: method === "GET" ? "none" : "server-authoritative" },
    errorExposure: "sanitized",
  } satisfies RouteSecurityContract);
}

const getContract = contract("GET", "financial.cash-withdrawal.read", { kind: "none" }, "read");
const patchContract = contract("PATCH", "financial.cash-withdrawal.classify", {
  kind: "schema",
  schema: "financial.cash-withdrawal.classification",
  unknownFields: "reject",
}, "write");

const getEnforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, undefined, ClosureResource>(getContract, {
  authenticate: ({ request }) => authenticate(request),
  loadResource: async ({ request, routeContext }) => {
    if (request.nextUrl.searchParams.size > 0) {
      throw new AppError({ code: "CASH_WITHDRAWAL_QUERY_UNSUPPORTED", kind: "VALIDATION", safeMessage: "A sangria cria uma nova despesa; a busca de despesas existentes está desativada." });
    }
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new AppError({ code: "CASH_WITHDRAWAL_NOT_FOUND", kind: "NOT_FOUND" });
    return current;
  },
  authorize: ({ actor, resource }) => assertWithdrawalAccess(actor, resource.closure, "view"),
  assertScope: ({ actor, resource }) => {
    if (resource.closure.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_WITHDRAWAL_WORKSPACE", kind: "AUTHORIZATION" });
    }
  },
});

const patchEnforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, WithdrawalClassificationInput, ClosureResource>(patchContract, {
  authenticate: ({ request }) => authenticate(request),
  parseInput: async ({ request }) => {
    const parsed = withdrawalClassificationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "CASH_WITHDRAWAL_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Dados de classificação inválidos.", cause: parsed.error });
    }
    if (parsed.data.action === "link") {
      throw new AppError({ code: "CASH_WITHDRAWAL_LINK_DISABLED", kind: "VALIDATION", safeMessage: "A sangria deve criar uma nova despesa; vincular uma despesa existente está desativado." });
    }
    return parsed.data;
  },
  loadResource: async ({ routeContext }) => {
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new AppError({ code: "CASH_WITHDRAWAL_NOT_FOUND", kind: "NOT_FOUND" });
    return current;
  },
  authorize: ({ actor, input, resource }) => assertWithdrawalAccess(actor, resource.closure, input.action),
  assertScope: ({ actor, resource }) => {
    if (resource.closure.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_WITHDRAWAL_WORKSPACE", kind: "AUTHORIZATION" });
    }
  },
});

const response = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer, observability: { source: "api", operation: "list-cash-withdrawals" } }, async ({ routeContext, security }) => {
  const { closureId } = await routeContext.params;
  return response(await listWithdrawalClassifications(closureId, security.actor));
});

export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer, observability: { source: "api", operation: "classify-cash-withdrawal" } }, async ({ routeContext, security }) => {
  const { closureId } = await routeContext.params;
  return response(await classifyCashWithdrawal(closureId, security.input, security.actor));
});
