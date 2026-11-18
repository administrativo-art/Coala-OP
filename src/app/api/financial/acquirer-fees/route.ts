import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import { feeActionSchema, feeRequestSchema } from "@/features/financial/acquirer-fees/contracts";
import { feeRecognitionActionSchema } from "@/features/financial/acquirer-fees/recognition-contracts";
import { executeSaleFeeAction, recognitionDependencies, readFeeRecognitionPolicy } from "@/features/financial/acquirer-fees/recognition.server";
import { policyActionSchema, saveRecognitionPolicy, recognitionConfiguration } from "@/features/financial/acquirer-fees/policy.server";
import { executeFeeAction, listFeeCandidates, listFeeRecords } from "@/features/financial/acquirer-fees/repository.server";
import { assertFeeAdmin, feeDependencies } from "@/features/financial/acquirer-fees/source.server";
import { autoModeActionSchema, readAutoState, saveAutoMode } from "@/features/financial/acquirer-fees/auto-recognition.server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 150;
type Context = { params: Promise<Record<string, never>> };
const postSchema = z.union([feeActionSchema.options[0], feeActionSchema.options[3], feeRecognitionActionSchema, policyActionSchema.extend({ action: z.literal("save_policy") }), autoModeActionSchema]);
const getSchema = feeRequestSchema.extend({ view: z.enum(["configuration", "history", "auto"]).default("history"), resultCenterId: z.string().min(1).max(180).optional(), cursor: z.string().min(1).max(180).optional() }).strict();
const contract = (method: "GET" | "POST") => defineSecurityContract({ schemaVersion: 1, id: `financial.acquirer-fees.${method === "GET" ? "configuration" : "recognition"}`, version: 2,
  surface: { method, path: "/api/financial/acquirer-fees" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "financial-default-admin-unit-mapping" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "acquirer-fees-v2", unknownFields: "reject" }, effects: { mode: method === "GET" ? "read" : "write", audit: method === "GET" ? "none" : "server-authoritative" }, errorExposure: "sanitized" });
function enforcer<T extends { request: z.infer<typeof feeRequestSchema> }>(method: "GET" | "POST", parse: (request: NextRequest) => Promise<T>) {
  const c = contract(method); return { contract: c, enforcer: createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, T, unknown>(c, {
    authenticate: async ({ request }) => requireUser(request).catch(rethrowServerAuthenticationFailure),
    parseInput: ({ request }) => parse(request), authorize: ({ actor }) => assertFeeAdmin(actor),
    loadResource: async ({ actor, input }) => readFeeRecognitionPolicy(input.request, actor), assertScope: () => undefined,
  }) };
}
const get = enforcer("GET", async request => { const parsed = getSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams)); if (!parsed.success) throw new AppError({ code: "FEE_QUERY_INVALID", kind: "VALIDATION" }); return { view: parsed.data.view, resultCenterId: parsed.data.resultCenterId, cursor: parsed.data.cursor, request: feeRequestSchema.parse({ mappingId: parsed.data.mappingId, kioskId: parsed.data.kioskId, stoneCode: parsed.data.stoneCode, referenceDate: parsed.data.referenceDate, source: parsed.data.source }) }; });
const post = enforcer("POST", async request => { const parsed = postSchema.safeParse(await readSalesReviewBody(request)); if (!parsed.success) throw new AppError({ code: "FEE_ACTION_INVALID", kind: "VALIDATION", safeMessage: "Pedido de apuração/configuração inválido. Use a prévia atual." }); return parsed.data; });
export const GET = secureRoute(get, async ({ security }) => {
  const { input, actor } = security;
  const result = input.view === "auto" ? await readAutoState(input.request, actor) : input.view === "configuration" ? await recognitionConfiguration(input.request, actor) : input.resultCenterId ? await listFeeCandidates(input.request, input.resultCenterId, input.cursor, actor) : await listFeeRecords(input.request, actor);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = secureRoute(post, async ({ request, security }) => {
  const input = security.input; const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110000)]);
  const result = input.action === "save_auto_mode" ? await saveAutoMode(input, security.actor)
    : input.action === "save_policy" ? await saveRecognitionPolicy({ request: input.request, policy: input.policy, expectedVersion: input.expectedVersion, reason: input.reason }, security.actor)
    : input.action === "cancel" || input.action === "preview" ? await executeFeeAction(input, security.actor, feeDependencies(signal))
    : await executeSaleFeeAction(input, security.actor, recognitionDependencies(signal));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
