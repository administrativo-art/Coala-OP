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
import { assertStoneFeeScope, authorizeStoneFeeActor } from "@/features/financial/receipts-reconciliation/fee-review-access";
import { feeExpenseActionSchema, type FeeExpenseAction } from "@/features/financial/receipts-reconciliation/fee-month-expense";
import { cancelFeeMonthExpense, feeMonthExpenseStatus, launchFeeMonthExpense } from "@/features/financial/receipts-reconciliation/fee-month-expense.server";
import { receiptMonthRange } from "@/features/financial/receipts-reconciliation/stone-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, never>> };
type Mapping = Awaited<ReturnType<typeof readReceivablePeriodMapping>>;
const viewSchema = z.object({ kioskId: z.string().trim().min(1).max(180), stoneCode: z.string().regex(/^\d{1,20}$/), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
type ViewInput = z.infer<typeof viewSchema>;

const viewContract = defineSecurityContract({ schemaVersion: 1, id: "financial.stone-fee-expenses.view", version: 1,
  surface: { method: "GET", path: "/api/financial/stone-fee-expenses" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-default-admin" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.stone-fee-expenses.view", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const actionContract = defineSecurityContract({ schemaVersion: 1, id: "financial.stone-fee-expenses.action", version: 1,
  surface: { method: "POST", path: "/api/financial/stone-fee-expenses" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-default-admin" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.stone-fee-expenses.action", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

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
    if (!parsed.success) throw new AppError({ code: "STONE_FEE_EXPENSE_INPUT", kind: "VALIDATION", safeMessage: "Informe unidade, StoneCode e mês." });
    return parsed.data;
  },
  loadResource: loadMapping, authorize, assertScope,
});
const actionEnforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, FeeExpenseAction, Mapping>(actionContract, {
  authenticate,
  async parseInput({ request }) {
    const body = await request.text();
    if (body.length > 4_096) throw new AppError({ code: "STONE_FEE_EXPENSE_BODY_TOO_LARGE", kind: "VALIDATION" });
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new AppError({ code: "STONE_FEE_EXPENSE_INPUT", kind: "VALIDATION" }); }
    const parsed = feeExpenseActionSchema.safeParse(raw);
    if (!parsed.success) throw new AppError({ code: "STONE_FEE_EXPENSE_INPUT", kind: "VALIDATION", safeMessage: "Pedido inválido." });
    return parsed.data;
  },
  loadResource: loadMapping, authorize, assertScope,
});

const scopeOf = (resource: Mapping, stoneCode: string) => ({ workspaceId: resource.workspaceId, mappingId: resource.id, kioskId: resource.kioskId, stoneCode });

export const GET = secureRoute({ contract: viewContract, enforcer: viewEnforcer }, async ({ security }) => {
  const { input, resource } = security;
  const status = await feeMonthExpenseStatus(scopeOf(resource, input.stoneCode), input.month);
  return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = secureRoute({ contract: actionContract, enforcer: actionEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const scope = scopeOf(resource, input.stoneCode);
  const result = input.action === "launch"
    ? await launchFeeMonthExpense(scope, { month: input.month, fingerprint: input.fingerprint, resultCenterId: input.resultCenterId }, { uid: actor.decoded.uid })
    : await cancelFeeMonthExpense(scope, { month: input.month, reason: input.reason }, { uid: actor.decoded.uid });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});
