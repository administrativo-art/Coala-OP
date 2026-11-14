import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { readReceivablePeriodMapping } from "@/features/financial/receivables/mapping.server";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { feeDecisionInputSchema, type FeeDecisionInput } from "@/features/financial/receipts-reconciliation/fee-review";
import { assertStoneFeeScope, authorizeStoneFeeActor } from "@/features/financial/receipts-reconciliation/fee-review-access";
import { buildFeeReview, saveFeeDecision } from "@/features/financial/receipts-reconciliation/fee-review.server";
import { receiptMonthRange } from "@/features/financial/receipts-reconciliation/stone-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, never>> };
type Mapping = Awaited<ReturnType<typeof readReceivablePeriodMapping>>;
const viewSchema = z.object({ kioskId: z.string().trim().min(1).max(180), stoneCode: z.string().regex(/^\d{1,20}$/), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
type ViewInput = z.infer<typeof viewSchema>;

const viewContract = defineSecurityContract({ schemaVersion: 1, id: "financial.stone-fees.view", version: 1,
  surface: { method: "GET", path: "/api/financial/stone-fees" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-default-admin" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.stone-fees.view", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const decideContract = defineSecurityContract({ schemaVersion: 1, id: "financial.stone-fees.decide", version: 1,
  surface: { method: "POST", path: "/api/financial/stone-fees" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-default-admin" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.stone-fees.decision", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

const authenticate = async ({ request }: { request: NextRequest }) => requireUser(request).catch(rethrowServerAuthenticationFailure);
const authorize = ({ actor }: { actor: ServerUserContext }) => authorizeStoneFeeActor(actor);
// O vínculo oficial (unidade × StoneCode) define o escopo; o workspace vem da sessão, nunca do cliente.
const loadMapping = async ({ actor, input }: { actor: ServerUserContext; input: { kioskId: string; stoneCode: string; month: string } }) => {
  const range = receiptMonthRange(input.month);
  const latest = latestPublishedDate(new Date());
  const day = range.through > latest ? latest : range.through;
  return readReceivablePeriodMapping({ kioskId: input.kioskId, stoneCode: input.stoneCode, from: day, through: day }, actor.workspace_id);
};
const assertScope = ({ actor, input, resource }: { actor: ServerUserContext; input: { kioskId: string; stoneCode: string }; resource: Mapping }) => assertStoneFeeScope(actor, input, resource);

const viewEnforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, ViewInput, Mapping>(viewContract, {
  authenticate,
  parseInput: ({ request }) => {
    const parsed = viewSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "STONE_FEES_INPUT", kind: "VALIDATION", safeMessage: "Informe unidade, StoneCode e mês." });
    return parsed.data;
  },
  loadResource: loadMapping, authorize, assertScope,
});
const decideEnforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, FeeDecisionInput, Mapping>(decideContract, {
  authenticate,
  async parseInput({ request }) {
    const body = await request.text();
    if (body.length > 4_096) throw new AppError({ code: "STONE_FEES_BODY_TOO_LARGE", kind: "VALIDATION" });
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new AppError({ code: "STONE_FEES_INPUT", kind: "VALIDATION" }); }
    const parsed = feeDecisionInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError({ code: "STONE_FEES_INPUT", kind: "VALIDATION", safeMessage: "Decisão inválida." });
    return parsed.data;
  },
  loadResource: loadMapping, authorize, assertScope,
});

export const GET = secureRoute({ contract: viewContract, enforcer: viewEnforcer }, async ({ security }) => {
  const { input, resource } = security;
  const view = await buildFeeReview({ workspaceId: resource.workspaceId, mappingId: resource.id, kioskId: resource.kioskId, stoneCode: input.stoneCode }, input.month);
  return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = secureRoute({ contract: decideContract, enforcer: decideEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const result = await saveFeeDecision({ workspaceId: resource.workspaceId, mappingId: resource.id, kioskId: resource.kioskId, stoneCode: input.stoneCode }, input, actor.decoded.uid);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});
