import { NextRequest, NextResponse } from "next/server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { assertDreReportAccess, dreReportInputSchema, type DreReportInput } from "@/features/financial/dre/report-access";
import { loadDreReport } from "@/features/financial/dre/report.server";
import { renderDreReportPdf } from "@/features/financial/dre/report-pdf";
import { renderDreReportWorkbook } from "@/features/financial/dre/report-xlsx";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<Record<string, never>> };
const contract = defineSecurityContract({ schemaVersion: 1, id: "financial.dre.report", version: 1,
  surface: { method: "POST", path: "/api/financial/dre/export" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-dre-units" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.dre.report", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, DreReportInput, { workspaceId: string }>(contract, {
  authenticate: async ({ request }) => requireUser(request).catch(rethrowServerAuthenticationFailure),
  parseInput: async ({ request }) => {
    const result = dreReportInputSchema.safeParse(await request.json().catch(() => null));
    if (!result.success) throw new AppError({ code: "DRE_REPORT_INPUT", kind: "VALIDATION", safeMessage: "Selecione período, formato e unidades válidos." });
    return result.data;
  },
  loadResource: async ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor, input }) => assertDreReportAccess(actor, input),
  assertScope: () => undefined,
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const report = await loadDreReport(security.input, security.actor);
  const pdf = security.input.format === "pdf";
  const bytes = pdf ? await renderDreReportPdf(report) : renderDreReportWorkbook(report);
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="dre-${security.input.month}-${security.input.mode}.${security.input.format}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
