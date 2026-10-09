import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { MAX_USER_DASHBOARDS, dashboardLayoutInputSchema } from "@/features/management-dashboard/layout-policy";
import { ManagementDashboardError, deleteManagementLayout, listManagementLayouts, saveManagementLayout, setActiveManagementLayout } from "@/features/management-dashboard/layouts.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
const selectionSchema = z.object({ layoutId: z.string().trim().min(3).max(100) }).strict();

function contract(method: "GET" | "PUT" | "PATCH" | "DELETE", mode: "read" | "write" | "delete", input: "none" | "layout" | "selection") {
  return defineSecurityContract({
    schemaVersion: 1,
    id: `dashboard.layouts.${method.toLowerCase()}`,
    version: 1,
    surface: { method, path: "/api/dashboard/layouts" },
    exposure: "authenticated",
    identity: { kind: "active-user" },
    authorization: { kind: "permission", action: "dashboard.layouts.manage" },
    resourceScope: { kind: "none" },
    input: input === "none" ? { kind: "none" } : { kind: "schema", schema: input === "layout" ? "dashboard-layout-input" : "dashboard-layout-selection", unknownFields: "reject" },
    effects: { mode, audit: "none" },
    errorExposure: "sanitized",
  });
}

function authenticate(request: NextRequest) {
  return requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
}

function authorize(actor: ServerUserContext) {
  if (!actor.permissions.dashboard.view) throw new AppError({ code: "DASHBOARD_LAYOUT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para personalizar o painel." });
}

function wrapError(error: unknown): never {
  if (error instanceof z.ZodError) throw new AppError({ code: "DASHBOARD_LAYOUT_INVALID", kind: "VALIDATION", safeMessage: "A configuração do painel é inválida.", cause: error });
  if (error instanceof AppError) throw error;
  if (error instanceof ManagementDashboardError && error.reason === "conflict") throw new AppError({ code: "DASHBOARD_LAYOUT_CONFLICT", kind: "CONFLICT", safeMessage: "Este painel foi alterado em outra sessão. Recarregue antes de salvar.", cause: error });
  if (error instanceof ManagementDashboardError && error.reason === "forbidden") throw new AppError({ code: "DASHBOARD_LAYOUT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para executar esta ação no painel.", cause: error });
  if (error instanceof ManagementDashboardError && error.reason === "limit") throw new AppError({ code: "DASHBOARD_LAYOUT_LIMIT", kind: "VALIDATION", safeMessage: `Você pode manter até ${MAX_USER_DASHBOARDS} painéis pessoais.`, cause: error });
  if (error instanceof ManagementDashboardError && error.reason === "not-found") throw new AppError({ code: "DASHBOARD_LAYOUT_NOT_FOUND", kind: "VALIDATION", safeMessage: "Painel não encontrado.", cause: error });
  throw new AppError({ code: "DASHBOARD_LAYOUT_FAILED", kind: "UNEXPECTED_APPLICATION", safeMessage: "Não foi possível atualizar o painel.", cause: error });
}

const getContract = contract("GET", "read", "none");
const getEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext>(getContract, { authenticate: ({ request }) => authenticate(request), authorize: ({ actor }) => authorize(actor) });
export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => NextResponse.json(await listManagementLayouts(security.actor), { headers: { "Cache-Control": "private, no-store" } }));

const putContract = contract("PUT", "write", "layout");
const putEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, z.infer<typeof dashboardLayoutInputSchema>>(putContract, {
  authenticate: ({ request }) => authenticate(request),
  parseInput: async ({ request }) => dashboardLayoutInputSchema.parse(await request.json()),
  authorize: ({ actor }) => authorize(actor),
});
export const PUT = secureRoute({ contract: putContract, enforcer: putEnforcer }, async ({ security }) => {
  try { return NextResponse.json(await saveManagementLayout(security.actor, security.input)); } catch (error) { return wrapError(error); }
});

const patchContract = contract("PATCH", "write", "selection");
const patchEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, z.infer<typeof selectionSchema>>(patchContract, {
  authenticate: ({ request }) => authenticate(request),
  parseInput: async ({ request }) => selectionSchema.parse(await request.json()),
  authorize: ({ actor }) => authorize(actor),
});
export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security }) => {
  try { await setActiveManagementLayout(security.actor, security.input.layoutId); return NextResponse.json({ ok: true }); } catch (error) { return wrapError(error); }
});

const deleteContract = contract("DELETE", "delete", "selection");
const deleteEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, z.infer<typeof selectionSchema>>(deleteContract, {
  authenticate: ({ request }) => authenticate(request),
  parseInput: async ({ request }) => selectionSchema.parse(await request.json()),
  authorize: ({ actor }) => authorize(actor),
});
export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => {
  try { await deleteManagementLayout(security.actor, security.input.layoutId); return NextResponse.json({ ok: true }); } catch (error) { return wrapError(error); }
});
